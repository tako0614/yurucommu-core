// ---------------------------------------------------------------------------
// HTTP Signature verification (companion to ap-signing.ts)
// ---------------------------------------------------------------------------
//
// This is the verification side of HTTP Signatures: actor public-key fetching
// + cache, strict RFC 7231 IMF-fixdate parsing, signature-header parsing, and
// RSA verification. `ap-signing.ts` owns the signing side (generateKeyPair /
// signRequest); together they co-locate all HTTP-signature crypto in one lib.
//
// These functions take a plain `Request` plus a `Database` handle rather than a
// Hono context so the crypto domain stays free of routing types — callers pull
// `c.req.raw` and `c.get("db")` and pass them in.

import { eq } from "drizzle-orm";
import { actorCache } from "../../db/index.ts";
import type { Database } from "../../db/index.ts";
import { fetchWithTimeout, isSafeRemoteUrl } from "../federation-helpers.ts";
import { tryParseRemoteActor } from "./activitypub-validators.ts";
import { buildActorCacheFields } from "./activitypub-actor-cache.ts";
import { logger } from "./logger.ts";
import { base64ToBytes, bufferToBase64 } from "./base64.ts";

const log = logger.child({ component: "activitypub.inbox" });

// Maximum allowed clock skew for HTTP signature validation (5 minutes)
const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000;

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

export function hasSha256Digest(
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

export function parseImfFixdate(value: string): Date | null {
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

export function parseSignatureHeader(signatureHeader: string): {
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

export async function fetchActorPublicKey(
  keyId: string,
  db: Database,
): Promise<string | null> {
  if (!isSafeRemoteUrl(keyId)) {
    log.warn("Blocked unsafe keyId URL", {
      event: "ap.signature.unsafe_key_id",
      keyId,
    });
    return null;
  }

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

      if (actorData.id !== actorUrl) {
        log.warn("Actor ID mismatch during signature key fetch", {
          event: "ap.signature.actor_id_mismatch",
          keyId,
          actorUrl,
          receivedId: actorData.id,
        });
        return cached?.publicKeyPem ?? null;
      }

      if (
        actorData.id &&
        actorData.inbox &&
        isSafeRemoteUrl(actorData.id) &&
        isSafeRemoteUrl(actorData.inbox)
      ) {
        // Reuse the already-fetched signature actor document and write it
        // through the ONE canonical superset cache shape, so this opportunistic
        // upsert populates `outbox` / `followersUrl` / `sharedInbox` identically
        // to every other entry path.
        const cacheFields = buildActorCacheFields(actorData);
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
 * Extract the actor URL from a keyId (strips the fragment, e.g. "#main-key").
 */
function signingActorFromKeyId(keyId: string | undefined): string | undefined {
  if (!keyId) return undefined;
  return keyId.includes("#") ? keyId.split("#")[0] : keyId;
}

/**
 * Verify the HTTP Signature on a GET request (no body digest required).
 * Returns the resolved signing actor URL on success. Used to gate
 * non-public object reads.
 */
export async function verifyGetHttpSignature(
  request: Request,
  db: Database,
): Promise<{ valid: boolean; signingActor?: string; error?: string }> {
  const signatureHeader = request.headers.get("Signature");
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

  const dateHeader = request.headers.get("date");
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

  const url = new URL(request.url);
  const requestTarget = `${url.pathname}${url.search}`;
  const signatureParts: string[] = [];
  for (const headerName of parsed.headers) {
    if (headerName === "(request-target)") {
      signatureParts.push(
        `(request-target): ${request.method.toLowerCase()} ${requestTarget}`,
      );
      continue;
    }
    const headerValue = request.headers.get(headerName);
    if (!headerValue) {
      return { valid: false, error: `Missing required header: ${headerName}` };
    }
    signatureParts.push(`${headerName}: ${headerValue}`);
  }
  const signatureString = signatureParts.join("\n");

  const publicKeyPem = await fetchActorPublicKey(parsed.keyId, db);
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

export async function verifyHttpSignature(
  request: Request,
  db: Database,
  body: string,
): Promise<{ valid: boolean; keyId?: string; error?: string }> {
  const signatureHeader = request.headers.get("Signature");
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
  const dateHeader = request.headers.get("date");
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

  // Require `host` among the signed headers (matching Mastodon's required
  // header set). Without binding `host`, a signature captured for one target
  // could be replayed against a different host — a cross-target replay
  // surface. We also verify below that the signed Host value matches the
  // request URL host so an attacker cannot forward the request elsewhere.
  if (!parsed.headers.includes("host")) {
    return {
      valid: false,
      error: "host header must be included in signature",
    };
  }

  // Build the signature string from headers
  const url = new URL(request.url);
  const requestTarget = `${url.pathname}${url.search}`;

  // The signed Host value must match the host this request was actually
  // delivered to, otherwise a validly-signed request for one origin could be
  // replayed against another target that shares the same actor key.
  const signedHost = request.headers.get("host");
  if (!signedHost) {
    return { valid: false, error: "Missing Host header required by signature" };
  }
  if (signedHost.toLowerCase() !== url.host.toLowerCase()) {
    return { valid: false, error: "Host header does not match request target" };
  }
  const signatureParts: string[] = [];

  for (const headerName of parsed.headers) {
    if (headerName === "(request-target)") {
      signatureParts.push(
        `(request-target): ${request.method.toLowerCase()} ${requestTarget}`,
      );
      continue;
    }
    const headerValue = request.headers.get(headerName);
    if (!headerValue) {
      return { valid: false, error: `Missing required header: ${headerName}` };
    }
    signatureParts.push(`${headerName}: ${headerValue}`);
  }

  const signatureString = signatureParts.join("\n");

  // Verify body digest
  const digestHeader = request.headers.get("digest");
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
  const publicKeyPem = await fetchActorPublicKey(parsed.keyId, db);
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
