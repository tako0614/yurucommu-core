import { Hono } from "hono";
import type { Context } from "hono";
import type { Env, Variables } from "../../types.ts";
import { eq } from "drizzle-orm";
import { activities, actorCache, actors } from "../../../db/index.ts";
import {
  activityApId,
  actorApId,
  fetchWithTimeout,
  generateId,
  isLocal,
  isSafeRemoteUrl,
} from "../../federation-helpers.ts";
import { getInstanceActor } from "./query-helpers.ts";
import type { Activity, RemoteActor } from "./inbox-types.ts";
import { getActivityObjectId } from "./inbox-types.ts";
import {
  ActivityPubContractError,
  parseActivity,
  tryParseRemoteActor,
} from "../../lib/activitypub-validators.ts";
import {
  handleGroupCreate,
  handleGroupFollow,
  handleGroupUndo,
} from "./handlers/actor-inbox-handlers.ts";
import {
  handleAccept,
  handleAdd,
  handleAnnounce,
  handleBlock,
  handleCreate,
  handleDelete,
  handleFlag,
  handleFollow,
  handleLike,
  handleMove,
  handleReject,
  handleRemove,
  handleUndo,
  handleUpdate,
} from "./handlers/user-inbox-handlers.ts";

type HonoContext = Context<{ Bindings: Env; Variables: Variables }>;

// Maximum allowed clock skew for HTTP signature validation (5 minutes)
const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000;
const MAX_PAYLOAD_BYTES = 512 * 1024;
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });

type RequestBodyResult =
  | { ok: true; body: string }
  | { ok: false; status: 400 | 413; error: string };

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    for (const byte of chunk) {
      binary += String.fromCharCode(byte);
    }
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function hasSha256Digest(
  digestHeader: string,
  expectedBase64: string,
): boolean {
  for (const part of digestHeader.split(",")) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const algorithm = trimmed.slice(0, separator).trim().toLowerCase();
    const value = trimmed.slice(separator + 1).trim();
    if (algorithm === "sha-256" && value === expectedBase64) {
      return true;
    }
  }
  return false;
}

async function readRequestBodyWithLimit(
  request: Request,
  maxBytes: number,
): Promise<RequestBodyResult> {
  const reader = request.body?.getReader();
  if (!reader) return { ok: true, body: "" };

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      return { ok: false, status: 413, error: "Payload too large" };
    }
    chunks.push(value);
  }

  const bodyBytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bodyBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return { ok: true, body: TEXT_DECODER.decode(bodyBytes) };
  } catch {
    return { ok: false, status: 400, error: "Invalid UTF-8 body" };
  }
}

// ---------------------------------------------------------------------------
// Signature parsing & verification
// ---------------------------------------------------------------------------

function parseSignatureHeader(signatureHeader: string): {
  keyId: string;
  algorithm: string;
  headers: string[];
  signature: string;
} | null {
  const params: Record<string, string> = {};
  const regex = /(\w+)="([^"]+)"/g;
  let match;
  while ((match = regex.exec(signatureHeader)) !== null) {
    params[match[1]] = match[2];
  }

  if (!params.keyId || !params.signature || !params.headers) {
    return null;
  }

  return {
    keyId: params.keyId,
    algorithm: (params.algorithm || "rsa-sha256").toLowerCase(),
    headers: params.headers.trim().toLowerCase().split(/\s+/),
    signature: params.signature,
  };
}

async function fetchActorPublicKey(
  keyId: string,
  c: HonoContext,
): Promise<string | null> {
  if (!isSafeRemoteUrl(keyId)) {
    console.warn(`[HTTP Signature] Blocked unsafe keyId URL: ${keyId}`);
    return null;
  }

  const db = c.get("db");
  const actorUrl = keyId.includes("#") ? keyId.split("#")[0] : keyId;

  const cached = await db.query.actorCache.findFirst({
    where: eq(actorCache.apId, actorUrl),
    columns: { publicKeyPem: true },
  });

  if (cached?.publicKeyPem) {
    return cached.publicKeyPem;
  }

  try {
    const res = await fetchWithTimeout(actorUrl, {
      headers: { "Accept": "application/activity+json, application/ld+json" },
      timeout: 15000,
    });

    if (!res.ok) {
      console.warn(`[HTTP Signature] Failed to fetch actor: ${res.status}`);
      return null;
    }

    const rawActor: unknown = await res.json();
    const actorData = tryParseRemoteActor(rawActor);
    if (!actorData) {
      console.warn(`[HTTP Signature] Invalid actor document at ${actorUrl}`);
      return null;
    }
    if (!actorData.publicKey?.publicKeyPem) {
      console.warn(`[HTTP Signature] Actor has no public key`);
      return null;
    }
    const publicKeyPem = actorData.publicKey.publicKeyPem;

    if (
      actorData.id && actorData.inbox && isSafeRemoteUrl(actorData.id) &&
      isSafeRemoteUrl(actorData.inbox)
    ) {
      const narrowed = actorData as RemoteActor & {
        inbox: string;
        publicKey: { publicKeyPem: string };
      };
      const cacheFields = buildActorCacheFields(narrowed);
      // Upsert: check existence then insert or update
      const existing = await db.query.actorCache.findFirst({
        where: eq(actorCache.apId, actorData.id),
        columns: { apId: true },
      });
      if (existing) {
        await db.update(actorCache).set(cacheFields).where(
          eq(actorCache.apId, actorData.id),
        );
      } else {
        await db.insert(actorCache).values({
          apId: actorData.id,
          ...cacheFields,
        });
      }
    }

    return publicKeyPem;
  } catch (e) {
    console.error(`[HTTP Signature] Error fetching actor:`, e);
    return null;
  }
}

async function verifyHttpSignature(
  c: HonoContext,
  body: string,
): Promise<{ valid: boolean; keyId?: string; error?: string }> {
  const signatureHeader = c.req.header("Signature");
  if (!signatureHeader) {
    return { valid: false, error: "Missing Signature header" };
  }

  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) {
    return { valid: false, error: "Invalid Signature header format" };
  }

  if (!parsed.headers.includes("date")) {
    return { valid: false, error: "date header must be included in signature" };
  }

  // Validate Date header timestamp (prevents replay attacks)
  const dateHeader = c.req.header("date");
  if (!dateHeader) {
    return { valid: false, error: "Missing Date header required by signature" };
  }
  const requestDate = new Date(dateHeader);
  if (isNaN(requestDate.getTime())) {
    return { valid: false, error: "Invalid Date header format" };
  }
  if (Math.abs(Date.now() - requestDate.getTime()) > MAX_SIGNATURE_AGE_MS) {
    return {
      valid: false,
      error: "Request timestamp outside acceptable window",
    };
  }

  if (parsed.algorithm !== "rsa-sha256") {
    return {
      valid: false,
      error: `Unsupported algorithm: ${parsed.algorithm}`,
    };
  }

  if (!parsed.headers.includes("(request-target)")) {
    return { valid: false, error: "(request-target) must be signed" };
  }

  if (!parsed.headers.includes("digest")) {
    return {
      valid: false,
      error:
        "digest header must be included in signature to ensure body integrity",
    };
  }

  // Build the signature string from headers
  const url = new URL(c.req.url);
  const requestTarget = `${url.pathname}${url.search}`;
  const signatureParts: string[] = [];

  for (const headerName of parsed.headers) {
    if (headerName === "(request-target)") {
      signatureParts.push(
        `(request-target): ${c.req.method.toLowerCase()} ${requestTarget}`,
      );
      continue;
    }
    const headerValue = c.req.header(headerName);
    if (!headerValue) {
      return { valid: false, error: `Missing required header: ${headerName}` };
    }
    signatureParts.push(`${headerName}: ${headerValue}`);
  }

  const signatureString = signatureParts.join("\n");

  // Verify body digest
  const digestHeader = c.req.header("digest");
  if (!digestHeader) {
    return {
      valid: false,
      error: "Digest header missing but required by signature",
    };
  }
  const bodyHash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(body),
  );
  const expectedDigest = bufferToBase64(bodyHash);
  if (!hasSha256Digest(digestHeader, expectedDigest)) {
    return { valid: false, error: "Digest mismatch" };
  }

  // Fetch public key and verify
  const publicKeyPem = await fetchActorPublicKey(parsed.keyId, c);
  if (!publicKeyPem) {
    return { valid: false, error: "Could not fetch public key" };
  }

  try {
    const pemContents = publicKeyPem.replace(/-----[^-]+-----/g, "").replace(
      /\s/g,
      "",
    );
    const binaryKey = base64ToBytes(pemContents);
    const cryptoKey = await crypto.subtle.importKey(
      "spki",
      binaryKey.buffer as ArrayBuffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );

    const signatureBytes = base64ToBytes(parsed.signature);
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      signatureBytes.buffer as ArrayBuffer,
      new TextEncoder().encode(signatureString),
    );

    if (!valid) {
      return { valid: false, error: "Signature verification failed" };
    }

    return { valid: true, keyId: parsed.keyId };
  } catch (e) {
    console.error("[HTTP Signature] Verification error:", e);
    return { valid: false, error: "Signature verification error" };
  }
}

// ---------------------------------------------------------------------------
// Shared inbox helpers
// ---------------------------------------------------------------------------

/**
 * Extract the actor URL from a keyId (strips the fragment, e.g. "#main-key").
 */
function signingActorFromKeyId(keyId: string | undefined): string | undefined {
  if (!keyId) return undefined;
  return keyId.includes("#") ? keyId.split("#")[0] : keyId;
}

/**
 * Returns true when the signing key and the activity actor belong to different
 * origins (domain-level key delegation is allowed).
 */
function isActorMismatch(
  signingActorUrl: string | undefined,
  actor: string,
): boolean {
  if (signingActorUrl === actor) return false;
  if (!signingActorUrl) return true;

  try {
    const signingDomain = new URL(signingActorUrl).hostname;
    const actorDomain = new URL(actor).hostname;
    if (signingDomain === actorDomain) {
      console.info(
        `[ActivityPub] Accepting key delegation: signing key ${signingActorUrl} for actor ${actor} (same domain: ${signingDomain})`,
      );
      return false;
    }
  } catch {
    // Invalid URL, treat as mismatch
  }
  return true;
}

type ParsedActivity = {
  activity: Activity;
  activityId: string;
  actor: string;
  activityType: string;
  activityObjectId: string | null;
};

/**
 * Shared pipeline for both inbox endpoints: size check, signature verification,
 * JSON parse, field extraction, and actor-mismatch check. Returns either a
 * parsed result or a Response that should be returned immediately.
 */
async function verifyAndParseInbox(
  c: HonoContext,
  baseUrl: string,
): Promise<ParsedActivity | Response> {
  const contentLengthHeader = c.req.header("content-length");
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (!Number.isInteger(contentLength) || contentLength < 0) {
      return c.json({ error: "Invalid Content-Length" }, 400);
    }
    if (contentLength > MAX_PAYLOAD_BYTES) {
      return c.json({ error: "Payload too large" }, 413);
    }
  }

  const bodyResult = await readRequestBodyWithLimit(
    c.req.raw,
    MAX_PAYLOAD_BYTES,
  );
  if (!bodyResult.ok) {
    return c.json({ error: bodyResult.error }, bodyResult.status);
  }
  const body = bodyResult.body;

  const signatureResult = await verifyHttpSignature(c, body);
  if (!signatureResult.valid) {
    console.warn(
      `[ActivityPub] Signature verification failed: ${signatureResult.error}`,
    );
    return c.json({ error: "Signature verification failed" }, 401);
  }

  let activity: Activity;
  try {
    const parsed: unknown = JSON.parse(body);
    activity = parseActivity(parsed);
  } catch (e) {
    if (e instanceof ActivityPubContractError) {
      console.warn(`[ActivityPub] Rejected activity: ${e.message}`);
      return c.json({ error: "Invalid activity" }, 400);
    }
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const activityId = typeof activity.id === "string"
    ? activity.id
    : activityApId(baseUrl, generateId());
  const actor = typeof activity.actor === "string" ? activity.actor : null;
  const activityType = typeof activity.type === "string" ? activity.type : null;

  if (!actor || !activityType) {
    return c.json({ error: "Invalid activity" }, 400);
  }

  const signingActor = signingActorFromKeyId(signatureResult.keyId);
  if (isActorMismatch(signingActor, actor)) {
    console.warn(
      `[ActivityPub] Actor mismatch: activity actor ${actor} does not match signing key ${signingActor}`,
    );
    return c.json({ error: "Actor mismatch" }, 401);
  }

  return {
    activity,
    activityId,
    actor,
    activityType,
    activityObjectId: getActivityObjectId(activity),
  };
}

/**
 * Check for duplicate activity. Returns true (and sends 202) when the activity
 * already exists; otherwise stores it and returns false.
 */
async function deduplicateAndStoreActivity(
  c: HonoContext,
  { activityId, activityType, actor, activityObjectId, activity }:
    ParsedActivity,
): Promise<Response | null> {
  const db = c.get("db");
  const rawJson = JSON.stringify(activity);

  const existing = await db.query.activities.findFirst({
    where: eq(activities.apId, activityId),
    columns: { rawJson: true },
  });

  if (existing) {
    if (existing.rawJson !== rawJson) {
      console.warn(
        `[ActivityPub] Duplicate activity ${activityId} received with different content`,
      );
    }
    return c.body(null, 202);
  }

  await db.insert(activities).values({
    apId: activityId,
    type: activityType,
    actorApId: actor,
    objectApId: activityObjectId,
    rawJson,
    direction: "inbound",
  });

  return null;
}

// ---------------------------------------------------------------------------
// Remote actor caching
// ---------------------------------------------------------------------------

function buildActorCacheFields(
  actorData: RemoteActor & {
    inbox: string;
    publicKey: { publicKeyPem: string };
  },
) {
  return {
    type: actorData.type || "Person",
    preferredUsername: actorData.preferredUsername,
    name: actorData.name,
    summary: actorData.summary,
    iconUrl: actorData.icon?.url,
    inbox: actorData.inbox,
    publicKeyPem: actorData.publicKey.publicKeyPem,
    rawJson: JSON.stringify(actorData),
  };
}

async function cacheRemoteActor(
  c: HonoContext,
  actorApIdUrl: string,
  baseUrl: string,
): Promise<void> {
  if (isLocal(actorApIdUrl, baseUrl)) return;

  const db = c.get("db");

  const cached = await db.query.actorCache.findFirst({
    where: eq(actorCache.apId, actorApIdUrl),
    columns: { apId: true },
  });
  if (cached) return;

  if (!isSafeRemoteUrl(actorApIdUrl)) {
    console.warn(`[ActivityPub] Blocked unsafe actor fetch: ${actorApIdUrl}`);
    return;
  }

  try {
    const res = await fetchWithTimeout(actorApIdUrl, {
      headers: { "Accept": "application/activity+json, application/ld+json" },
      timeout: 15000,
    });
    if (!res.ok) return;

    const rawActor: unknown = await res.json();
    const actorData = tryParseRemoteActor(rawActor);
    if (!actorData) {
      console.warn(
        `[ActivityPub] Skipping actor cache for ${actorApIdUrl}: invalid actor document`,
      );
      return;
    }
    if (actorData.id !== actorApIdUrl) {
      console.warn(
        `[ActivityPub] Actor ID mismatch: fetched ${actorApIdUrl} but got id ${actorData.id}`,
      );
      return;
    }
    if (!actorData.publicKey?.publicKeyPem) {
      console.warn(
        `[ActivityPub] Skipping actor cache for ${actorApIdUrl}: missing public key`,
      );
      return;
    }
    if (
      !actorData.inbox || !isSafeRemoteUrl(actorData.id) ||
      !isSafeRemoteUrl(actorData.inbox)
    ) {
      return;
    }

    // publicKey.publicKeyPem and inbox are guaranteed by guards above
    const narrowed = actorData as RemoteActor & {
      inbox: string;
      publicKey: { publicKeyPem: string };
    };
    await db.insert(actorCache).values({
      apId: actorData.id,
      ...buildActorCacheFields(narrowed),
    });
  } catch (e) {
    console.error("Failed to cache remote actor:", e);
  }
}

// ---------------------------------------------------------------------------
// User inbox activity dispatch
// ---------------------------------------------------------------------------

/** The Drizzle row type for actors table */
type ActorRow = typeof actors.$inferSelect;

type UserInboxHandler = {
  recipient: ActorRow;
  actor: string;
  baseUrl: string;
};

async function dispatchUserActivity(
  c: HonoContext,
  activityType: string,
  activity: Activity,
  { recipient, actor, baseUrl }: UserInboxHandler,
): Promise<void> {
  switch (activityType) {
    case "Follow":
      await handleFollow(c, activity, recipient, actor, baseUrl);
      break;
    case "Accept":
      await handleAccept(c, activity);
      break;
    case "Undo":
      await handleUndo(c, activity, recipient, actor, baseUrl);
      break;
    case "Like":
      await handleLike(c, activity, recipient, actor, baseUrl);
      break;
    case "Create":
      await handleCreate(c, activity, recipient, actor, baseUrl);
      break;
    case "Delete":
      await handleDelete(c, activity);
      break;
    case "Announce":
      await handleAnnounce(c, activity, recipient, actor, baseUrl);
      break;
    case "Update":
      await handleUpdate(c, activity, actor);
      break;
    case "Reject":
      await handleReject(c, activity);
      break;
    case "Add":
      await handleAdd(c, activity, recipient, actor);
      break;
    case "Remove":
      await handleRemove(c, activity, recipient, actor);
      break;
    case "Block":
      await handleBlock(c, activity, recipient, actor);
      break;
    case "Flag":
      await handleFlag(c, activity, actor);
      break;
    case "Move":
      await handleMove(c, activity, actor);
      break;
    default:
      console.warn(
        `[ActivityPub] Unhandled activity type: ${activityType} from ${actor}`,
      );
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const ap = new Hono<{ Bindings: Env; Variables: Variables }>();

ap.post("/ap/actor/inbox", async (c) => {
  const instActor = await getInstanceActor(c);
  const baseUrl = c.env.APP_URL;

  const result = await verifyAndParseInbox(c, baseUrl);
  if (result instanceof Response) return result;

  const duplicate = await deduplicateAndStoreActivity(c, result);
  if (duplicate) return duplicate;

  const { activity, activityType, actor } = result;

  switch (activityType) {
    case "Follow":
      await handleGroupFollow(
        c,
        activity,
        instActor,
        actor,
        baseUrl,
        result.activityId,
      );
      break;
    case "Undo":
      await handleGroupUndo(c, activity, instActor);
      break;
    case "Create":
      await handleGroupCreate(c, activity, instActor, actor, baseUrl);
      break;
  }

  return c.body(null, 202);
});

ap.post("/ap/users/:username/inbox", async (c) => {
  const db = c.get("db");
  const username = c.req.param("username");
  const baseUrl = c.env.APP_URL;
  const apId = actorApId(baseUrl, username);

  const recipient = await db.query.actors.findFirst({
    where: eq(actors.apId, apId),
  });
  if (!recipient) return c.json({ error: "Actor not found" }, 404);

  const result = await verifyAndParseInbox(c, baseUrl);
  if (result instanceof Response) return result;

  const duplicate = await deduplicateAndStoreActivity(c, result);
  if (duplicate) return duplicate;

  const { activity, activityType, actor } = result;

  await cacheRemoteActor(c, actor, baseUrl);

  await dispatchUserActivity(c, activityType, activity, {
    recipient,
    actor,
    baseUrl,
  });

  return c.body(null, 202);
});

export default ap;
