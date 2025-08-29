import { getEnv } from "@takos/config";
import { pemToArrayBuffer } from "@takos/crypto";
import { getSystemKey } from "../services/system_actor.ts";
import type { Context } from "hono";
import { b64ToBuf, bufToB64 } from "@takos/buffer";
import type { DataStore } from "../db/types.ts";

async function applySignature(
  method: string,
  url: string,
  body: string,
  key: { id: string; privateKey: string },
  headersToSign: string[],
  headers: Headers,
): Promise<void> {
  const parsed = new URL(url);
  const authority = parsed.host;
  const date = new Date().toUTCString();
  const encoder = new TextEncoder();

  headers.set("Date", date);

  let contentDigest = "";
  if (headersToSign.includes("content-digest")) {
    const digestValue = bufToB64(
      await crypto.subtle.digest("SHA-256", encoder.encode(body)),
    );
    contentDigest = `sha-256=:${digestValue}:`;
    headers.set("Content-Digest", contentDigest);
  }

  const list = headersToSign.map((h) => `"${h}"`).join(" ");
  const keyId = `${key.id}#main-key`;

  const sigParams = `(${list});keyid="${keyId}"`; // alg は後で付与

  const lines = headersToSign.map((h) => {
    if (h === "@method") {
      return `"@method": ${method.toLowerCase()}`;
    }
    if (h === "@target-uri") {
      return `"@target-uri": ${url}`;
    }
    if (h === "@authority") return `"@authority": ${authority}`;
    if (h === "date") return `date: ${date}`;
    if (h === "content-digest") return `"content-digest": ${contentDigest}`;
    if (h === "content-length") {
      return `"content-length": ${encoder.encode(body).length}`;
    }
    return `${h}: ${headers.get(h) ?? ""}`;
  });

  let signingString = "";
  const normalizedPrivateKey = ensurePem(key.privateKey, "PRIVATE KEY");
  const keyData = pemToArrayBuffer(normalizedPrivateKey);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const sigAlg = "ed25519";
  const finalParams = `${sigParams};alg="${sigAlg}"`;
  lines.push(`"@signature-params": ${finalParams}`);
  signingString = lines.join("\n");
  const signature = await crypto.subtle.sign(
    "Ed25519",
    cryptoKey,
    encoder.encode(signingString),
  );
  headers.set("Signature-Input", `sig1=${finalParams}`);
  const signatureB64 = bufToB64(signature);
  headers.set("Signature", `sig1=:${signatureB64}:`);
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
    ["@method", "@target-uri", "@authority", "date", "content-digest"],
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
  actor: string | { actorId: string; privateKey: string },
  domain: string,
  db: DataStore,
): Promise<Response> {
  const body = JSON.stringify(object);
  if (typeof actor === "string") {
    let key: { userName: string; privateKey: string };
    if (actor === "system") {
      const sys = await getSystemKey(db, domain);
      key = { userName: "system", privateKey: sys.privateKey };
    } else {
      const account = await db.accounts.findByUserName(actor);
      if (!account || !account.privateKey) {
        throw new Error("actor not found or private key missing");
      }
      key = { userName: actor, privateKey: account.privateKey };
    }

    try {
      return await signAndSend(inboxUrl, body, key, domain);
    } catch (err) {
      console.error(
        `Failed to send ActivityPub object to ${inboxUrl}:`,
        err,
      );
      throw err;
    }
  }
  try {
    return await signAndPostAsActor(
      inboxUrl,
      body,
      actor.actorId,
      actor.privateKey,
    );
  } catch (err) {
    console.error(`Failed to send ActivityPub object to ${inboxUrl}:`, err);
    throw err;
  }
}

export async function deliverActivityPubObject(
  targets: string[],
  object: unknown,
  actor: string | { actorId: string; privateKey: string },
  domain: string,
  db: DataStore,
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
    if (!addr.startsWith("http")) {
      console.error(`deliverActivityPubObject: invalid actor IRI ${addr}`);
      return Promise.resolve();
    }
    const iri = addr;
    if (isCollection(iri)) {
      console.error(
        `deliverActivityPubObject: skip non-actor IRI ${iri}`,
      );
      return Promise.resolve();
    }
    if (iri.endsWith("/inbox") || iri.endsWith("/sharedInbox")) {
      console.error(
        `deliverActivityPubObject: actor IRI expected but inbox URL provided ${iri}`,
      );
      return Promise.resolve();
    }
    try {
      const { inbox, sharedInbox } = await resolveRemoteActor(iri);
      const target = sharedInbox ?? inbox;
      if (!target) {
        console.error(
          `deliverActivityPubObject: actor ${iri} has no inbox`,
        );
        return Promise.resolve();
      }
      return sendActivityPubObject(target, object, actor, domain, db).catch(
        (err) => {
          console.error(
            `deliverActivityPubObject: failed to deliver to ${iri}`,
            err,
          );
        },
      );
    } catch (err) {
      console.error(
        `deliverActivityPubObject: failed to resolve ${iri}`,
        err,
      );
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
interface ParsedSignature {
  headers: string[];
  signature: string;
  keyId: string;
  params?: string;
}

/** リクエスト/レスポンスから署名情報を抽出 */
export function parseSignature(
  msg: Request | Response,
): ParsedSignature | null {
  const sigInput = msg.headers.get("signature-input");
  const sig = msg.headers.get("signature");
  if (!sigInput || !sig) return null;
  const m = sigInput.match(/([^=]+)=\(([^)]+)\)(.*)/);
  if (!m) return null;
  const label = m[1];
  const fields = m[2].split(/\s+/).map((s) => s.replace(/\"/g, ""));
  const rest = m[3];
  const keyIdMatch = rest.match(/keyid=\"([^\"]+)\"/);
  const sigMatch = sig.match(new RegExp(`${label}=:(.+):`));
  if (!sigMatch || !keyIdMatch) return null;
  return {
    headers: fields,
    signature: sigMatch[1],
    keyId: keyIdMatch[1],
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
    const data = await res.json() as {
      publicKey?: { publicKeyPem?: string };
      publicKeyPem?: string;
    };
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
  params: string,
): string | null {
  const lines: string[] = [];
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
    } else if (h === "@authority") {
      try {
        const url = new URL(msg.url);
        lines.push(`"@authority": ${url.host}`);
      } catch {
        return null;
      }
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

    // Content-Digest の検証
    if (!await verifyDigest(msg, body)) return false;
    if (!params.params) return false;
    const signingString = buildSigningString(
      msg,
      body,
      params.headers,
      params.params,
    );
    if (!signingString) return false;
    // 公開鍵の正規化（すでにPEM形式の場合はそのまま使用）
    const normalizedPublicKey = publicKeyPem.includes("BEGIN PUBLIC KEY")
      ? publicKeyPem
      : ensurePem(publicKeyPem, "PUBLIC KEY");

    const encoder = new TextEncoder();
    const keyData = pemToArrayBuffer(normalizedPublicKey);
    const signatureBytes = b64ToBuf(params.signature);
    const signingStringBytes = encoder.encode(signingString);
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
): Promise<string | null> {
  try {
    const res = await fetch(actorUrl, {
      headers: {
        Accept:
          'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
      },
    });
    if (!res.ok) return null;
    const data = await res.json() as { inbox?: string };
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
  const jrd = await wfRes.json() as {
    links?: Array<{ rel?: string; type?: string; href?: string }>;
  };
  const self = jrd.links?.find((l) =>
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

export function iriToHandle(iri: string): string {
  try {
    const u = new URL(iri);
    const segments = u.pathname.split("/").filter(Boolean);
    const name = segments[segments.length - 1];
    return `${name}@${u.hostname}`;
  } catch {
    return iri;
  }
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
  const actor: Record<string, unknown> = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/v1",
    ],
    id: `https://${domain}/users/${account.userName}`,
    type: "Person",
    preferredUsername: account.userName,
    name: account.displayName,
    summary: account.displayName,
    url: `https://${domain}/users/${account.userName}`,
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
 * ActivityPubリモートアクター情報
 */
export interface RemoteActor {
  id: string;
  inbox: string;
  sharedInbox?: string;
  publicKeyId: string;
  name?: string;
  preferredUsername?: string;
  icon?: unknown;
  summary?: string;
}

/**
 * アクターIRIからinbox/sharedInbox等を抽出
 * sharedInbox > inbox の順で優先
 * @param actorIri アクターIRI
 */
interface RemoteActorDocument {
  id: string;
  inbox?: string;
  endpoints?: { sharedInbox?: string };
  publicKey?: { id?: string };
  name?: string;
  preferredUsername?: string;
  icon?: unknown;
  summary?: string;
}
export async function resolveRemoteActor(
  actorIri: string,
): Promise<RemoteActor> {
  const res = await fetch(actorIri, {
    headers: {
      Accept:
        'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
    },
  });
  if (!res.ok) {
    throw new Error(
      `resolveRemoteActor: ${res.status} ${res.statusText}`,
    );
  }
  const actor: RemoteActorDocument = await res.json();

  const inbox = actor.endpoints?.sharedInbox ?? actor.inbox;
  if (!inbox) {
    throw new Error(
      "resolveRemoteActor: actorドキュメントにinboxまたはendpoints.sharedInboxが見つかりません",
    );
  }

  const publicKeyId = actor.publicKey?.id;
  if (!publicKeyId) {
    throw new Error(
      "resolveRemoteActor: actorドキュメントにpublicKey.idが見つかりません",
    );
  }
  return {
    id: actor.id,
    inbox: inbox as string,
    sharedInbox: actor.endpoints?.sharedInbox,
    publicKeyId,
    name: actor.name,
    preferredUsername: actor.preferredUsername,
    icon: actor.icon,
    summary: actor.summary,
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
