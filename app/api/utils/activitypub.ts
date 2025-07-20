import { createDB } from "../db.ts";
import { findAccountByUserName } from "../repositories/account.ts";
import { getEnv } from "../../../shared/config.ts";
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

async function signAndSend(
  inboxUrl: string,
  body: string,
  account: { userName: string; privateKey: string },
  domain: string,
): Promise<Response> {
  const parsedUrl = new URL(inboxUrl);
  const host = parsedUrl.hostname;
  const date = new Date().toUTCString();
  const encoder = new TextEncoder();

  const digestValue = arrayBufferToBase64(
    await crypto.subtle.digest("SHA-256", encoder.encode(body)),
  );
  const digest = `SHA-256=${digestValue}`;

  const fullPath = parsedUrl.pathname + parsedUrl.search;
  const signingString = `(request-target): post ${fullPath}\n` +
    `host: ${host}\n` +
    `date: ${date}\n` +
    `digest: ${digest}`;

  const normalizedPrivateKey = ensurePem(account.privateKey, "PRIVATE KEY");
  const keyData = pemToArrayBuffer(normalizedPrivateKey);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(signingString),
  );

  const signatureB64 = arrayBufferToBase64(signature);
  const keyId = `https://${domain}/users/${account.userName}#main-key`;

  const headers = new Headers({
    "Date": date,
    "Digest": digest,
    "Accept": "application/activity+json",
    "Content-Type": "application/activity+json",
    "User-Agent": `Takos/1.0 (+https://${domain}/)`,
  });
  headers.set(
    "Signature",
    `keyId="${keyId}",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="${signatureB64}"`,
  );
  headers.append("Signature", `sig1=:${signatureB64}:`);
  headers.set(
    "Signature-Input",
    `sig1="(request-target) host date digest";keyid="${keyId}";alg="rsa-v1_5-sha256"`,
  );

  const res = await fetch(inboxUrl, {
    method: "POST",
    headers,
    body,
  });
  console.log(res);
  // Log the response status and body for debugging
  const responseBody = await res.text();
  console.log(`Response from ${inboxUrl}: ${res.status} ${res.statusText}`);
  console.log(`Response body: ${responseBody}`);

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
  let key: { userName: string; privateKey: string } | null = null;
  if (actor === "system") {
    const sys = await getSystemKey(domain);
    key = { userName: "system", privateKey: sys.privateKey };
  } else {
    const account = await findAccountByUserName(env, actor);
    if (!account) throw new Error("actor not found");
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
  const pushHosts = await db.listPushRelays();
  const pushRelays = pushHosts.map((h) => `https://${h}/inbox`);
  const allTargets = [...targets, ...pushRelays];

  const deliveryPromises = allTargets.map(async (iri) => {
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

async function signAndSendFromUrl(
  inboxUrl: string,
  body: string,
  actor: { id: string; privateKey: string },
): Promise<Response> {
  const parsedUrl = new URL(inboxUrl);
  const host = parsedUrl.hostname;
  const date = new Date().toUTCString();
  const encoder = new TextEncoder();

  const digestValue = arrayBufferToBase64(
    await crypto.subtle.digest("SHA-256", encoder.encode(body)),
  );
  const digest = `SHA-256=${digestValue}`;

  const fullPath = parsedUrl.pathname + parsedUrl.search;
  const signingString = `(request-target): post ${fullPath}\n` +
    `host: ${host}\n` +
    `date: ${date}\n` +
    `digest: ${digest}`;

  const normalizedPrivateKey = ensurePem(actor.privateKey, "PRIVATE KEY");
  const keyData = pemToArrayBuffer(normalizedPrivateKey);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(signingString),
  );
  const signatureB64 = arrayBufferToBase64(signature);

  const headers = new Headers({
    Date: date,
    Digest: digest,
    Accept: "application/activity+json",
    "Content-Type": "application/activity+json",
  });
  headers.set(
    "Signature",
    `keyId="${actor.id}#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="${signatureB64}"`,
  );
  headers.append("Signature", `sig1=:${signatureB64}:`);
  headers.set(
    "Signature-Input",
    `sig1="(request-target) host date digest";keyid="${actor.id}#main-key";alg="rsa-v1_5-sha256"`,
  );

  return await fetch(inboxUrl, { method: "POST", headers, body });
}

export async function deliverActivityPubObjectFromUrl(
  targets: string[],
  object: unknown,
  actor: { id: string; privateKey: string },
  env: Record<string, string> = {},
): Promise<void> {
  const body = JSON.stringify(object);
  const promises = targets.map(async (iri) => {
    let target = iri;
    if (!iri.endsWith("/inbox") && !iri.endsWith("/sharedInbox")) {
      try {
        const { inbox, sharedInbox } = await resolveRemoteActor(iri, env);
        target = sharedInbox ?? inbox;
      } catch {
        return;
      }
    }
    try {
      await signAndSendFromUrl(target, body, actor);
    } catch (err) {
      console.error("Delivery failed:", err);
    }
  });
  await Promise.all(promises);
}

export function ensurePem(
  key: string,
  type: "PUBLIC KEY" | "PRIVATE KEY",
): string {
  if (key.includes("BEGIN")) return key;
  const lines = key.match(/.{1,64}/g)?.join("\n") ?? key;
  return `-----BEGIN ${type}-----\n${lines}\n-----END ${type}-----`;
}

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

export async function verifyHttpSignature(
  req: Request,
  body: string,
): Promise<boolean> {
  try {
    const signatureHeader = req.headers.get("signature");
    let params: Record<string, string>;
    if (signatureHeader) {
      params = parseSignatureHeader(signatureHeader);
    } else {
      const sigInput = req.headers.get("signature-input");
      const sig = req.headers.get("signature");
      if (!sigInput || !sig) return false;
      const match = sigInput.match(/([^=]+)="([^"]+)".*keyid="([^"]+)"/);
      if (!match) return false;
      const label = match[1];
      params = {
        headers: match[2],
        signature: sig.match(new RegExp(label + "=:(.+):"))?.[1] ?? "",
        keyId: match[3],
      };
    }
    const publicKeyUrl = params.keyId;

    if (!publicKeyUrl) {
      return false;
    }

    let publicKeyPem = "";
    try {
      const res = await fetch(publicKeyUrl, {
        headers: { accept: "application/activity+json, application/ld+json" },
      });

      if (res.ok) {
        const data = await res.json();
        // より堅牢な公開鍵の取得
        publicKeyPem = data.publicKey?.publicKeyPem ??
          data.publicKeyPem ??
          "";
      } else {
        return false;
      }
    } catch (_error) {
      return false;
    }

    if (!publicKeyPem) {
      return false;
    }

    // Digestの検証
    const digestHeader = req.headers.get("digest");
    if (digestHeader) {
      const encoder = new TextEncoder();
      const expectedDigest = arrayBufferToBase64(
        await crypto.subtle.digest("SHA-256", encoder.encode(body)),
      );
      if (digestHeader !== `SHA-256=${expectedDigest}`) {
        return false;
      }
    }

    const headersList = params.headers.split(" ");
    const url = new URL(req.url);
    const lines: string[] = [];

    for (const h of headersList) {
      let value: string | null = null;
      if (h === "(request-target)") {
        // request-targetにクエリパラメータも含める
        value = `${req.method.toLowerCase()} ${url.pathname}${url.search}`;
      } else if (h === "host") {
        // リバースプロキシ環境では x-forwarded-host を優先
        value = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
      } else if (h === "content-length") {
        // Content-Lengthは実際のボディの長さを使用
        const encoder = new TextEncoder();
        value = encoder.encode(body).length.toString();
      } else {
        value = req.headers.get(h);
      }
      if (value === null) {
        return false;
      }
      lines.push(`${h}: ${value}`);
    }

    const signingString = lines.join("\n");

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
    const sys = await getSystemKey(domain);
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
  const signedInit = { ...init, headers };
  if (signer) {
    const parsedUrl = new URL(url);
    const host = parsedUrl.hostname;
    const date = new Date().toUTCString();
    const fullPath = parsedUrl.pathname + parsedUrl.search;
    const signingString = `(request-target): get ${fullPath}\n` +
      `host: ${host}\n` +
      `date: ${date}`;
    const normalizedPrivateKey = ensurePem(signer.privateKey, "PRIVATE KEY");
    const keyData = pemToArrayBuffer(normalizedPrivateKey);
    const key = await crypto.subtle.importKey(
      "pkcs8",
      keyData,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const encoder = new TextEncoder();
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key,
      encoder.encode(signingString),
    );
    const signatureB64 = arrayBufferToBase64(signature);
    headers.set("Date", date);
    headers.set(
      "Signature",
      `keyId="${signer.id}#main-key",algorithm="rsa-sha256",headers="(request-target) host date",signature="${signatureB64}"`,
    );
    headers.append("Signature", `sig1=:${signatureB64}:`);
    headers.set(
      "Signature-Input",
      `sig1="(request-target) host date";keyid="${signer.id}#main-key";alg="rsa-v1_5-sha256"`,
    );
  }
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

/**
 * ActivityPub配信（inbox/sharedInbox限定POST）
 * @param activity 配信するActivityPubオブジェクト
 * @param recipientActorIri 配信先アクターIRI
 * @param sign HTTP Signature生成関数（Host/Date/Signature付与用）
 */
export async function deliver(
  activity: unknown,
  recipientActorIri: string,
  sign: (options: { url: string; headers: Headers }) => string,
  env: Record<string, string> = {},
): Promise<void> {
  const actor = await resolveRemoteActor(recipientActorIri, env);
  const target = actor.sharedInbox ?? actor.inbox;

  const headers = new Headers({
    "Content-Type": "application/activity+json",
    Host: new URL(target).host,
    Date: new Date().toUTCString(),
  });

  headers.set("Signature", sign({ url: target, headers }));

  const res = await fetch(target, {
    method: "POST",
    headers,
    body: JSON.stringify(activity),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `deliver: ${target} ${res.status} ${res.statusText} ${text}`,
    );
  }
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
