import { Hono } from "hono";
import type { Context } from "hono";
import type { Env, Variables } from "../../types.ts";
import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import {
  activities,
  actorCache,
  actors,
  affectedRowCount,
  inboundActivityClaims,
} from "../../../db/index.ts";
import {
  activityApId,
  actorApId,
  generateId,
  isLocal,
  isSafeRemoteUrl,
} from "../../federation-helpers.ts";
import { sha256Hex } from "../../lib/delivery/transformers.ts";
import { getInstanceActor, loadFederatedCommunity } from "./query-helpers.ts";
import { communityApId } from "../../lib/ap-ids.ts";
import { isTrustedRemoteActivityId } from "../../lib/remote-activity-id.ts";
import type { Activity } from "./inbox-types.ts";
import {
  getActivityObject,
  getActivityObjectId,
  typeIncludes,
} from "./inbox-types.ts";
import { findFollowByActivityId } from "./handlers/inbox-shared-helpers.ts";
import {
  ACTIVITY_ADDRESSING,
  isHandledActivityType,
  resolveAddressedRecipients,
  type HandledActivityType,
} from "./inbox-addressing.ts";
import {
  ActivityPubContractError,
  parseActivity,
} from "../../lib/activitypub-validators.ts";
import {
  fetchAndUpsertActorCache,
  getInstanceFetchSignerByDb,
} from "../../lib/activitypub-actor-cache.ts";
import { logger } from "../../lib/logger.ts";
import { verifyHttpSignature } from "../../lib/ap-verify.ts";
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

const MAX_PAYLOAD_BYTES = 512 * 1024;
const INBOUND_DISPATCH_LEASE_MS = 2 * 60 * 1000;
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });

type RequestBodyResult =
  { ok: true; body: string } | { ok: false; status: 400 | 413; error: string };

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
// Shared inbox helpers
// ---------------------------------------------------------------------------

/**
 * Extract the actor URL from a keyId (strips the fragment, e.g. "#main-key").
 */
export function signingActorFromKeyId(
  keyId: string | undefined,
): string | undefined {
  if (!keyId) return undefined;
  return keyId.includes("#") ? keyId.split("#")[0] : keyId;
}

/**
 * Normalize an actor URL for identity comparison: lowercase the host (host names
 * are case-insensitive) and drop a single trailing slash + any fragment, leaving
 * the (case-sensitive) path intact. Used to compare the signing-key owner with
 * the activity actor without rejecting cosmetically-different-but-identical IRIs
 * (trailing slash / host case) that conformant peers occasionally emit. Returns
 * null for an unparseable URL.
 */
function normalizeActorUrl(url: string): string | null {
  try {
    const u = new URL(url);
    u.hash = "";
    let normalized = `${u.protocol}//${u.host}${u.pathname}${u.search}`;
    if (normalized.endsWith("/")) normalized = normalized.slice(0, -1);
    return normalized;
  } catch {
    return null;
  }
}

/**
 * Returns true when the HTTP-signature signing key does NOT belong to exactly
 * the activity actor (after URL normalization).
 *
 * SECURITY (#1 — same-host key-delegation impersonation): the signature is
 * verified against the key published by the keyId's OWNER, and every per-type
 * handler then authorizes purely on the activity `actor` string. So this binding
 * is the ONLY thing tying the verified key to the claimed actor — it must be an
 * EXACT identity match. An earlier version accepted any signer sharing the same
 * URL host as the actor ("domain-level key delegation"). On a multi-user remote
 * host that let an attacker who controls one key (`alice#main-key`) sign an
 * activity claiming `actor=victim` on the same host and have it accepted AS the
 * victim — cross-actor impersonation (forged Delete, DM-as-victim, Move-based
 * follower theft, etc.). Mastodon/Lemmy bind keyId-owner === activity.actor
 * exactly, so this matches the fediverse norm.
 *
 * The only legitimate cross-actor case is a remote instance/server actor (type
 * Application/Service) signing a FORWARDED activity on behalf of one of its
 * users (ActivityPub §7.1.2 inbox forwarding). That is safe ONLY when the
 * forwarded object's integrity is independently re-verified (an LD-signature on
 * the object, or re-fetching it from its origin). This codebase performs no such
 * re-verification anywhere, so we reject cross-actor delegation outright rather
 * than trust an unverified relayed envelope.
 */
export function isActorMismatch(
  signingActorUrl: string | undefined,
  actor: string,
): boolean {
  if (!signingActorUrl) return true;
  if (signingActorUrl === actor) return false;

  const normalizedSigner = normalizeActorUrl(signingActorUrl);
  const normalizedActor = normalizeActorUrl(actor);
  if (
    normalizedSigner !== null &&
    normalizedActor !== null &&
    normalizedSigner === normalizedActor
  ) {
    return false;
  }
  return true;
}

type ParsedActivity = {
  activity: Activity;
  /** Origin-bound, fixed-size internal ledger identifier. */
  activityId: string;
  /** Bounded protocol identifier to echo in Accept/Reject objects. */
  sourceActivityId: string;
  /** Original, request-size-bounded envelope retained for audit/debugging. */
  rawActivityJson: string;
  actor: string;
  activityType: string;
  activityObjectId: string | null;
};

async function internalInboundActivityId(
  baseUrl: string,
  actor: string,
  source: string,
): Promise<string> {
  const actorIdentity = normalizeActorUrl(actor) ?? actor;
  return activityApId(
    baseUrl,
    `inbound-${await sha256Hex(`${actorIdentity}\0${source}`)}`,
  );
}

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

  const signatureResult = await verifyHttpSignature(
    c.req.raw,
    c.get("db"),
    body,
  );
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

  const actor = typeof activity.actor === "string" ? activity.actor : null;
  const activityType = typeof activity.type === "string" ? activity.type : null;

  if (!actor || !activityType) {
    return c.json({ error: "Invalid activity" }, 400);
  }

  // A peer controls Activity.id. Never use that unbounded string as our primary
  // key, queue key, or structured-log identifier. First validate the protocol
  // id against the signature-bound actor origin, then derive a fixed-size local
  // id from actor + source. The original envelope remains in rawJson (bounded by
  // MAX_PAYLOAD_BYTES) for protocol evidence.
  const rawActivityId = typeof activity.id === "string" ? activity.id : null;
  const trustedActivityId =
    rawActivityId !== null &&
    isTrustedRemoteActivityId(rawActivityId, actor, baseUrl)
      ? rawActivityId
      : null;
  const identitySource =
    trustedActivityId !== null
      ? trustedActivityId
      : `synthetic:${await sha256Hex(
          `${actor}\0${activityType}\0${getActivityObjectId(activity) ?? ""}\0${body}`,
        )}`;
  const activityId = await internalInboundActivityId(
    baseUrl,
    actor,
    identitySource,
  );
  // Only a safe, actor-owned wire id may cross back out in an Accept/Reject.
  // When the peer omitted or supplied an unsafe id, use our stable retained
  // ledger IRI instead of leaking an invalid `synthetic:<hash>` pseudo-IRI.
  const sourceActivityId = trustedActivityId ?? activityId;

  // Handlers persist activity ids on interaction/follow edges. Stamp the
  // canonical internal id before dispatch so no remote string escapes into
  // those internal keys. Undo references are normalized through the same
  // source-id lookup in the Undo helpers and therefore still resolve.
  activity.id = activityId;

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
    sourceActivityId,
    rawActivityJson: body,
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

// `processed` ledger values for an inbound activity row:
//   0 = stored, dispatch not yet committed (newly inserted, or a prior dispatch
//       threw — such a row is RE-DISPATCHABLE so a peer retry completes it)
//   1 = dispatch effects committed successfully (terminal; suppresses re-dispatch)
//   2 = UNDELIVERABLE: the activity named no local recipient we could resolve.
//       Terminal for dedup purposes, but distinguished from 1 so this class of
//       failure is countable (`SELECT count(*) FROM activities WHERE
//       processed = 2`) instead of being indistinguishable from a successful
//       no-op — which is exactly how "every DM from a non-follower is dropped"
//       stayed invisible. The route answers 422 for these so the peer learns
//       the delivery failed rather than reading a 202.
// The column is INTEGER with no CHECK constraint and no value-keyed index, so
// adding the third value needs no migration.
const PROCESSED_UNPROCESSED = 0;
const PROCESSED_DONE = 1;
const PROCESSED_UNDELIVERABLE = 2;

/**
 * A request that owns dispatch for an inbound activity. After running the
 * handler the caller MUST call `commitActivityDispatch` on success so a
 * subsequent (re)delivery is suppressed. On handler failure the caller does
 * nothing extra: the row stays `processed = 0`, so a peer retry re-dispatches
 * and completes the effect instead of being permanently black-holed by the
 * dedup row.
 */
type ActivityDispatchClaim = {
  activityId: string;
  activityType: string;
  actor: string;
  processingToken: string;
};

/**
 * Dedup + claim. Stores the inbound activity (idempotent on the `apId` primary
 * key) and decides whether THIS request must dispatch. Returns either:
 *   - a `Response` (202) when the activity must NOT be dispatched (a concurrent
 *     delivery already created the row, or a prior delivery already committed
 *     `processed = 1`); or
 *   - an `ActivityDispatchClaim` when this request owns dispatch.
 *
 * Idempotency model: `apId` is the primary key, so `onConflictDoNothing` makes
 * the dedup insert atomic — exactly one concurrent delivery of the same
 * activity creates the row (and gets a non-null returned row → owns dispatch);
 * the rest get a null row. This is what keeps a genuine concurrent double
 * delivery (shared inbox + per-actor inbox racing) from applying the effect
 * twice or 500'ing on a PK violation.
 *
 * Retry-after-failure fix (#9): the dedup row is no longer unconditionally
 * suppressing. When this request LOST the insert (row already exists), we only
 * suppress if that row is already `processed = 1` (a committed prior dispatch).
 * If the existing row is still `processed = 0` — i.e. a prior dispatch threw
 * mid-effect and never committed — we re-claim it so the peer's retry completes
 * the half-applied activity exactly once (the commit flips it to `1`, after
 * which any further redelivery is suppressed).
 */
async function claimActivityForDispatch(
  c: HonoContext,
  {
    activityId,
    activityType,
    actor,
    activityObjectId,
    rawActivityJson,
  }: ParsedActivity,
): Promise<Response | ActivityDispatchClaim> {
  const db = c.get("db");

  // Persist the dedup ledger and ensure its claim row exists. A crash between
  // these idempotent inserts is harmless: the next delivery creates whichever
  // row is absent before attempting the fenced claim.
  await db
    .insert(activities)
    .values({
      apId: activityId,
      type: activityType,
      actorApId: actor,
      objectApId: activityObjectId,
      rawJson: rawActivityJson,
      direction: "inbound",
      processed: PROCESSED_UNPROCESSED,
    })
    .onConflictDoNothing();
  await db
    .insert(inboundActivityClaims)
    .values({ activityApId: activityId })
    .onConflictDoNothing();

  const existing = await db.query.activities.findFirst({
    where: eq(activities.apId, activityId),
    columns: { processed: true },
  });

  if (!existing || existing.processed !== PROCESSED_UNPROCESSED) {
    log.info("Duplicate activity skipped", {
      event: "ap.activity.duplicate_skipped",
      activityId,
      activityType,
      actor,
    });
    return c.body(null, 202);
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const processingToken = generateId();
  const leaseExpiresAt = new Date(
    now.getTime() + INBOUND_DISPATCH_LEASE_MS,
  ).toISOString();
  const claimed = await db
    .update(inboundActivityClaims)
    .set({
      processingToken,
      leaseExpiresAt,
      updatedAt: nowIso,
    })
    .where(
      and(
        eq(inboundActivityClaims.activityApId, activityId),
        or(
          isNull(inboundActivityClaims.processingToken),
          lte(inboundActivityClaims.leaseExpiresAt, nowIso),
        ),
      ),
    );

  if (affectedRowCount(claimed) === 0) {
    // Another delivery is actively dispatching this activity. ACK the duplicate
    // rather than running the handler concurrently; the owner returns 5xx and
    // releases the claim if its dispatch fails.
    return c.body(null, 202);
  }

  return { activityId, activityType, actor, processingToken };
}

/**
 * Mark a claimed activity's dispatch as terminally complete. Called after the
 * handler effects commit successfully so any subsequent (re)delivery is
 * suppressed by `claimActivityForDispatch`.
 */
async function commitActivityDispatch(
  c: HonoContext,
  claim: ActivityDispatchClaim,
  state:
    typeof PROCESSED_DONE | typeof PROCESSED_UNDELIVERABLE = PROCESSED_DONE,
): Promise<void> {
  const db = c.get("db");
  const committed = await db
    .update(activities)
    .set({ processed: state })
    .where(
      and(
        eq(activities.apId, claim.activityId),
        sql`EXISTS (
          SELECT 1 FROM ${inboundActivityClaims}
          WHERE ${inboundActivityClaims.activityApId} = ${claim.activityId}
            AND ${inboundActivityClaims.processingToken} = ${claim.processingToken}
        )`,
      ),
    );
  if (affectedRowCount(committed) === 0) {
    throw new Error("Inbound activity dispatch lease was lost before commit");
  }
  await db
    .update(inboundActivityClaims)
    .set({
      processingToken: null,
      leaseExpiresAt: null,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(inboundActivityClaims.activityApId, claim.activityId),
        eq(inboundActivityClaims.processingToken, claim.processingToken),
      ),
    );
}

async function releaseActivityDispatch(
  c: HonoContext,
  claim: ActivityDispatchClaim,
): Promise<void> {
  await c
    .get("db")
    .update(inboundActivityClaims)
    .set({
      processingToken: null,
      leaseExpiresAt: null,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(inboundActivityClaims.activityApId, claim.activityId),
        eq(inboundActivityClaims.processingToken, claim.processingToken),
      ),
    );
}

async function retryableDispatchFailure(
  c: HonoContext,
  claim: ActivityDispatchClaim,
): Promise<Response> {
  await releaseActivityDispatch(c, claim);
  c.header("Retry-After", "30");
  return c.json({ error: "Activity dispatch temporarily failed" }, 503);
}

// ---------------------------------------------------------------------------
// Remote actor caching
// ---------------------------------------------------------------------------

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

  // `mode: "insert"` keeps this cache-when-absent and race-safe: the early
  // `cached` check above is best-effort only, so two isolates racing the same
  // cold actor can both reach the insert, and `onConflictDoNothing` avoids a
  // spurious primary-key-violation error.
  const result = await fetchAndUpsertActorCache(db, actorApIdUrl, {
    timeout: 15000,
    mode: "insert",
    publicKey: "require-key",
    // Sign as the instance actor so a secure-mode remote serves its doc.
    signer: (await getInstanceFetchSignerByDb(db)) ?? undefined,
  });
  if (result.ok) return;

  switch (result.reason) {
    case "invalid_document":
      log.warn("Skipping actor cache: invalid actor document", {
        event: "ap.actor.cache_invalid_document",
        actor: actorApIdUrl,
      });
      break;
    case "id_mismatch":
      log.warn("Actor ID mismatch during cache", {
        event: "ap.actor.cache_id_mismatch",
        actor: actorApIdUrl,
      });
      break;
    case "missing_public_key":
      log.warn("Skipping actor cache: missing public key", {
        event: "ap.actor.cache_missing_public_key",
        actor: actorApIdUrl,
      });
      break;
    case "fetch_failed":
      log.error("Failed to cache remote actor", {
        event: "ap.actor.cache_failed",
        actor: actorApIdUrl,
      });
      break;
    // `fetch_not_ok` and `missing_inbox` were silently skipped before.
    default:
      break;
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
  sourceActivityId: string;
};

async function dispatchUserActivity(
  c: HonoContext,
  activityType: string,
  activity: Activity,
  { recipient, actor, baseUrl, sourceActivityId }: UserInboxHandler,
): Promise<void> {
  switch (activityType) {
    case "Follow":
      await handleFollow(
        c,
        activity,
        recipient,
        actor,
        baseUrl,
        sourceActivityId,
      );
      break;
    case "Accept":
      await handleAccept(c, activity, actor);
      break;
    case "Undo":
      await handleUndo(c, activity, recipient, actor, baseUrl);
      break;
    case "Like":
      await handleLike(c, activity, actor, baseUrl);
      break;
    case "Create":
      await handleCreate(c, activity, recipient, actor, baseUrl);
      break;
    case "Delete":
      await handleDelete(c, activity);
      break;
    case "Announce":
      await handleAnnounce(c, activity, actor, baseUrl);
      break;
    case "Update":
      await handleUpdate(c, activity, actor);
      break;
    case "Reject":
      await handleReject(c, activity, actor);
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

/**
 * Dispatch an activity whose handler resolves its own target — no delivery
 * recipient is involved. This is the ONLY path for the `instance` addressing
 * class (see inbox-addressing.ts) and it takes no `ActorRow`, so the synthetic
 * `{ apId: actor } as ActorRow` the shared inbox used to fabricate cannot be
 * constructed: a handler that genuinely needs a recipient will not typecheck
 * here.
 */
async function dispatchInstanceActivity(
  c: HonoContext,
  activityType: HandledActivityType,
  activity: Activity,
  actor: string,
  baseUrl: string,
): Promise<void> {
  switch (activityType) {
    case "Accept":
      await handleAccept(c, activity, actor);
      break;
    case "Delete":
      await handleDelete(c, activity);
      break;
    case "Update":
      await handleUpdate(c, activity, actor);
      break;
    case "Reject":
      await handleReject(c, activity, actor);
      break;
    case "Flag":
      await handleFlag(c, activity, actor);
      break;
    case "Move":
      await handleMove(c, activity, actor);
      break;
    case "Like":
      await handleLike(c, activity, actor, baseUrl);
      break;
    case "Announce":
      await handleAnnounce(c, activity, actor, baseUrl);
      break;
    case "Undo":
      // Only Undo(Like|Announce) reaches this path: Undo(Follow|Block) is
      // object-actor-scoped and is dispatched with its resolved target.
      // `null` is the honest recipient here, and handleUndo refuses the
      // follow branch without one.
      await handleUndo(c, activity, null, actor, baseUrl);
      break;
    default:
      log.error("Instance dispatch reached a non-instance activity type", {
        event: "ap.activity.instance_dispatch_misroute",
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

  const claim = await claimActivityForDispatch(c, result);
  if (claim instanceof Response) return claim;

  const { activity, activityType, actor } = result;

  // The activity row is stored (processed = 0) before group dispatch. A thrown
  // handler is isolated and logged WITHOUT committing, so the row stays
  // `processed = 0` and a peer retry re-dispatches to complete the effect rather
  // than being permanently suppressed by the dedup row (#9). A successful
  // dispatch commits (processed = 1) so retries are skipped; failure releases
  // the fenced claim and returns retryable 503.
  try {
    switch (activityType) {
      case "Follow":
        await handleGroupFollow(
          c,
          activity,
          instActor,
          actor,
          baseUrl,
          result.activityId,
          result.sourceActivityId,
        );
        break;
      case "Undo":
        await handleGroupUndo(c, activity, instActor, actor);
        break;
      case "Create":
        await handleGroupCreate(c, activity, instActor, actor, baseUrl);
        break;
    }
    await commitActivityDispatch(c, claim);
  } catch (e) {
    log.error("Actor-inbox dispatch failed", {
      event: "ap.actor_inbox.dispatch_error",
      activityType,
      actor,
      error: e,
    });
    return retryableDispatchFailure(c, claim);
  }

  return c.body(null, 202);
});

// Community (Group) inbox — a remote joins a community by POSTing a Follow
// here; we Accept (signed by the community key) per joinPolicy, and Undo
// removes the membership/follow. Mirrors the instance-actor inbox, reusing the
// shared Group handlers. Only PUBLIC communities are followable (the loader
// returns null for private/deleted → 404).
ap.post("/ap/groups/:name/inbox", async (c) => {
  const db = c.get("db");
  const baseUrl = c.env.APP_URL;
  const name = c.req.param("name");
  const community = await loadFederatedCommunity(
    db,
    communityApId(baseUrl.replace(/\/+$/, ""), name),
  );
  if (!community) return c.json({ error: "Community not found" }, 404);

  const result = await verifyAndParseInbox(c, baseUrl);
  if (result instanceof Response) return result;

  const throttled = await applyInboxDomainRateLimit(c, result.actor);
  if (throttled) return throttled;

  const claim = await claimActivityForDispatch(c, result);
  if (claim instanceof Response) return claim;

  const { activity, activityType, actor } = result;

  try {
    switch (activityType) {
      case "Follow":
        await handleGroupFollow(
          c,
          activity,
          community,
          actor,
          baseUrl,
          result.activityId,
          result.sourceActivityId,
        );
        break;
      case "Undo":
        await handleGroupUndo(c, activity, community, actor);
        break;
    }
    await commitActivityDispatch(c, claim);
  } catch (e) {
    log.error("Community-inbox dispatch failed", {
      event: "ap.community_inbox.dispatch_error",
      activityType,
      actor,
      community: community.apId,
      error: e,
    });
    return retryableDispatchFailure(c, claim);
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

  const claim = await claimActivityForDispatch(c, result);
  if (claim instanceof Response) return claim;

  const { activity, activityType, actor, sourceActivityId } = result;

  // The activity row is stored (processed = 0) before dispatch. If a handler
  // throws we leave it uncommitted so a peer retry re-dispatches and completes
  // the effect, instead of the dedup row permanently suppressing it (#9); on
  // success we commit (processed = 1) so retries are skipped. Failure releases
  // the fenced claim and returns retryable 503 so the peer can complete it.
  try {
    await cacheRemoteActor(c, actor, baseUrl);
    await dispatchUserActivity(c, activityType, activity, {
      recipient,
      actor,
      baseUrl,
      sourceActivityId,
    });
    await commitActivityDispatch(c, claim);
  } catch (e) {
    log.error("User-inbox dispatch failed", {
      event: "ap.user_inbox.dispatch_error",
      activityType,
      actor,
      recipient: recipient.apId,
      error: e,
    });
    return retryableDispatchFailure(c, claim);
  }

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
// Recipient resolution is a total function over the handled activity types:
// every type DECLARES its addressing class in inbox-addressing.ts and the
// route dispatches accordingly. There is no "everything else" fallback — the
// old one fanned out to the sender's local followers, which resolved to ZERO
// recipients for a DM or a Like from a non-follower and then committed
// `processed = 1`, silently and permanently dropping it behind a 202.

// Bound on the number of local followers fanned out per shared-inbox activity,
// so a single delivery cannot trigger an unbounded number of handler runs in
// one request. Local follower sets are small (this is a single-instance
// community app), so this ceiling is generous.
const MAX_SHARED_INBOX_FANOUT = 1000;

/**
 * Resolve the LOCAL actor named by `activity.object` (an actor IRI). Used for
 * object-actor-scoped activities (e.g. `Follow`) delivered to the SHARED inbox:
 * their recipient is the actor in `object`, not the followers of the sender, so
 * they must not go through the follower fan-out. Returns null when the object
 * is missing, remote, or not a known local actor.
 */
async function resolveLocalActorFromObject(
  c: HonoContext,
  activity: Activity,
  baseUrl: string,
): Promise<ActorRow | null> {
  const objectId = getActivityObjectId(activity);
  if (!objectId || !isLocal(objectId, baseUrl)) return null;
  const db = c.get("db");
  const row = await db.query.actors.findFirst({
    where: eq(actors.apId, objectId),
  });
  return row ?? null;
}

async function findLocalActorByApId(
  c: HonoContext,
  apId: string,
  baseUrl: string,
): Promise<ActorRow | null> {
  if (!isLocal(apId, baseUrl)) return null;
  const row = await c.get("db").query.actors.findFirst({
    where: eq(actors.apId, apId),
  });
  return row ?? null;
}

/**
 * Classify a shared-inbox activity whose recipient is an ACTOR named by the
 * activity (not the followers of the sender), and resolve that local target:
 *  - `Follow` / `Block`: the target is `activity.object` (the followed/blocked
 *    actor). handleFollow/handleBlock key off `recipient`, so it MUST be that
 *    actor, never a follower of the sender.
 *  - `Undo(Follow|Block)`: undoFollow decrements `recipient`'s followerCount, so
 *    the recipient must be the followed actor. Resolve it from the wrapped
 *    activity's object (typed inner) or by looking up the referenced follow edge
 *    (bare-string inner). Undo(Like|Announce) is actor-keyed + idempotent, so it
 *    is NOT actor-scoped (`scoped: false`) and is dispatched ONCE as an
 *    instance activity.
 * `scoped: true` with `target: null` = an actor-scoped activity that names no
 * known LOCAL actor → an honest no-op (do not fan out to the sender's followers).
 */
type ObjectActorTarget = {
  scoped: boolean;
  target: ActorRow | null;
  /**
   * A scoped activity with no target that is nonetheless COMPLETE — e.g. an
   * Undo(Follow) whose edge is already gone. Distinguished from "named a local
   * actor we do not host", which is undeliverable.
   */
  noop?: boolean;
};

async function resolveObjectActorTarget(
  c: HonoContext,
  activityType: string,
  activity: Activity,
  baseUrl: string,
): Promise<ObjectActorTarget> {
  if (activityType === "Follow" || activityType === "Block") {
    return {
      scoped: true,
      target: await resolveLocalActorFromObject(c, activity, baseUrl),
    };
  }
  if (activityType === "Undo") {
    const inner = getActivityObject(activity) as {
      type?: string | string[];
      object?: unknown;
    } | null;
    const innerObjectId = inner
      ? typeof inner.object === "string"
        ? inner.object
        : ((inner.object as { id?: string } | undefined)?.id ?? null)
      : null;

    // Undo(Block): the target is the blocked actor named in `inner.object`.
    // Block has no activity-id-keyed edge, so an absent object is a null no-op.
    if (typeIncludes(inner?.type, "Block")) {
      return {
        scoped: true,
        target: innerObjectId
          ? await findLocalActorByApId(c, innerObjectId, baseUrl)
          : null,
      };
    }

    // Undo(Follow): the followed actor — undoFollow keys the followerCount
    // decrement on `recipient`, so the recipient MUST be the followed actor.
    // Resolve it from `inner.object` if present, else from the referenced follow
    // EDGE (a typed inner that carries only its own id, a bare-string activity
    // id, OR a typeless object inner — all mirror the per-user inbox's
    // findFollowByActivityId path). An inner WITHOUT an explicit "Follow" type
    // (bare-string or typeless object) is treated as a POSSIBLE Undo(Follow); if
    // it resolves no local follow edge it is left UNSCOPED, because it may be
    // an Undo(Like|Announce) by id whose actor-keyed handler must still run —
    // as a SINGLE instance dispatch, not a per-follower fan-out.
    if (
      typeIncludes(inner?.type, "Follow") ||
      inner == null ||
      inner.type == null
    ) {
      if (innerObjectId && isLocal(innerObjectId, baseUrl)) {
        return {
          scoped: true,
          target: await findLocalActorByApId(c, innerObjectId, baseUrl),
        };
      }
      const innerId = getActivityObjectId(activity);
      if (innerId) {
        const follow = await findFollowByActivityId(c.get("db"), innerId);
        if (follow && isLocal(follow.followingApId, baseUrl)) {
          return {
            scoped: true,
            target: await findLocalActorByApId(
              c,
              follow.followingApId,
              baseUrl,
            ),
          };
        }
      }
      // A typed Follow inner is object-scoped even with an unresolvable edge
      // (do NOT dispatch it against some other actor). An inner with no
      // explicit Follow type that resolved no follow edge stays unscoped — it
      // may be an Undo(Like|Announce) whose decrement the handler must apply.
      // A typed Follow whose edge is already gone is a DUPLICATE Undo, not a
      // misdirected delivery: nothing is left to undo, so it is a no-op, not
      // an undeliverable (answering 422 to an idempotent retry would be a
      // lie).
      return inner?.type === "Follow"
        ? { scoped: true, target: null, noop: true }
        : { scoped: false, target: null };
    }

    // Undo(Like|Announce|…) — actor-keyed + idempotent; instance-dispatched.
    return { scoped: false, target: null };
  }
  return { scoped: false, target: null };
}

ap.post("/ap/inbox", async (c) => {
  const baseUrl = c.env.APP_URL;
  const db = c.get("db");

  const result = await verifyAndParseInbox(c, baseUrl);
  if (result instanceof Response) return result;

  const throttled = await applyInboxDomainRateLimit(c, result.actor);
  if (throttled) return throttled;

  const claim = await claimActivityForDispatch(c, result);
  if (claim instanceof Response) return claim;

  const { activity, activityType, actor, sourceActivityId } = result;

  // The dispatch below may throw before any handler runs (e.g. actor cache or
  // recipient resolution faults). On such a failure we leave the row
  // uncommitted (processed = 0) so a peer retry re-dispatches and completes
  // delivery rather than being suppressed by the dedup row (#9); we commit it
  // once dispatch has run so retries are skipped.
  try {
    await cacheRemoteActor(c, actor, baseUrl);

    if (!isHandledActivityType(activityType)) {
      log.warn("Unhandled activity type", {
        event: "ap.activity.unhandled_type",
        activityType,
        actor,
      });
      await commitActivityDispatch(c, claim, PROCESSED_DONE);
      return c.body(null, 202);
    }

    const declared = ACTIVITY_ADDRESSING[activityType];

    // ---- object-actor: the recipient is the actor NAMED by the activity ----
    // Follow / Block / Undo(Follow|Block). Routing these through a follower
    // fan-out would key the handler off the wrong actor (bogus edge / Accept
    // from the wrong actor / followerCount drift) or drop the request when the
    // sender has no local followers.
    if (declared === "object-actor") {
      const objectScoped = await resolveObjectActorTarget(
        c,
        activityType,
        activity,
        baseUrl,
      );
      if (objectScoped.scoped) {
        if (!objectScoped.target && objectScoped.noop) {
          // Idempotent no-op (duplicate Undo of an edge that is already gone).
          await commitActivityDispatch(c, claim);
          return c.body(null, 202);
        }
        if (!objectScoped.target) {
          // Named a local actor we do not have (or named none at all). This is
          // not a completed delivery: mark it undeliverable so it is countable
          // and answer 422 instead of a 202 the peer would read as success.
          log.info("Shared-inbox object-actor activity names no local target", {
            event: "ap.shared_inbox.object_actor_no_target",
            activityType,
            actor,
            object: getActivityObjectId(activity),
          });
          await commitActivityDispatch(c, claim, PROCESSED_UNDELIVERABLE);
          return c.json({ error: "No local recipient for this activity" }, 422);
        }
        await dispatchUserActivity(c, activityType, activity, {
          recipient: objectScoped.target,
          actor,
          baseUrl,
          sourceActivityId,
        });
        await commitActivityDispatch(c, claim);
        return c.body(null, 202);
      }
      // Undo(Like|Announce): actor-keyed and idempotent, with no local actor
      // target — dispatch ONCE like any other instance-scoped activity. It used
      // to fall through to the follower fan-out, which ran the handler (and its
      // whole-table counter recompute) once per local follower.
      await dispatchInstanceActivity(c, activityType, activity, actor, baseUrl);
      await commitActivityDispatch(c, claim);
      return c.body(null, 202);
    }

    // ---- instance: the handler resolves its own target ----
    // Accept / Delete / Update / Reject / Flag / Move, plus Like / Announce
    // (whose handlers take `_recipient` and key off the object's attributedTo).
    if (declared === "instance") {
      await dispatchInstanceActivity(c, activityType, activity, actor, baseUrl);
      await commitActivityDispatch(c, claim);
      return c.body(null, 202);
    }

    // ---- addressed: read the activity's own addressing ----
    const resolution = await resolveAddressedRecipients(
      db,
      activity,
      actor,
      baseUrl,
      MAX_SHARED_INBOX_FANOUT,
    );

    if (resolution.invalidReason) {
      log.warn("Shared-inbox activity has invalid addressing", {
        event: "ap.shared_inbox.addressing_invalid",
        activityType,
        actor,
        reason: resolution.invalidReason,
      });
      await commitActivityDispatch(c, claim, PROCESSED_UNDELIVERABLE);
      return c.json({ error: "Invalid or oversized addressing" }, 422);
    }

    if (resolution.recipients.length === 0) {
      if (resolution.cls === "audience") {
        // The activity addressed a COLLECTION (Public / followers) and nobody
        // here subscribes to the sender. That is a genuine no-op: the peer did
        // not name us, so there is nothing that failed to arrive. Commit it
        // done and answer 202.
        log.info("Shared-inbox audience activity has no local subscribers", {
          event: "ap.shared_inbox.no_subscribers",
          activityType,
          actor,
        });
        await commitActivityDispatch(c, claim);
        return c.body(null, 202);
      }
      // The activity named SPECIFIC recipients (or named nobody at all) and
      // none of them resolved to a local actor. Undeliverable, NOT a no-op:
      // the previous code committed `processed = 1` here, which made a DM or a
      // Like from someone the addressee does not follow permanently
      // unrecoverable — every retry was suppressed by the dedup row behind a
      // 202. `processed = 2` keeps the two outcomes distinguishable
      // (`SELECT count(*) FROM activities WHERE processed = 2` is the meter for
      // this defect class) and 422 tells the peer the delivery failed.
      log.warn("Shared-inbox activity resolved no local recipients", {
        event: "ap.shared_inbox.undeliverable",
        activityType,
        actor,
        addressing: resolution.cls,
        addresses: resolution.addresses,
      });
      await commitActivityDispatch(c, claim, PROCESSED_UNDELIVERABLE);
      return c.json({ error: "No local recipient for this activity" }, 422);
    }

    let dispatchFailed = false;
    for (const recipient of resolution.recipients) {
      // Isolate per-recipient failures: a single local recipient whose handler
      // throws must not abort delivery to the others or turn the whole shared
      // delivery into a 5xx (which would make the sending peer retry and
      // redeliver to every recipient).
      try {
        await dispatchUserActivity(c, activityType, activity, {
          recipient,
          actor,
          baseUrl,
          sourceActivityId,
        });
      } catch (e) {
        dispatchFailed = true;
        log.error("Shared-inbox dispatch failed for one recipient", {
          event: "ap.shared_inbox.dispatch_error",
          activityType,
          actor,
          recipient: recipient.apId,
          error: e,
        });
      }
    }
    if (dispatchFailed) {
      throw new Error("One or more shared-inbox recipient dispatches failed");
    }

    await commitActivityDispatch(c, claim);
  } catch (e) {
    log.error("Shared-inbox dispatch failed", {
      event: "ap.shared_inbox.dispatch_error",
      activityType,
      actor,
      error: e,
    });
    return retryableDispatchFailure(c, claim);
  }

  return c.body(null, 202);
});

export default ap;
