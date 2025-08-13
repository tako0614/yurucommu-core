// FASP 送信側の各種処理
import { createDB } from "../DB/mod.ts";
import { getSystemKey } from "./system_actor.ts";
import { pemToArrayBuffer } from "../../shared/crypto.ts";
import { bufToB64 } from "../../shared/buffer.ts";
import { ensurePem, verifyHttpSignature } from "../utils/activitypub.ts";

export const faspMetrics = {
  rateLimitHits: 0,
  signatureFailures: 0,
  timeouts: 0,
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const sec = Number(value);
  if (!Number.isNaN(sec)) return sec * 1000;
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return date - Date.now();
  return null;
}

export interface FaspAnnouncement {
  source?: Record<string, unknown>;
  category: "content" | "account";
  eventType: "new" | "update" | "delete" | "trending";
  objectUris: string[];
  moreObjectsAvailable?: boolean;
}

async function computeContentDigest(body: string): Promise<string> {
  const buf = new TextEncoder().encode(body);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return `sha-256=:${bufToB64(hash)}:`;
}

async function faspFetch(
  env: Record<string, string>,
  url: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: HeadersInit;
    verifyResponseSignature?: boolean;
  } = {},
): Promise<Response> {
  const method = options.method ?? "GET";
  const bodyText = options.body === undefined
    ? ""
    : typeof options.body === "string"
    ? options.body
    : JSON.stringify(options.body);
  const baseHeaders = new Headers(options.headers);
  baseHeaders.set("Accept", baseHeaders.get("Accept") ?? "application/json");
  if (bodyText) {
    baseHeaders.set(
      "Content-Type",
      baseHeaders.get("Content-Type") ?? "application/json",
    );
  }
  const digest = await computeContentDigest(bodyText);
  baseHeaders.set("Content-Digest", digest);

  const domain = env["ACTIVITYPUB_DOMAIN"];
  const db = createDB(env);
  const { privateKey } = await getSystemKey(db, domain);
  const keyId = `https://${domain}/actor#main-key`;

  const baseOpts: RequestInit = { method };
  if (options.body !== undefined) baseOpts.body = bodyText;

  for (let attempt = 0; attempt < 5; attempt++) {
    const headers = new Headers(baseHeaders);
    const created = Math.floor(Date.now() / 1000);
    const sigParams =
      `("@method" "@target-uri" "content-digest");created=${created};keyid="${keyId}";alg="ed25519"`;
    const signingString = [
      `"@method": ${method.toLowerCase()}`,
      `"@target-uri": ${url}`,
      `"content-digest": ${digest}`,
      `"@signature-params": ${sigParams}`,
    ].join("\n");
    const normalized = ensurePem(privateKey, "PRIVATE KEY");
    const keyData = pemToArrayBuffer(normalized);
    const cryptoKey = await crypto.subtle.importKey(
      "pkcs8",
      keyData,
      { name: "Ed25519" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign(
      "Ed25519",
      cryptoKey,
      new TextEncoder().encode(signingString),
    );
    const sigB64 = bufToB64(signature);
    headers.set("Signature-Input", `sig1=${sigParams}`);
    headers.set("Signature", `sig1=:${sigB64}:`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let res: Response;
    try {
      res = await fetch(url, {
        ...baseOpts,
        headers,
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof DOMException && e.name === "AbortError") {
        faspMetrics.timeouts++;
        const wait = Math.pow(2, attempt) * 1000;
        await delay(wait);
        continue;
      }
      throw e;
    }
    clearTimeout(timer);
    if (res.status === 429) {
      faspMetrics.rateLimitHits++;
      const wait = parseRetryAfter(res.headers.get("Retry-After")) ??
        Math.pow(2, attempt) * 1000;
      await delay(wait);
      continue;
    }
    const resBody = await res.text();
    if (options.verifyResponseSignature !== false) {
      const ok = await verifyHttpSignature(res, resBody);
      if (!ok) {
        faspMetrics.signatureFailures++;
        throw new Error("署名検証に失敗しました");
      }
    }
    return new Response(resBody, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  }
  throw new Error("faspFetch: 最大リトライ回数を超えました");
}

export async function sendAnnouncements(
  env: Record<string, string>,
  ann: FaspAnnouncement,
): Promise<void> {
  const db = createDB(env);
  const mongo = await db.getDatabase();
  // 承認済みのプロバイダのみに送信
  const fasps = await mongo.collection("fasps").find({ status: "approved" })
    .toArray();
  if (!fasps || fasps.length === 0) return;
  const body = JSON.stringify({
    source: ann.source ?? { subscription: { id: "default" } },
    category: ann.category,
    eventType: ann.eventType,
    objectUris: ann.objectUris,
    moreObjectsAvailable: !!ann.moreObjectsAvailable,
  });
  await Promise.all(
    fasps.map(async (p: { baseUrl?: string }) => {
      const baseUrl = (p.baseUrl ?? "").replace(/\/$/, "");
      if (!baseUrl) return;
      const url = `${baseUrl}/data_sharing/v0/announcements`;
      try {
        await faspFetch(env, url, { method: "POST", body });
      } catch {
        /* ignore errors */
      }
    }),
  );
}

const PUBLIC_AUDIENCE = "https://www.w3.org/ns/activitystreams#Public";

// 公開かつ discoverable なオブジェクトのみ FASP へ通知する
export async function announceIfPublicAndDiscoverable(
  env: Record<string, string>,
  ann: FaspAnnouncement,
  obj: Record<string, unknown> | null,
): Promise<void> {
  if (!obj) return;
  const extra = obj.extra;
  const discoverable = (obj as { discoverable?: unknown }).discoverable ??
    (typeof extra === "object" && extra !== null
      ? (extra as { discoverable?: unknown }).discoverable
      : undefined);
  if (discoverable === false) return;
  const to = (obj as { aud?: { to?: unknown } }).aud?.to;
  if (Array.isArray(to) && !to.includes(PUBLIC_AUDIENCE)) return;
  await sendAnnouncements(env, ann).catch(() => {});
}

export async function getFaspBaseUrl(
  env: Record<string, string>,
  capability: string,
): Promise<string | null> {
  const db = createDB(env);
  const mongo = await db.getDatabase();
  const rec = await mongo.collection("fasps").findOne({
    status: "approved",
    [`capabilities.${capability}.enabled`]: true,
  });
  if (!rec?.baseUrl) return null;
  return String(rec.baseUrl).replace(/\/$/, "");
}

// FASP へ capability の有効化/無効化を通知する
export async function notifyCapabilityActivation(
  env: Record<string, string>,
  baseUrl: string,
  identifier: string,
  version: string,
  enabled: boolean,
): Promise<void> {
  const url = `${
    baseUrl.replace(/\/$/, "")
  }/capabilities/${identifier}/${version}/activation`;
  try {
    await faspFetch(env, url, { method: enabled ? "POST" : "DELETE" });
  } catch {
    /* ignore errors */
  }
}

export { faspFetch };
