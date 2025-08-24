import { createDB } from "../DB/mod.ts";
import { getEnv } from "../../shared/config.ts";
import { pemToArrayBuffer } from "../../shared/crypto.ts";
import { getSystemKey } from "../services/system_actor.ts";
import type { Context } from "hono";
import { b64ToBuf, bufToB64 } from "../../shared/buffer.ts";

const SIG_CACHE_TTL = 24 * 60 * 60 * 1000; // 24時間
// ホストごとの署名方式キャッシュ
const sigCache = new Map<
  string,
  { style: "rfc9421" | "cavage"; expires: number }
>();

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

async function applySignature(
  method: string,
  url: string,
  body: string,
  key: { id: string; privateKey: string },
  headersToSign: string[],
  headers: Headers,
  // ActivityPub 実装で広く使われている Cavage 形式を既定にする
  style: "rfc9421" | "cavage" | "both" = "cavage",
): Promise<void> {
  const parsed = new URL(url);
  const host = parsed.hostname;
  const date = new Date().toUTCString();
  const encoder = new TextEncoder();

  headers.set("Date", date);

  let digest = "";
  if (headersToSign.includes("digest")) {
    const digestValue = bufToB64(
      await crypto.subtle.digest("SHA-256", encoder.encode(body)),
    );
    digest = `SHA-256=${digestValue}`;
    headers.set("Digest", digest);
  }

  const fullPath = parsed.pathname + parsed.search;
  const lines = headersToSign.map((h) => {
    if (h === "(request-target)") {
      return `(request-target): ${method.toLowerCase()} ${fullPath}`;
    }
    if (h === "host") return `host: ${host}`;
    if (h === "date") return `date: ${date}`;
    if (h === "digest") return `digest: ${digest}`;
    return `${h}: ${headers.get(h) ?? ""}`;
  });

  const signingString = lines.join("\n");

  const normalizedPrivateKey = ensurePem(key.privateKey, "PRIVATE KEY");
  const keyData = pemToArrayBuffer(normalizedPrivateKey);
  const alg = detectKeyAlgorithm(normalizedPrivateKey);
  let signature: ArrayBuffer;
  let sigAlg = "ed25519";
  if (alg === "rsa") {
    // ActivityPubで広く利用されているRSA署名は
    // RSASSA-PKCS1-v1_5（通称 RSA-SHA256）である
    // RSA-PSSなど他の方式には現状対応していない
    const cryptoKey = await crypto.subtle.importKey(
      "pkcs8",
      keyData,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      encoder.encode(signingString),
    );
    sigAlg = "rsa-sha256";
  } else {
    const cryptoKey = await crypto.subtle.importKey(
      "pkcs8",
      keyData,
      { name: "Ed25519" },
      false,
      ["sign"],
    );
    signature = await crypto.subtle.sign(
      "Ed25519",
      cryptoKey,
      encoder.encode(signingString),
    );
  }
  const signatureB64 = bufToB64(signature);
  const keyId = `${key.id}#main-key`;
  if (style === "cavage" || style === "both") {
    headers.set(
      "Signature",
      `keyId="${keyId}",algorithm="${sigAlg}",headers="${
        headersToSign.join(" ")
      }",signature="${signatureB64}"`,
    );
  }
  if (style === "rfc9421") {
    headers.set("Signature", `sig1=:${signatureB64}:`);
    headers.set(
      "Signature-Input",
      `sig1="${headersToSign.join(" ")}";keyid="${keyId}";alg="${sigAlg}"`,
    );
  }
}

async function signAndPost(
  inboxUrl: string,
  body: string,
  key: { id: string; privateKey: string },
): Promise<Response> {
  const headers = new Headers({
    Accept: "application/activity+json",
    "Content-Type": "application/activity+json",
  });
  await applySignature(
    "POST",
    inboxUrl,
    body,
    key,
    ["(request-target)", "host", "date", "digest"],
    headers,
    "cavage",
  );
  return await fetch(inboxUrl, { method: "POST", headers, body });
}

async function signAndSend(
  inboxUrl: string,
  body: string,
  account: { userName: string; privateKey: string },
  domain: string,
): Promise<Response> {
  const res = await signAndPost(inboxUrl, body, {
    id: `https://${domain}/users/${account.userName}`,
    privateKey: account.privateKey,
  });
  const responseBody = await res.text();

  // Return a new response object because the body has been consumed
  return new Response(responseBody, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

export async function sendActivityPubObject(
  inboxUrl: string,
  object: unknown,
  actor: string,
  domain: string,
  env: Record<string, string> = {},
): Promise<Response> {
  const body = JSON.stringify(object);
  let key: { userName: string; privateKey: string };
  if (actor === "system") {
    const sys = await getSystemKey(createDB(env), domain);
    key = { userName: "system", privateKey: sys.privateKey };
  } else {
    const db = createDB(env);
    const account = await db.findAccountByUserName(actor);
    if (!account || !account.privateKey) {
      throw new Error("actor not found or private key missing");
    }
    key = { userName: actor, privateKey: account.privateKey };
  }

  try {
    return await signAndSend(inboxUrl, body, key, domain);
  } catch (err) {
    console.error(`Failed to send ActivityPub object to ${inboxUrl}:`, err);
    throw err;
  }
}

export async function deliverActivityPubObject(
  targets: string[],
  object: unknown,
  actor: string,
  domain: string,
  env: Record<string, string> = {},
): Promise<void> {
  const isCollection = (url: string): boolean => {
    if (url === "https://www.w3.org/ns/activitystreams#Public") return true;
    try {
      const path = new URL(url).pathname;
      return path.endsWith("/followers") ||
        path.endsWith("/following") ||
        path.endsWith("/outbox") ||
        path.endsWith("/collections") ||
        path.endsWith("/liked") ||
        path.endsWith("/likes");
    } catch {
      return false;
    }
  };
  const deliveryPromises = targets.map(async (addr) => {
    let iri = addr;
    // acct:username@domain または username@domain 形式を解決
    if (!iri.startsWith("http")) {
      const acct = iri.startsWith("acct:") ? iri.slice(5) : iri;
      try {
        const actor = await resolveActorFromAcct(acct);
        if (!actor) throw new Error("acct not found");
        iri = actor.id;
      } catch (err) {
        console.error(`Failed to resolve acct for ${addr}`, err);
        return Promise.resolve();
      }
    }
    if (isCollection(iri)) {
      console.error(`Skip delivery to non-actor URI ${iri}`);
      return Promise.resolve();
    }
    // 受信箱URLが直に渡ってきた場合はそのままPOST
    if (iri.endsWith("/inbox") || iri.endsWith("/sharedInbox")) {
      return sendActivityPubObject(iri, object, actor, domain, env).catch(
        (err) => {
          console.error(`Failed to deliver to inbox URL ${iri}`, err);
        },
      );
    }

    // それ以外はActor IRIとして解決
    try {
      const { inbox, sharedInbox } = await resolveRemoteActor(iri, env);
      const target = sharedInbox ?? inbox;
      if (!target) {
        console.error(`Target ${iri} has no inbox`);
        return Promise.resolve();
      }
      return sendActivityPubObject(target, object, actor, domain, env).catch(
        (err) => {
          console.error(`Failed to deliver to ${iri}`, err);
        },
      );
    } catch (err) {
      console.error(`Failed to resolve remote actor for ${iri}`, err);
    }
    return Promise.resolve();
  });
  await Promise.all(deliveryPromises);
}

export function ensurePem(
  key: string,
  type: "PUBLIC KEY" | "PRIVATE KEY",
): string {
  if (key.includes("BEGIN")) return key;
  const lines = key.match(/.{1,64}/g)?.join("\n") ?? key;
  return `-----BEGIN ${type}-----\n${lines}\n-----END ${type}-----`;
}

function includesSequence(buf: Uint8Array, seq: number[]): boolean {
  outer:
  for (let i = 0; i <= buf.length - seq.length; i++) {
    for (let j = 0; j < seq.length; j++) {
      if (buf[i + j] !== seq[j]) continue outer;
    }
    return true;
  }
  return false;
}

function detectKeyAlgorithm(pem: string): "rsa" | "ed25519" {
  // PEMのヘッダやOIDからRSAかEd25519かを簡易判別する
  // RSA-PSSなど鍵に依存しない署名方式はここでは区別できない
  if (/BEGIN RSA/.test(pem)) return "rsa";
  const buf = new Uint8Array(pemToArrayBuffer(pem));
  const rsaOid = [
    0x06,
    0x09,
    0x2a,
    0x86,
    0x48,
    0x86,
    0xf7,
    0x0d,
    0x01,
    0x01,
    0x01,
  ];
  if (includesSequence(buf, rsaOid)) return "rsa";
  const edOid = [0x06, 0x03, 0x2b, 0x65, 0x70];
  if (includesSequence(buf, edOid)) return "ed25519";
  return "ed25519";
}

/** `Signature` ヘッダを key=value 形式に変換 */
function parseSignatureHeader(header: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const part of header.split(",")) {
    const eqIndex = part.indexOf("=");
    if (eqIndex === -1) continue;
    const k = part.slice(0, eqIndex).trim();
    const v = part.slice(eqIndex + 1).trim();
    params[k] = v.replace(/^"|"$/g, "");
  }
  return params;
}

interface ParsedSignature {
  headers: string[];
  signature: string;
  keyId: string;
  style: "rfc9421" | "cavage";
  params?: string;
}

/** リクエスト/レスポンスから署名情報を抽出 */
export function parseSignature(
  msg: Request | Response,
): ParsedSignature | null {
  const signatureHeader = msg.headers.get("signature");
  if (signatureHeader && !msg.headers.get("signature-input")) {
    const parsed = parseSignatureHeader(signatureHeader);
    if (!parsed.headers || !parsed.signature || !parsed.keyId) return null;
    return {
      headers: parsed.headers.split(" "),
      signature: parsed.signature,
      keyId: parsed.keyId,
      style: "cavage",
    };
  }
  const sigInput = msg.headers.get("signature-input");
  const sig = msg.headers.get("signature");
  if (!sigInput || !sig) return null;
  const m = sigInput.match(/([^=]+)=\(([^)]+)\)(.*)/);
  if (!m) {
    // Signature-Input はあるが形式が不正な場合、Signature ヘッダが cavage 形式で来ている可能性にフォールバック
    const fallback = parseSignatureHeader(sig);
    if (!fallback.headers || !fallback.signature || !fallback.keyId) {
      return null;
    }
    return {
      headers: fallback.headers.split(" "),
      signature: fallback.signature,
      keyId: fallback.keyId,
      style: "cavage",
    };
  }
  const label = m[1];
  const fields = m[2].split(/\s+/).map((s) => s.replace(/\"/g, ""));
  const rest = m[3];
  const keyIdMatch = rest.match(/keyid=\"([^\"]+)\"/);
  const sigMatch = sig.match(new RegExp(`${label}=:(.+):`));
  if (!sigMatch || !keyIdMatch) {
    // Signature-Input があるが Signature が cavage 形式（もしくは label 不一致）の可能性
    const fallback = parseSignatureHeader(sig);
    if (!fallback.headers || !fallback.signature || !fallback.keyId) {
      return null;
    }
    return {
      headers: fallback.headers.split(" "),
      signature: fallback.signature,
      keyId: fallback.keyId,
      style: "cavage",
    };
  }
  return {
    headers: fields,
    signature: sigMatch[1],
    keyId: keyIdMatch[1],
    style: "rfc9421",
    params: `(${m[2]})${rest}`,
  };
}

/** 公開鍵を取得 */
export async function fetchPublicKeyPem(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { accept: "application/activity+json, application/ld+json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.publicKey?.publicKeyPem ?? data.publicKeyPem ?? null;
  } catch {
    return null;
  }
}

/** Digest ヘッダを検証 */
export async function verifyDigest(
  msg: Request | Response,
  body: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(body));
  const expectedB64 = bufToB64(hash);

  const legacy = msg.headers.get("digest");
  if (legacy) {
    if (legacy === `SHA-256=${expectedB64}`) return true;
  }

  const sf = msg.headers.get("content-digest");
  if (sf) {
    const m = sf.match(/sha-256=:(.+):/i);
    if (m && m[1] === expectedB64) return true;
  }
  return false;
}

/** 署名対象文字列を生成 */
export function buildSigningString(
  msg: Request | Response,
  body: string,
  headers: string[],
  style: "rfc9421" | "cavage",
  params?: string,
): string | null {
  const lines: string[] = [];
  if (style === "cavage") {
    const url = new URL((msg as Request).url);
    for (const h of headers) {
      let value: string | null = null;
      if (h === "(request-target)") {
        value = `${
          (msg as Request).method.toLowerCase()
        } ${url.pathname}${url.search}`;
      } else if (h === "host") {
        value = msg.headers.get("x-forwarded-host") ?? msg.headers.get("host");
        if (value === null) value = url.host; // プロキシでHostが失われた場合のフォールバック
      } else if (h === "content-length") {
        const encoder = new TextEncoder();
        value = encoder.encode(body).length.toString();
      } else if (h === "digest") {
        value = msg.headers.get("digest");
        if (value === null) {
          // Content-Digest からのフォールバック（sha-256 のみ対応）
          const sf = msg.headers.get("content-digest");
          const m = sf?.match(/sha-256=:(.+):/i);
          if (m) value = `SHA-256=${m[1]}`;
        }
      } else {
        value = msg.headers.get(h);
      }
      if (value === null) return null;
      lines.push(`${h}: ${value}`);
    }
    return lines.join("\n");
  }
  for (const h of headers) {
    if (h === "@method") {
      if (!(msg instanceof Request)) return null;
      lines.push(`"@method": ${msg.method.toLowerCase()}`);
    } else if (h === "@target-uri") {
      if (!(msg instanceof Request)) return null;
      lines.push(`"@target-uri": ${msg.url}`);
    } else if (h === "@status") {
      if (!(msg instanceof Response)) return null;
      lines.push(`"@status": ${msg.status}`);
    } else if (h === "content-digest") {
      const v = msg.headers.get("content-digest");
      if (v === null) return null;
      lines.push(`"content-digest": ${v}`);
    } else if (h === "content-length") {
      const encoder = new TextEncoder();
      lines.push(`"content-length": ${encoder.encode(body).length}`);
    } else {
      const v = msg.headers.get(h);
      if (v === null) return null;
      lines.push(`${h}: ${v}`);
    }
  }
  if (!params) return null;
  lines.push(`"@signature-params": ${params}`);
  return lines.join("\n");
}

export async function verifyHttpSignature(
  msg: Request | Response,
  body: string,
): Promise<boolean> {
  try {
    const params = parseSignature(msg);
    if (!params) return false;

    const publicKeyPem = await fetchPublicKeyPem(params.keyId);
    if (!publicKeyPem) return false;

    // レスポンス側は Digest/Content-Digest を必須にしない
    // （一部の FASP 実装がレスポンスにダイジェストを付けないため）
    const hasDigestHeader = !!(
      msg.headers.get("content-digest") || msg.headers.get("digest")
    );
    if (hasDigestHeader) {
      if (!await verifyDigest(msg, body)) return false;
    }
    const signingString = buildSigningString(
      msg,
      body,
      params.headers,
      params.style,
      params.params,
    );
    if (!signingString) return false;

    // 公開鍵の正規化（すでにPEM形式の場合はそのまま使用）
    const normalizedPublicKey = publicKeyPem.includes("BEGIN PUBLIC KEY")
      ? publicKeyPem
      : ensurePem(publicKeyPem, "PUBLIC KEY");

    const encoder = new TextEncoder();
    const keyData = pemToArrayBuffer(normalizedPublicKey);
    const alg = detectKeyAlgorithm(normalizedPublicKey);
    const signatureBytes = b64ToBuf(params.signature);
    const signingStringBytes = encoder.encode(signingString);
    if (alg === "rsa") {
      // RSA鍵はRSASSA-PKCS1-v1_5による署名を想定して検証する
      // RSA-PSS署名には現状対応していない
      const key = await crypto.subtle.importKey(
        "spki",
        keyData,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      );
      return await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        key,
        signatureBytes,
        signingStringBytes,
      );
    } else {
      const key = await crypto.subtle.importKey(
        "spki",
        keyData,
        { name: "Ed25519" },
        false,
        ["verify"],
      );
      return await crypto.subtle.verify(
        "Ed25519",
        key,
        signatureBytes,
        signingStringBytes,
      );
    }
  } catch (error) {
    console.error("Error in verifyHttpSignature:", error);
    return false;
  }
}

export function createFollowActivity(
  domain: string,
  actor: string,
  target: string,
) {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `https://${domain}/activities/${crypto.randomUUID()}`,
    type: "Follow",
    actor,
    object: target,
  };
}

export function createUndoFollowActivity(
  domain: string,
  actor: string,
  target: string,
) {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `https://${domain}/activities/${crypto.randomUUID()}`,
    type: "Undo",
    actor,
    object: {
      type: "Follow",
      actor,
      object: target,
    },
  };
}

export function createAcceptActivity(
  domain: string,
  actor: string,
  object: unknown,
) {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `https://${domain}/activities/${crypto.randomUUID()}`,
    type: "Accept",
    actor,
    object,
  };
}

// Like Activity を生成
export function createLikeActivity(
  domain: string,
  actor: string,
  object: string,
) {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `https://${domain}/activities/${crypto.randomUUID()}`,
    type: "Like",
    actor,
    object,
  };
}

// Undo Like Activity を生成
export function createUndoLikeActivity(
  domain: string,
  actor: string,
  object: string,
) {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `https://${domain}/activities/${crypto.randomUUID()}`,
    type: "Undo",
    actor,
    object: {
      type: "Like",
      actor,
      object,
    },
  };
}

export async function fetchActorInbox(
  actorUrl: string,
  env: Record<string, string> = {},
): Promise<string | null> {
  try {
    const data = await fetchJson<{ inbox?: string }>(
      actorUrl,
      {},
      undefined,
      env,
    );
    if (typeof data.inbox === "string") return data.inbox;
  } catch {
    /* ignore */
  }
  return null;
}

export interface ActivityPubActor {
  id: string;
  preferredUsername?: string;
  name?: string;
  icon?: { url?: string };
  summary?: string;
}

/**
 * acct:username@domain 形式からWebFinger経由で正規のActor URLを解決し、ActivityPub Actor情報を取得する。
 * Mastodon等で /users/xxx が404になるのは「ローカルユーザーでないため正常」。
 * 必ずWebFingerでActor URLを発見し、そのURLにAcceptヘッダーを厳密に付与して取得するのが正規ルート。
 * @param acct 例: "takoserver@dev.takos.jp"
 */
export async function resolveActorFromAcct(
  acct: string,
): Promise<ActivityPubActor | null> {
  const [username, domain] = acct.split("@");
  if (!username || !domain) return null;
  const resource = `acct:${username}@${domain}`;
  const wfUrl = `https://${domain}/.well-known/webfinger?resource=${
    encodeURIComponent(resource)
  }`;
  const wfRes = await fetch(wfUrl, {
    headers: { Accept: "application/jrd+json" },
  });
  if (!wfRes.ok) return null;
  const jrd = await wfRes.json();
  const self = jrd.links?.find((l: { rel?: string; type?: string }) =>
    l.rel === "self" && l.type === "application/activity+json"
  );
  if (!self?.href) return null;
  const actorRes = await fetch(self.href, {
    headers: {
      Accept:
        'application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
    },
  });
  if (!actorRes.ok) return null;
  return await actorRes.json();
}

/**
 * 旧API: username, domain指定のまま残すが内部でacct形式に変換して新APIを利用
 */
export function resolveActor(
  username: string,
  domain: string,
): Promise<ActivityPubActor | null> {
  return resolveActorFromAcct(`${username}@${domain}`);
}

export function getDomain(c: Context): string {
  const env = getEnv(c);
  return env["ACTIVITYPUB_DOMAIN"];
}

export function isLocalActor(actorId: string, domain: string): boolean {
  try {
    const url = new URL(actorId);
    return url.hostname === domain && url.pathname.startsWith("/users/");
  } catch {
    return false;
  }
}

export function jsonResponse(
  // deno-lint-ignore no-explicit-any
  c: any,
  // deno-lint-ignore no-explicit-any
  data: any,
  status = 200,
  contentType = "application/json",
) {
  return c.body(JSON.stringify(data), status, {
    "content-type": contentType,
  });
}

/**
 * 任意の Actor ID と秘密鍵で HTTP 署名を付与し POST する。
 * Service Actor など /users/ に属さない Actor 用。
 */
export async function signAndPostAsActor(
  inboxUrl: string,
  body: string,
  actorId: string,
  privateKey: string,
): Promise<Response> {
  return await signAndPost(inboxUrl, body, { id: actorId, privateKey });
}

export function createActor(
  domain: string,
  account: { userName: string; displayName: string; publicKey: string },
  options?: { includeIcon?: boolean },
) {
  const includeIcon = options?.includeIcon ?? true;
  const actor = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/v1",
    ],
    id: `https://${domain}/users/${account.userName}`,
    type: "Person",
    preferredUsername: account.userName,
    name: account.displayName,
    summary: account.displayName,
    url: `https://${domain}/@${account.userName}`,
    icon: {
      type: "Image",
      mediaType: "image/png",
      url: `https://${domain}/users/${account.userName}/avatar`,
    },
    inbox: `https://${domain}/users/${account.userName}/inbox`,
    outbox: `https://${domain}/users/${account.userName}/outbox`,
    followers: `https://${domain}/ap/users/${account.userName}/followers`,
    following: `https://${domain}/ap/users/${account.userName}/following`,
    publicKey: {
      id: `https://${domain}/users/${account.userName}#main-key`,
      owner: `https://${domain}/users/${account.userName}`,
      publicKeyPem: ensurePem(account.publicKey, "PUBLIC KEY"),
    },
  };
  if (!includeIcon) delete actor.icon;
  return actor;
}

export function buildActivityFromStored(
  obj: {
    _id: unknown;
    type: string;
    content: string;
    published: unknown;
    extra: Record<string, unknown>;
    url?: string;
    mediaType?: string;
    name?: string;
  },
  domain: string,
  username: string,
  withContext = false,
) {
  const base: Record<string, unknown> = {
    id: `https://${domain}/objects/${obj._id}`,
    type: obj.type,
    attributedTo: `https://${domain}/users/${username}`,
    content: obj.content,
    published: obj.published instanceof Date
      ? obj.published.toISOString()
      : obj.published,
    ...obj.extra,
  };
  if (obj.url) base.url = obj.url;
  if (obj.mediaType) base.mediaType = obj.mediaType;
  if (obj.name) base.name = obj.name;
  return withContext
    ? { "@context": "https://www.w3.org/ns/activitystreams", ...base }
    : base;
}

// ---- 将来の機能向けユーティリティ ----

/** ActivityPub 用の ID を生成する */
export function createActivityId(domain: string, path = "activities") {
  return `https://${domain}/${path}/${crypto.randomUUID()}`;
}

/** オブジェクト ID を生成する */
export function createObjectId(domain: string, path = "objects") {
  return `https://${domain}/${path}/${crypto.randomUUID()}`;
}

/** Add Activity を生成する */
export function createAddActivity(
  domain: string,
  actor: string,
  object: unknown,
  target?: string,
) {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: createActivityId(domain),
    type: "Add",
    actor,
    object,
    ...(target ? { target } : {}),
  };
}

/** Remove Activity を生成する */
export function createRemoveActivity(
  domain: string,
  actor: string,
  object: unknown,
) {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: createActivityId(domain),
    type: "Remove",
    actor,
    object,
  };
}

/** Block Activity を生成する */
export function createBlockActivity(
  domain: string,
  actor: string,
  object: string,
) {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: createActivityId(domain),
    type: "Block",
    actor,
    object,
  };
}

/** Delete Activity を生成する */
export function createDeleteActivity(
  domain: string,
  actor: string,
  object: unknown,
) {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: createActivityId(domain),
    type: "Delete",
    actor,
    object,
  };
}

/** Create Activity を生成する */
export function createCreateActivity(
  domain: string,
  actor: string,
  object: unknown,
) {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: createActivityId(domain),
    type: "Create",
    actor,
    object,
    to: ["https://www.w3.org/ns/activitystreams#Public"],
    cc: [`https://${domain}/ap/users/${actor.split("/").pop()}/followers`],
  };
}

/** Announce Activity を生成する */
export function createAnnounceActivity(
  domain: string,
  actor: string,
  object: string,
) {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: createActivityId(domain),
    type: "Announce",
    actor,
    object,
  };
}

/* ===== ActivityPub主要実装互換ユーティリティ ===== */

/**
 * Acceptヘッダーを必ず付与してJSON取得
 * Misskey/Mastodon/Pleroma等の404/406対策
 * @param url 取得先URL
 * @param init fetch初期化オプション
 */
export async function fetchJson<T = unknown>(
  url: string,
  init: RequestInit = {},
  signer?: { id: string; privateKey: string },
  env: Record<string, string> = {},
): Promise<T> {
  if (!signer) {
    const domain = env["ACTIVITYPUB_DOMAIN"] || "localhost";
    const sys = await getSystemKey(createDB(env), domain);
    signer = {
      id: `https://${domain}/users/system`,
      privateKey: sys.privateKey,
    };
  }
  const host = new URL(url).host;
  const cache = sigCache.get(host);
  // 既定は Cavage。キャッシュがあれば従う。
  let style: "rfc9421" | "cavage" = cache && cache.expires > Date.now()
    ? cache.style
    : "cavage";
  let triedRfc = style === "rfc9421";
  let triedCavage = style === "cavage";
  let res: Response | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const headers = new Headers(init.headers);
    if (!headers.has("Accept")) {
      headers.set(
        "Accept",
        'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
      );
    }
    await applySignature(
      "GET",
      url,
      "",
      signer!,
      ["(request-target)", "host", "date"],
      headers,
      style,
    );
    res = await fetch(url, { ...init, headers });
    if (res.status === 429) {
      const wait = parseRetryAfter(res.headers.get("Retry-After")) ?? 1000;
      await delay(wait);
      continue;
    }
    if ((res.status === 401 || res.status === 403)) {
      if (style === "rfc9421" && !triedCavage) {
        style = "cavage";
        triedCavage = true;
        continue;
      }
      if (style === "cavage" && !triedRfc) {
        style = "rfc9421";
        triedRfc = true;
        continue;
      }
    }
    break;
  }
  if (!res) res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `fetchJson: ${url} ${res.status} ${res.statusText} ${text}`,
    );
  }
  sigCache.set(host, { style, expires: Date.now() + SIG_CACHE_TTL });
  return await res.json();
}

/**
 * ActivityPubリモートアクター情報
 */
export interface RemoteActor {
  id: string;
  inbox: string;
  sharedInbox?: string;
  publicKeyId: string;
}

/**
 * アクターIRIからinbox/sharedInbox等を抽出
 * sharedInbox > inbox > ldp:inbox の順で優先
 * @param actorIri アクターIRI
 */
interface RemoteActorDocument {
  id: string;
  inbox?: string;
  "ldp:inbox"?: string;
  endpoints?: { sharedInbox?: string };
  publicKey?: { id?: string };
  publicKeyId?: string;
}
export async function resolveRemoteActor(
  actorIri: string,
  env: Record<string, string> = {},
): Promise<RemoteActor> {
  const actor = await fetchJson<RemoteActorDocument>(
    actorIri,
    {},
    undefined,
    env,
  );

  const inbox = actor.endpoints?.sharedInbox ??
    actor.inbox ?? actor["ldp:inbox"];
  if (!inbox) {
    throw new Error("resolveRemoteActor: inbox not found in actor document");
  }

  const publicKeyId = actor.publicKey?.id ?? actor.publicKeyId;
  if (!publicKeyId) {
    throw new Error(
      "resolveRemoteActor: publicKeyId not found in actor document",
    );
  }
  return {
    id: actor.id,
    inbox: inbox as string,
    sharedInbox: actor.endpoints?.sharedInbox,
    publicKeyId,
  };
}

export function extractAttachments(
  obj: Record<string, unknown>,
): { url: string; type: "image" | "video" | "audio" }[] {
  const attachments: { url: string; type: "image" | "video" | "audio" }[] = [];
  const list = (obj.attachment ?? obj.attachments) as unknown;
  if (Array.isArray(list)) {
    for (const item of list) {
      if (typeof item === "string") {
        attachments.push({ url: item, type: "image" });
        continue;
      }
      if (typeof item === "object" && item) {
        const rec = item as Record<string, unknown>;
        const url = typeof rec.url === "string"
          ? rec.url
          : typeof rec.href === "string"
          ? rec.href
          : "";
        if (!url) continue;
        const mediaType = typeof rec.mediaType === "string"
          ? rec.mediaType
          : "";
        const t = typeof rec.type === "string" ? rec.type.toLowerCase() : "";
        let type: "image" | "video" | "audio" = "image";
        if (mediaType.startsWith("video") || t === "video") type = "video";
        else if (mediaType.startsWith("audio") || t === "audio") type = "audio";
        attachments.push({ url, type });
      }
    }
  }
  if (attachments.length === 0 && typeof obj.image === "string") {
    attachments.push({ url: obj.image, type: "image" });
  }
  return attachments;
}
