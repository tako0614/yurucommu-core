// FASP 送信側の各種処理
import { createDB } from "../DB/mod.ts";
import { getSystemKey } from "./system_actor.ts";
import { pemToArrayBuffer } from "../../shared/crypto.ts";
import { b64ToBuf, bufToB64 } from "../../shared/buffer.ts";
import { ensurePem, fetchPublicKeyPem } from "../utils/activitypub.ts";

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
  options: { method?: string; body?: unknown; headers?: HeadersInit } = {},
): Promise<Response> {
  const method = options.method ?? "GET";
  const bodyText = options.body === undefined
    ? ""
    : typeof options.body === "string"
    ? options.body
    : JSON.stringify(options.body);
  const headers = new Headers(options.headers);
  headers.set("Accept", headers.get("Accept") ?? "application/json");
  if (bodyText) {
    headers.set(
      "Content-Type",
      headers.get("Content-Type") ?? "application/json",
    );
  }
  const digest = await computeContentDigest(bodyText);
  headers.set("Content-Digest", digest);

  const domain = env["ACTIVITYPUB_DOMAIN"];
  const db = createDB(env);
  const { privateKey } = await getSystemKey(db, domain);
  const keyId = `https://${domain}/actor#main-key`;
  const created = Math.floor(Date.now() / 1000);
  const sigParams =
    `("@method" "@target-uri" "content-digest");created=${created};keyid="${keyId}";alg="rsa-v1_5-sha256"`;
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
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingString),
  );
  const sigB64 = bufToB64(signature);
  headers.set("Signature-Input", `sig1=${sigParams}`);
  headers.set("Signature", `sig1=:${sigB64}:`);

  const fetchOpts: RequestInit = { method, headers };
  if (options.body !== undefined) fetchOpts.body = bodyText;
  const res = await fetch(url, fetchOpts);
  const resBody = await res.text();
  await verifyFaspResponse(res, resBody);
  return new Response(resBody, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

async function verifyFaspResponse(res: Response, body: string): Promise<void> {
  const digest = res.headers.get("Content-Digest");
  if (!digest) throw new Error("Content-Digest ヘッダーがありません");
  const expected = await computeContentDigest(body);
  if (digest !== expected) throw new Error("Content-Digest 検証に失敗しました");
  const sigInput = res.headers.get("Signature-Input");
  const sig = res.headers.get("Signature");
  if (!sigInput || !sig) {
    throw new Error("署名ヘッダーが不足しています");
  }
  const m = sigInput.match(
    /([^=]+)=\(([^)]+)\);created=(\d+);keyid="([^"]+)";alg="([^"]+)"/,
  );
  if (!m) throw new Error("Signature-Input の解析に失敗しました");
  const label = m[1];
  const fields = m[2].split(/\s+/).map((s) => s.replace(/"/g, ""));
  const created = Number(m[3]);
  const keyId = m[4];
  const alg = m[5];
  const sigMatch = sig.match(new RegExp(`${label}=:(.+):`));
  if (!sigMatch) throw new Error("Signature の解析に失敗しました");
  const signature = sigMatch[1];
  const lines = fields.map((f) => {
    if (f === "@status") return `"@status": ${res.status}`;
    if (f === "content-digest") return `"content-digest": ${digest}`;
    const hv = res.headers.get(f);
    if (hv === null) throw new Error(`署名対象ヘッダーが見つかりません: ${f}`);
    return `${f}: ${hv}`;
  });
  const params = `(${
    fields.map((f) => `"${f}"`).join(" ")
  });created=${created};keyid="${keyId}";alg="${alg}"`;
  lines.push(`"@signature-params": ${params}`);
  const signing = lines.join("\n");
  const publicKeyPem = await fetchPublicKeyPem(keyId);
  if (!publicKeyPem) throw new Error("公開鍵取得に失敗しました");
  const keyData = pemToArrayBuffer(
    publicKeyPem.includes("BEGIN PUBLIC KEY")
      ? publicKeyPem
      : ensurePem(publicKeyPem, "PUBLIC KEY"),
  );
  const cryptoKey = await crypto.subtle.importKey(
    "spki",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    b64ToBuf(signature),
    new TextEncoder().encode(signing),
  );
  if (!ok) throw new Error("署名検証に失敗しました");
}

export async function sendAnnouncements(
  env: Record<string, string>,
  ann: FaspAnnouncement,
): Promise<void> {
  const db = createDB(env);
  const mongo = await db.getDatabase();
  const fasps = await mongo.collection("fasps").find({}).toArray();
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
