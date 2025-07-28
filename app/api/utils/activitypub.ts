import { createDB } from "../DB/mod.ts";
import { getEnv } from "../../shared/config.ts";
import { getSystemKey } from "../services/system_actor.ts";
import type { Context } from "hono";

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return base64ToArrayBuffer(b64);
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function applySignature(
  method: string,
  url: string,
  body: string,
  key: { id: string; privateKey: string },
  headersToSign: string[],
  headers: Headers,
): Promise<void> {
  const parsed = new URL(url);
  const host = parsed.hostname;
  const date = new Date().toUTCString();
  const encoder = new TextEncoder();

  headers.set("Date", date);

  let digest = "";
  if (headersToSign.includes("digest")) {
    const digestValue = arrayBufferToBase64(
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
    encoder.encode(signingString),
  );
  const signatureB64 = arrayBufferToBase64(signature);
  const keyId = `${key.id}#main-key`;
  headers.set(
    "Signature",
    `keyId="${keyId}",algorithm="rsa-sha256",headers="${
      headersToSign.join(" ")
    }",signature="${signatureB64}"`,
  );
  headers.append("Signature", `sig1=:${signatureB64}:`);
  headers.set(
    "Signature-Input",
    `sig1="${headersToSign.join(" ")}";keyid="${keyId}";alg="rsa-v1_5-sha256"`,
  );
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
  const db = createDB(env);
  const relayHosts = await db.listRelays();
  const relayTargets = relayHosts.map((h: string) => `https://${h}/inbox`);
  const allTargets = [...targets, ...relayTargets];

  const deliveryPromises = allTargets.map(async (addr) => {
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

/** リクエストから署名情報を抽出 */
export function parseSignature(req: Request): Record<string, string> | null {
  const signatureHeader = req.headers.get("signature");
  if (signatureHeader && !req.headers.get("signature-input")) {
    return parseSignatureHeader(signatureHeader);
  }
  const sigInput = req.headers.get("signature-input");
  const sig = req.headers.get("signature");
  if (!sigInput || !sig) return null;
  const match = sigInput.match(/([^=]+)="([^"]+)".*keyid="([^"]+)"/);
  if (!match) return null;
  const label = match[1];
  return {
    headers: match[2],
    signature: sig.match(new RegExp(label + "=:(.+):"))?.[1] ?? "",
    keyId: match[3],
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
  req: Request,
  body: string,
): Promise<boolean> {
  const digestHeader = req.headers.get("digest");
  if (!digestHeader) return true;
  const encoder = new TextEncoder();
  const expectedDigest = arrayBufferToBase64(
    await crypto.subtle.digest("SHA-256", encoder.encode(body)),
  );
  return digestHeader === `SHA-256=${expectedDigest}`;
}

/** 署名対象文字列を生成 */
export function buildSigningString(
  req: Request,
  body: string,
  headers: string[],
): string | null {
  const url = new URL(req.url);
  const lines: string[] = [];
  for (const h of headers) {
    let value: string | null = null;
    if (h === "(request-target)") {
      value = `${req.method.toLowerCase()} ${url.pathname}${url.search}`;
    } else if (h === "host") {
      value = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    } else if (h === "content-length") {
      const encoder = new TextEncoder();
      value = encoder.encode(body).length.toString();
    } else {
      value = req.headers.get(h);
    }
    if (value === null) return null;
    lines.push(`${h}: ${value}`);
  }
  return lines.join("\n");
}

export async function verifyHttpSignature(
  req: Request,
  body: string,
): Promise<boolean> {
  try {
    const params = parseSignature(req);
    if (!params) return false;

    const publicKeyPem = await fetchPublicKeyPem(params.keyId);
    if (!publicKeyPem) return false;

    if (!await verifyDigest(req, body)) return false;

    const headersList = params.headers.split(" ");
    const signingString = buildSigningString(req, body, headersList);
    if (!signingString) return false;

    // 公開鍵の正規化（すでにPEM形式の場合はそのまま使用）
    const normalizedPublicKey = publicKeyPem.includes("BEGIN PUBLIC KEY")
      ? publicKeyPem
      : ensurePem(publicKeyPem, "PUBLIC KEY");

    const encoder = new TextEncoder();
    const keyData = pemToArrayBuffer(normalizedPublicKey);

    const key = await crypto.subtle.importKey(
      "spki",
      keyData,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );

    const signatureBytes = base64ToArrayBuffer(params.signature);
    const signingStringBytes = encoder.encode(signingString);

    const verified = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      signatureBytes,
      signingStringBytes,
    );
    return verified;
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

export function createActor(
  domain: string,
  account: { userName: string; displayName: string; publicKey: string },
) {
  return {
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
    followers: `https://${domain}/users/${account.userName}/followers`,
    following: `https://${domain}/users/${account.userName}/following`,
    publicKey: {
      id: `https://${domain}/users/${account.userName}#main-key`,
      owner: `https://${domain}/users/${account.userName}`,
      publicKeyPem: ensurePem(account.publicKey, "PUBLIC KEY"),
    },
    // 任意の拡張プロパティ
    keyPackages: undefined as unknown,
  };
}

export function buildActivityFromStored(
  obj: {
    _id: unknown;
    type: string;
    content: string;
    published: unknown;
    extra: Record<string, unknown>;
  },
  domain: string,
  username: string,
  withContext = false,
) {
  const base = {
    id: `https://${domain}/objects/${obj._id}`,
    type: obj.type,
    attributedTo: `https://${domain}/users/${username}`,
    content: obj.content,
    published: obj.published instanceof Date
      ? obj.published.toISOString()
      : obj.published,
    ...obj.extra,
  };
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
) {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: createActivityId(domain),
    type: "Add",
    actor,
    object,
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
    cc: [`https://${domain}/users/${actor.split("/").pop()}/followers`],
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
  const headers = new Headers(init.headers);
  if (!headers.has("Accept")) {
    headers.set(
      "Accept",
      'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
    );
  }
  if (signer) {
    await applySignature(
      "GET",
      url,
      "",
      signer,
      ["(request-target)", "host", "date"],
      headers,
    );
  }
  const signedInit = { ...init, headers };
  const res = await fetch(url, signedInit);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `fetchJson: ${url} ${res.status} ${res.statusText} ${text}`,
    );
  }
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
