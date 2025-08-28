// FASP 送信側の各種処理
import { createDB } from "../db/mod.ts";
import { getSystemKey } from "./system_actor.ts";
import { pemToArrayBuffer } from "@takos/crypto";
import { bufToB64 } from "@takos/buffer";
import { ensurePem, verifyHttpSignature } from "../utils/activitypub.ts";
import { normalizeBaseUrl } from "../utils/url.ts";

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
  domain: string,
  url: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: HeadersInit;
    verifyResponseSignature?: boolean;
    signing?: "auto" | "none" | "registered";
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

  const db = createDB(env);
  const { privateKey } = await getSystemKey(db, domain);
  let keyId = `https://${domain}/actor#main-key`;
  const signingMode = options.signing ?? "auto";
  if (signingMode === "registered") {
    try {
      const u = new URL(url);
      const origin = `${u.protocol}//${u.host}`;
      // 登録済み FASP の origin から faspId を取得
      const rec = await db.faspProviders.findOne({
        baseUrl: { $regex: `^${origin}` },
      }) as { faspId?: string } | null;
      if (rec?.faspId) keyId = String(rec.faspId);
    } catch {
      // fallback to actor keyId
    }
  }

  const baseOpts: RequestInit = { method };
  if (options.body !== undefined) baseOpts.body = bodyText;

  for (let attempt = 0; attempt < 5; attempt++) {
    const headers = new Headers(baseHeaders);
    const created = Math.floor(Date.now() / 1000);
    if (signingMode !== "none") {
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
    }

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
  domain: string,
  ann: FaspAnnouncement,
): Promise<void> {
  const db = createDB(env);
  // 設定に基づき送信先を決定
  const settings = await db.faspProviders.getSettings();
  if (settings && settings.shareEnabled === false) return; // 共有無効
  const baseFilter: Record<string, unknown> = {
    status: "approved",
  };
  if (
    settings?.shareServerIds && Array.isArray(settings.shareServerIds) &&
    settings.shareServerIds.length > 0
  ) {
    baseFilter.serverId = { $in: settings.shareServerIds };
  }
  const fasps = await db.faspProviders.list(baseFilter);
  if (!fasps || fasps.length === 0) return;
  const body = JSON.stringify({
    source: ann.source ?? { subscription: { id: "default" } },
    category: ann.category,
    eventType: ann.eventType,
    objectUris: ann.objectUris,
    moreObjectsAvailable: !!ann.moreObjectsAvailable,
  });
  await Promise.all(
    fasps.map(async (p: unknown) => {
      const baseUrl = normalizeBaseUrl(
        (p as { baseUrl?: string }).baseUrl ?? "",
      );
      if (!baseUrl) return;
      const url = `${baseUrl}/data_sharing/v0/announcements`;
      try {
        await faspFetch(env, domain, url, {
          method: "POST",
          body,
          signing: "registered",
        });
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
  domain: string,
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
  await sendAnnouncements(env, domain, ann).catch(() => {});
}

export async function getFaspBaseUrl(
  env: Record<string, string>,
  capability: string,
): Promise<string | null> {
  const db = createDB(env);
  // 設定から検索対象のプロバイダが指定されていれば優先
  const settings = await db.faspProviders.getSettings();
  if (settings?.searchServerId) {
    const byId = await db.faspProviders.findOne({
      serverId: settings.searchServerId,
      status: "approved",
      [`capabilities.${capability}.enabled`]: true,
    }) as { baseUrl?: string } | null;
    if (byId?.baseUrl) {
      const n = normalizeBaseUrl(String(byId.baseUrl));
      if (n) return n;
    }
  }
  // それ以外は最初の承認済み・有効なもの
  const rec = await db.faspProviders.findOne({
    status: "approved",
    [`capabilities.${capability}.enabled`]: true,
  }) as { baseUrl?: string } | null;
  if (!rec?.baseUrl) return null;
  return normalizeBaseUrl(String(rec.baseUrl));
}

// FASP へ capability の有効化/無効化を通知する
export async function notifyCapabilityActivation(
  env: Record<string, string>,
  domain: string,
  baseUrl: string,
  identifier: string,
  version: string,
  enabled: boolean,
): Promise<void> {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return;
  const url = `${base}/capabilities/${identifier}/${version}/activation`;
  try {
    await faspFetch(env, domain, url, {
      method: enabled ? "POST" : "DELETE",
      signing: "registered",
    });
  } catch {
    /* ignore errors */
  }
}

export { faspFetch };
