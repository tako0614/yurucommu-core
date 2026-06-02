import { Hono } from "hono";
import type { Context } from "hono";
import type { Env, Variables } from "../../types.ts";
import { and, eq, inArray } from "drizzle-orm";
import { activities, actorCache, actors, follows } from "../../../db/index.ts";
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
import { logger } from "../../lib/logger.ts";
import { base64ToBytes, bufferToBase64 } from "../../lib/base64.ts";
import { isActorBlocked, isDomainBlocked } from "../../lib/blocklist.ts";
import {
  consumeRateLimitProgrammatic,
  RateLimitConfigs,
} from "../../middleware/rate-limit.ts";
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

const log = logger.child({ component: "activitypub.inbox" });

type HonoContext = Context<{ Bindings: Env; Variables: Variables }>;

// Maximum allowed clock skew for HTTP signature validation (5 minutes)
const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000;
const MAX_PAYLOAD_BYTES = 512 * 1024;
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });

// ---------------------------------------------------------------------------
// Actor public-key cache (TTL + in-flight de-dup + key-rotation detection)
// ---------------------------------------------------------------------------
//
// `fetchActorPublicKey` runs on every inbound activity, so a cold-cache
// thundering herd against a misbehaving peer used to be able to fan out
// `O(activities_received)` HTTP fetches against the same actor URL. We
// dedupe in-flight fetches with a Promise-coalesced cache and refresh
// cached rows once they pass `ACTOR_CACHE_TTL_MS`.
//
// Caveat: `inFlightActorFetches` is a process-local Map. On Cloudflare
// Workers each isolate/replica has its own Map, so this coalescing is a
// best-effort same-isolate optimization, NOT a cross-isolate correctness
// mechanism — a burst spread across isolates can still fan out one fetch per
// isolate. Cross-isolate correctness comes from the persistent `actorCache`
// row (the durable dedup) plus the race-safe `onConflictDoUpdate` upsert
// below; the in-flight Map only trims redundant fetches within one isolate.
//
// Key rotation: when we re-fetch and the actor document advertises a
// different `publicKey.id` than what we have cached, we log it as a
// rotation event so operators can audit (and the new key takes effect
// because we overwrite the cached row).
const ACTOR_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const inFlightActorFetches = new Map<string, Promise<string | null>>();

interface ActorFetchResult {
  publicKeyPem: string;
  publicKeyId: string | null;
}

function isCachedActorFresh(lastFetchedAt: string | null): boolean {
  if (!lastFetchedAt) return false;
  const fetchedTime = Date.parse(lastFetchedAt);
  if (!Number.isFinite(fetchedTime)) return false;
  return Date.now() - fetchedTime < ACTOR_CACHE_TTL_MS;
}

type RequestBodyResult =
  | { ok: true; body: string }
  | { ok: false; status: 400 | 413; error: string };

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
// HTTP Date parsing (RFC 7231 IMF-fixdate, strict)
// ---------------------------------------------------------------------------

const IMF_FIXDATE_RE =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/;

const IMF_MONTH_INDEX: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

function parseImfFixdate(value: string): Date | null {
  const match = IMF_FIXDATE_RE.exec(value);
  if (!match) return null;
  const [, dayStr, monthName, yearStr, hourStr, minuteStr, secondStr] = match;
  const day = Number(dayStr);
  const month = IMF_MONTH_INDEX[monthName];
  const year = Number(yearStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const second = Number(secondStr);

  if (
    !Number.isFinite(day) ||
    !Number.isFinite(year) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    !Number.isFinite(second) ||
    month === undefined
  ) {
    return null;
  }

  const timestamp = Date.UTC(year, month, day, hour, minute, second);
  const date = new Date(timestamp);
  // Reject rollovers (e.g. "32 Jan" -> "1 Feb"): the produced date must
  // round-trip back to the same calendar components.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    return null;
  }
  return date;
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
    log.warn("Blocked unsafe keyId URL", {
      event: "ap.signature.unsafe_key_id",
      keyId,
    });
    return null;
  }

  const db = c.get("db");
  const actorUrl = keyId.includes("#") ? keyId.split("#")[0] : keyId;

  const cached = await db.query.actorCache.findFirst({
    where: eq(actorCache.apId, actorUrl),
    columns: {
      publicKeyPem: true,
      publicKeyId: true,
      lastFetchedAt: true,
    },
  });

  if (cached?.publicKeyPem && isCachedActorFresh(cached.lastFetchedAt)) {
    return cached.publicKeyPem;
  }

  // Coalesce concurrent fetches for the same actor URL. Without this a
  // burst of inbound activities from the same peer would all miss the
  // cache simultaneously and each open its own HTTP fetch.
  const existingFetch = inFlightActorFetches.get(actorUrl);
  if (existingFetch) {
    return await existingFetch;
  }

  const fetchPromise = (async (): Promise<string | null> => {
    try {
      const res = await fetchWithTimeout(actorUrl, {
        headers: { Accept: "application/activity+json, application/ld+json" },
        timeout: 15000,
      });

      if (!res.ok) {
        log.warn("Failed to fetch actor for signature key", {
          event: "ap.signature.actor_fetch_failed",
          keyId,
          actorUrl,
          status: res.status,
        });
        // Fall back to the stale cached key (if any) so a transient
        // upstream failure does not bring federation to a halt.
        return cached?.publicKeyPem ?? null;
      }

      const rawActor: unknown = await res.json();
      const actorData = tryParseRemoteActor(rawActor);
      if (!actorData) {
        log.warn("Invalid actor document for signature key", {
          event: "ap.signature.actor_invalid",
          keyId,
          actorUrl,
        });
        return cached?.publicKeyPem ?? null;
      }
      if (!actorData.publicKey?.publicKeyPem) {
        log.warn("Actor has no public key", {
          event: "ap.actor.no_public_key",
          keyId,
          actorUrl,
          actor: actorData.id,
        });
        return cached?.publicKeyPem ?? null;
      }

      const result: ActorFetchResult = {
        publicKeyPem: actorData.publicKey.publicKeyPem,
        publicKeyId: actorData.publicKey.id ?? null,
      };

      // Key rotation detection: log whenever a fresh fetch produces a
      // different `publicKey.id` (or a different PEM under the same id)
      // than the cached row. This lets operators audit unexpected key
      // changes that might indicate an actor compromise.
      if (cached?.publicKeyPem) {
        const previousKeyId = cached.publicKeyId ?? null;
        const keyIdChanged = result.publicKeyId !== previousKeyId;
        const pemChanged = cached.publicKeyPem !== result.publicKeyPem;
        if (keyIdChanged || pemChanged) {
          log.warn("Detected actor public-key rotation", {
            event: "ap.actor.key_rotation",
            actorUrl,
            previousKeyId,
            newKeyId: result.publicKeyId,
            pemChanged,
          });
        }
      }

      if (
        actorData.id &&
        actorData.inbox &&
        isSafeRemoteUrl(actorData.id) &&
        isSafeRemoteUrl(actorData.inbox)
      ) {
        const narrowed = actorData as RemoteActor & {
          inbox: string;
          publicKey: { publicKeyPem: string };
        };
        const cacheFields = buildActorCacheFields(narrowed);
        // Single atomic upsert. A check-then-insert/update is racy across
        // Worker isolates: two isolates racing the same cold actor can both
        // miss the existence check and then both INSERT, and the loser hits a
        // primary-key violation that would null out a successfully-fetched
        // key and spuriously reject a validly-signed activity.
        // `onConflictDoUpdate` collapses that to one race-safe statement
        // (same pattern as fetchAndCacheRemoteActor in queue-batching.ts).
        await db
          .insert(actorCache)
          .values({ apId: actorData.id, ...cacheFields })
          .onConflictDoUpdate({ target: actorCache.apId, set: cacheFields });
      }

      return result.publicKeyPem;
    } catch (e) {
      log.error("Error fetching actor for signature key", {
        event: "ap.signature.actor_fetch_error",
        keyId,
        actorUrl,
        error: e,
      });
      return cached?.publicKeyPem ?? null;
    } finally {
      inFlightActorFetches.delete(actorUrl);
    }
  })();

  inFlightActorFetches.set(actorUrl, fetchPromise);
  return await fetchPromise;
}

/**
 * Verify the HTTP Signature on a GET request (no body digest required).
 * Returns the resolved signing actor URL on success. Used to gate
 * non-public object reads.
 */
export async function verifyGetHttpSignature(
  c: HonoContext,
): Promise<{ valid: boolean; signingActor?: string; error?: string }> {
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
  if (!parsed.headers.includes("(request-target)")) {
    return { valid: false, error: "(request-target) must be signed" };
  }
  if (parsed.algorithm !== "rsa-sha256") {
    return {
      valid: false,
      error: `Unsupported algorithm: ${parsed.algorithm}`,
    };
  }

  const dateHeader = c.req.header("date");
  if (!dateHeader) {
    return { valid: false, error: "Missing Date header required by signature" };
  }
  const requestDate = parseImfFixdate(dateHeader);
  if (!requestDate) {
    return { valid: false, error: "unable_to_parse_date" };
  }
  if (Math.abs(Date.now() - requestDate.getTime()) > MAX_SIGNATURE_AGE_MS) {
    return {
      valid: false,
      error: "Request timestamp outside acceptable window",
    };
  }

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

  const publicKeyPem = await fetchActorPublicKey(parsed.keyId, c);
  if (!publicKeyPem) {
    return { valid: false, error: "Could not fetch public key" };
  }

  try {
    const pemContents = publicKeyPem
      .replace(/-----[^-]+-----/g, "")
      .replace(/\s/g, "");
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
    return {
      valid: true,
      signingActor: signingActorFromKeyId(parsed.keyId),
    };
  } catch (e) {
    log.error("GET signature verification error", {
      event: "ap.signature.get_verification_error",
      keyId: parsed.keyId,
      error: e,
    });
    return { valid: false, error: "Signature verification error" };
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

  // Validate Date header timestamp (prevents replay attacks). RFC 7231
  // requires IMF-fixdate (e.g. "Sun, 06 Nov 1994 08:49:37 GMT"). We parse
  // strictly to reject ambiguous/locale-dependent inputs that `new Date()`
  // would otherwise accept (rfc850 / asctime / arbitrary strings).
  const dateHeader = c.req.header("date");
  if (!dateHeader) {
    return { valid: false, error: "Missing Date header required by signature" };
  }
  const requestDate = parseImfFixdate(dateHeader);
  if (!requestDate) {
    return { valid: false, error: "unable_to_parse_date" };
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
    const pemContents = publicKeyPem
      .replace(/-----[^-]+-----/g, "")
      .replace(/\s/g, "");
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
    log.error("Signature verification error", {
      event: "ap.signature.verification_error",
      keyId: parsed.keyId,
      error: e,
    });
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
      log.info("Accepting key delegation for same-domain actor", {
        event: "ap.signature.key_delegation_accepted",
        signingActor: signingActorUrl,
        actor,
        domain: signingDomain,
      });
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
    log.warn("Signature verification failed", {
      event: "ap.signature.verification_failed",
      reason: signatureResult.error,
    });
    return c.json({ error: "Signature verification failed" }, 401);
  }

  let activity: Activity;
  try {
    const parsed: unknown = JSON.parse(body);
    activity = parseActivity(parsed);
  } catch (e) {
    if (e instanceof ActivityPubContractError) {
      log.warn("Rejected activity (contract error)", {
        event: "ap.activity.contract_rejected",
        reason: e.message,
      });
      return c.json({ error: "Invalid activity" }, 400);
    }
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const activityId =
    typeof activity.id === "string"
      ? activity.id
      : activityApId(baseUrl, generateId());
  const actor = typeof activity.actor === "string" ? activity.actor : null;
  const activityType = typeof activity.type === "string" ? activity.type : null;

  if (!actor || !activityType) {
    return c.json({ error: "Invalid activity" }, 400);
  }

  const signingActor = signingActorFromKeyId(signatureResult.keyId);
  if (isActorMismatch(signingActor, actor)) {
    log.warn("Actor mismatch between activity and signing key", {
      event: "ap.signature.actor_mismatch",
      actor,
      signingActor,
      keyId: signatureResult.keyId,
    });
    return c.json({ error: "Actor mismatch" }, 401);
  }

  // Central federation blocklist gate. Applied once here so every activity
  // type (Follow / Like / Announce / Undo / content / group inbox / ...) is
  // covered regardless of which handler dispatches it. Blocked traffic is
  // silently discarded with a 202 ACK (never 4xx) — a 4xx would make the
  // sending instance retry on a backoff and keep redelivering blocked
  // traffic. The blocklist helpers fail open on a DB read error (see
  // lib/blocklist.ts), so a transient DB fault never black-holes federation.
  if (await isActivityBlocked(c, actor, activityType)) {
    return c.body(null, 202);
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
 * Return `true` when an inbound activity must be silently discarded because
 * the sending actor (or its domain) is on the operator blocklist. Callers
 * should 202-discard rather than 4xx — federation peers retry 4xx responses
 * on a backoff and would otherwise keep redelivering blocked traffic.
 */
async function isActivityBlocked(
  c: HonoContext,
  actor: string,
  activityType: string,
): Promise<boolean> {
  const db = c.get("db");

  if (await isActorBlocked(db, actor)) {
    log.info("Discarding activity from blocked actor", {
      event: "ap.blocklist.actor_discard",
      actor,
      activityType,
    });
    return true;
  }

  let hostname: string | null = null;
  try {
    hostname = new URL(actor).hostname;
  } catch {
    return false;
  }

  if (await isDomainBlocked(db, hostname)) {
    log.info("Discarding activity from blocked domain", {
      event: "ap.blocklist.domain_discard",
      actor,
      domain: hostname,
      activityType,
    });
    return true;
  }

  return false;
}

/**
 * Check for duplicate activity. Returns true (and sends 202) when the activity
 * already exists; otherwise stores it and returns false.
 */
async function deduplicateAndStoreActivity(
  c: HonoContext,
  {
    activityId,
    activityType,
    actor,
    activityObjectId,
    activity,
  }: ParsedActivity,
): Promise<Response | null> {
  const db = c.get("db");
  const rawJson = JSON.stringify(activity);

  const existing = await db.query.activities.findFirst({
    where: eq(activities.apId, activityId),
    columns: { rawJson: true },
  });

  if (existing) {
    if (existing.rawJson !== rawJson) {
      log.warn("Duplicate activity received with different content", {
        event: "ap.activity.duplicate_content_mismatch",
        activityId,
        activityType,
        actor,
      });
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
    publicKeyId: actorData.publicKey.id ?? null,
    publicKeyPem: actorData.publicKey.publicKeyPem,
    rawJson: JSON.stringify(actorData),
    lastFetchedAt: new Date().toISOString(),
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
    log.warn("Blocked unsafe actor fetch", {
      event: "ap.actor.unsafe_fetch_blocked",
      actor: actorApIdUrl,
    });
    return;
  }

  try {
    const res = await fetchWithTimeout(actorApIdUrl, {
      headers: { Accept: "application/activity+json, application/ld+json" },
      timeout: 15000,
    });
    if (!res.ok) return;

    const rawActor: unknown = await res.json();
    const actorData = tryParseRemoteActor(rawActor);
    if (!actorData) {
      log.warn("Skipping actor cache: invalid actor document", {
        event: "ap.actor.cache_invalid_document",
        actor: actorApIdUrl,
      });
      return;
    }
    if (actorData.id !== actorApIdUrl) {
      log.warn("Actor ID mismatch during cache", {
        event: "ap.actor.cache_id_mismatch",
        actor: actorApIdUrl,
        receivedId: actorData.id,
      });
      return;
    }
    if (!actorData.publicKey?.publicKeyPem) {
      log.warn("Skipping actor cache: missing public key", {
        event: "ap.actor.cache_missing_public_key",
        actor: actorApIdUrl,
      });
      return;
    }
    if (
      !actorData.inbox ||
      !isSafeRemoteUrl(actorData.id) ||
      !isSafeRemoteUrl(actorData.inbox)
    ) {
      return;
    }

    // publicKey.publicKeyPem and inbox are guaranteed by guards above
    const narrowed = actorData as RemoteActor & {
      inbox: string;
      publicKey: { publicKeyPem: string };
    };
    // `onConflictDoNothing` keeps this race-safe: the early `cached` check is
    // best-effort only, so two isolates racing the same cold actor can both
    // reach this insert. Without the conflict clause the loser would throw a
    // primary-key violation; doing nothing on conflict matches the intent
    // (cache only when absent) and avoids the spurious error log.
    await db
      .insert(actorCache)
      .values({
        apId: actorData.id,
        ...buildActorCacheFields(narrowed),
      })
      .onConflictDoNothing();
  } catch (e) {
    log.error("Failed to cache remote actor", {
      event: "ap.actor.cache_failed",
      actor: actorApIdUrl,
      error: e,
    });
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
      log.warn("Unhandled activity type", {
        event: "ap.activity.unhandled_type",
        activityType,
        actor,
      });
  }
}

// ---------------------------------------------------------------------------
// Per-domain inbox throttling
// ---------------------------------------------------------------------------

/**
 * Apply a per-domain rate limit to an already-parsed inbox activity. This
 * runs after signature verification so the bucket key is derived from the
 * authenticated actor hostname rather than a spoofable header. Returns
 * a 429 Response when the domain budget is exhausted.
 */
async function applyInboxDomainRateLimit(
  c: HonoContext,
  actor: string,
): Promise<Response | null> {
  let domain: string;
  try {
    domain = new URL(actor).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!domain) return null;

  const { entry, limited, retryAfter } = await consumeRateLimitProgrammatic(
    c.env.KV,
    RateLimitConfigs.inboxDomain,
    domain,
  );

  c.header(
    "X-RateLimit-Domain-Limit",
    RateLimitConfigs.inboxDomain.maxRequests.toString(),
  );
  c.header(
    "X-RateLimit-Domain-Remaining",
    Math.max(
      0,
      RateLimitConfigs.inboxDomain.maxRequests - entry.count,
    ).toString(),
  );

  if (limited) {
    log.warn("Per-domain inbox throttle exceeded", {
      event: "ap.inbox.domain_rate_limited",
      domain,
      retryAfter,
    });
    c.header("Retry-After", retryAfter.toString());
    return c.json(
      {
        error: "Too many requests from this domain",
        retry_after: retryAfter,
      },
      429,
    );
  }
  return null;
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

  const throttled = await applyInboxDomainRateLimit(c, result.actor);
  if (throttled) return throttled;

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

  const throttled = await applyInboxDomainRateLimit(c, result.actor);
  if (throttled) return throttled;

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

// ---------------------------------------------------------------------------
// Shared inbox (Mastodon convention)
// ---------------------------------------------------------------------------
//
// Both the user actor and the group/instance actor advertise
// `endpoints.sharedInbox = <baseUrl>/ap/inbox`. Mastodon and most large
// servers use sharedInbox as the PRIMARY fan-out delivery target, so a
// federated peer following a yurucommu user delivers Create/Like/Announce/
// Follow/Undo here. This endpoint runs the SAME verify/dedup/store pipeline as
// the per-actor inbox (`verifyAndParseInbox`) and then routes the activity to
// the appropriate local recipients, instead of black-holing it with a bare
// 202.
//
// Recipient resolution: the parsed activity envelope does not carry
// `to`/`cc`/`audience`, so for recipient-scoped activity types we fan out to
// every LOCAL actor that follows the activity actor (the standard sharedInbox
// semantic — the sending server delivers once and the receiving server
// distributes to its own followers). Recipient-independent types (Accept,
// Delete, Update, Reject, Flag, Move) are dispatched exactly once.

// Bound on the number of local followers fanned out per shared-inbox activity,
// so a single delivery cannot trigger an unbounded number of handler runs in
// one request. Local follower sets are small (this is a single-instance
// community app), so this ceiling is generous.
const MAX_SHARED_INBOX_FANOUT = 1000;

// Activity types whose handlers do not depend on the recipient actor; these
// are dispatched once rather than per local follower.
const RECIPIENT_INDEPENDENT_TYPES = new Set([
  "Accept",
  "Delete",
  "Update",
  "Reject",
  "Flag",
  "Move",
]);

/**
 * Resolve the local actor rows that follow `actorApIdValue` (an accepted
 * follow), capped at MAX_SHARED_INBOX_FANOUT. Used to fan a shared-inbox
 * activity out to the local recipients that subscribed to the sending actor.
 */
async function resolveLocalFollowerRecipients(
  c: HonoContext,
  actorApIdValue: string,
  baseUrl: string,
): Promise<ActorRow[]> {
  const db = c.get("db");

  const followerRows = await db
    .select({
      followerApId: follows.followerApId,
    })
    .from(follows)
    .where(
      and(
        eq(follows.followingApId, actorApIdValue),
        eq(follows.status, "accepted"),
      ),
    )
    .limit(MAX_SHARED_INBOX_FANOUT);

  const localFollowerApIds = followerRows
    .map((row) => row.followerApId)
    .filter((apId) => isLocal(apId, baseUrl));
  if (localFollowerApIds.length === 0) return [];

  return await db.query.actors.findMany({
    where: inArray(actors.apId, localFollowerApIds),
  });
}

ap.post("/ap/inbox", async (c) => {
  const baseUrl = c.env.APP_URL;

  const result = await verifyAndParseInbox(c, baseUrl);
  if (result instanceof Response) return result;

  const throttled = await applyInboxDomainRateLimit(c, result.actor);
  if (throttled) return throttled;

  const duplicate = await deduplicateAndStoreActivity(c, result);
  if (duplicate) return duplicate;

  const { activity, activityType, actor } = result;

  await cacheRemoteActor(c, actor, baseUrl);

  if (RECIPIENT_INDEPENDENT_TYPES.has(activityType)) {
    // These handlers ignore the recipient; dispatch once. We pass a synthetic
    // recipient context derived from the activity actor so the handler
    // signature is satisfied without implying a specific local target.
    await dispatchUserActivity(c, activityType, activity, {
      recipient: { apId: actor } as ActorRow,
      actor,
      baseUrl,
    });
    return c.body(null, 202);
  }

  // Recipient-scoped: fan out to every local follower of the sending actor.
  const recipients = await resolveLocalFollowerRecipients(c, actor, baseUrl);
  if (recipients.length === 0) {
    // No local subscribers for this actor. We have still verified + stored
    // the activity (dedup ledger), so this is an honest no-op delivery, not a
    // black hole — a 202 here means "accepted, nothing to route locally".
    log.info("Shared-inbox activity had no local recipients", {
      event: "ap.shared_inbox.no_recipients",
      activityType,
      actor,
    });
    return c.body(null, 202);
  }

  for (const recipient of recipients) {
    // Isolate per-recipient failures: a single local recipient whose handler
    // throws must not abort fan-out to the others or turn the whole shared
    // delivery into a 5xx (which would make the sending peer retry and
    // redeliver to every recipient).
    try {
      await dispatchUserActivity(c, activityType, activity, {
        recipient,
        actor,
        baseUrl,
      });
    } catch (e) {
      log.error("Shared-inbox dispatch failed for one recipient", {
        event: "ap.shared_inbox.dispatch_error",
        activityType,
        actor,
        recipient: recipient.apId,
        error: e,
      });
    }
  }

  return c.body(null, 202);
});

export default ap;
