import { Hono } from "hono";
import type { Context } from "hono";
import type { Env, Variables } from "../../types.ts";
import { and, eq, inArray } from "drizzle-orm";
import { activities, actorCache, actors, follows } from "../../../db/index.ts";
import {
  activityApId,
  actorApId,
  generateId,
  isLocal,
  isSafeRemoteUrl,
} from "../../federation-helpers.ts";
import { getInstanceActor, loadFederatedCommunity } from "./query-helpers.ts";
import { communityApId } from "../../lib/ap-ids.ts";
import type { Activity } from "./inbox-types.ts";
import { getActivityObject, getActivityObjectId } from "./inbox-types.ts";
import { findFollowByActivityId } from "./handlers/inbox-shared-helpers.ts";
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
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });

type RequestBodyResult =
  | { ok: true; body: string }
  | { ok: false; status: 400 | 413; error: string };

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

// `processed` ledger values for an inbound activity row:
//   0 = stored, dispatch not yet committed (newly inserted, or a prior dispatch
//       threw — such a row is RE-DISPATCHABLE so a peer retry completes it)
//   1 = dispatch effects committed successfully (terminal; suppresses re-dispatch)
const PROCESSED_UNPROCESSED = 0;
const PROCESSED_DONE = 1;

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
    activity,
  }: ParsedActivity,
): Promise<Response | ActivityDispatchClaim> {
  const db = c.get("db");
  const rawJson = JSON.stringify(activity);

  // Atomic insert-or-skip. A non-null returned row means THIS request created
  // the dedup row and owns dispatch; a null row means a concurrent or prior
  // delivery already stored it.
  const inserted = await db
    .insert(activities)
    .values({
      apId: activityId,
      type: activityType,
      actorApId: actor,
      objectApId: activityObjectId,
      rawJson,
      direction: "inbound",
      processed: PROCESSED_UNPROCESSED,
    })
    .onConflictDoNothing()
    .returning()
    .get();

  if (inserted) {
    return { activityId, activityType, actor };
  }

  // Lost the insert: a row already exists. Suppress ONLY if it was already
  // dispatched to completion (`processed = 1`). An existing `processed = 0` row
  // means a prior dispatch threw without committing, so this redelivery must
  // re-dispatch to finish it — otherwise the dedup row would permanently
  // suppress re-dispatch of a half-applied activity (bug #9).
  const existing = await db.query.activities.findFirst({
    where: eq(activities.apId, activityId),
    columns: { processed: true },
  });

  if (existing && existing.processed === PROCESSED_UNPROCESSED) {
    log.info("Re-dispatching previously-uncommitted activity", {
      event: "ap.activity.redispatch_uncommitted",
      activityId,
      activityType,
      actor,
    });
    return { activityId, activityType, actor };
  }

  log.info("Duplicate activity skipped", {
    event: "ap.activity.duplicate_skipped",
    activityId,
    activityType,
    actor,
  });
  return c.body(null, 202);
}

/**
 * Mark a claimed activity's dispatch as terminally complete. Called after the
 * handler effects commit successfully so any subsequent (re)delivery is
 * suppressed by `claimActivityForDispatch`.
 */
async function commitActivityDispatch(
  c: HonoContext,
  activityId: string,
): Promise<void> {
  const db = c.get("db");
  await db
    .update(activities)
    .set({ processed: PROCESSED_DONE })
    .where(eq(activities.apId, activityId));
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
      await handleAccept(c, activity, actor);
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
  // dispatch commits (processed = 1) so retries are skipped. Either way we ACK
  // 202 — a 5xx would make the remote retry, and a committed-too-early dedup row
  // would black-hole the half-applied activity.
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
        );
        break;
      case "Undo":
        await handleGroupUndo(c, activity, instActor, actor);
        break;
      case "Create":
        await handleGroupCreate(c, activity, instActor, actor, baseUrl);
        break;
    }
    await commitActivityDispatch(c, claim.activityId);
  } catch (e) {
    log.error("Actor-inbox dispatch failed", {
      event: "ap.actor_inbox.dispatch_error",
      activityType,
      actor,
      error: e,
    });
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
        );
        break;
      case "Undo":
        await handleGroupUndo(c, activity, community, actor);
        break;
    }
    await commitActivityDispatch(c, claim.activityId);
  } catch (e) {
    log.error("Community-inbox dispatch failed", {
      event: "ap.community_inbox.dispatch_error",
      activityType,
      actor,
      community: community.apId,
      error: e,
    });
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

  const { activity, activityType, actor } = result;

  await cacheRemoteActor(c, actor, baseUrl);

  // The activity row is stored (processed = 0) before dispatch. If a handler
  // throws we leave it uncommitted so a peer retry re-dispatches and completes
  // the effect, instead of the dedup row permanently suppressing it (#9); on
  // success we commit (processed = 1) so retries are skipped. We ACK 202
  // regardless so a retry is not provoked into a 5xx loop.
  try {
    await dispatchUserActivity(c, activityType, activity, {
      recipient,
      actor,
      baseUrl,
    });
    await commitActivityDispatch(c, claim.activityId);
  } catch (e) {
    log.error("User-inbox dispatch failed", {
      event: "ap.user_inbox.dispatch_error",
      activityType,
      actor,
      recipient: recipient.apId,
      error: e,
    });
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
 *    is NOT actor-scoped and keeps the follower fan-out (`scoped: false`).
 * `scoped: true` with `target: null` = an actor-scoped activity that names no
 * known LOCAL actor → an honest no-op (do not fan out to the sender's followers).
 */
async function resolveObjectActorTarget(
  c: HonoContext,
  activityType: string,
  activity: Activity,
  baseUrl: string,
): Promise<{ scoped: boolean; target: ActorRow | null }> {
  if (activityType === "Follow" || activityType === "Block") {
    return {
      scoped: true,
      target: await resolveLocalActorFromObject(c, activity, baseUrl),
    };
  }
  if (activityType === "Undo") {
    const inner = getActivityObject(activity) as {
      type?: string;
      object?: unknown;
    } | null;
    if (inner?.type === "Follow" || inner?.type === "Block") {
      const targetId =
        typeof inner.object === "string"
          ? inner.object
          : ((inner.object as { id?: string } | undefined)?.id ?? null);
      if (!targetId) return { scoped: true, target: null };
      return {
        scoped: true,
        target: await findLocalActorByApId(c, targetId, baseUrl),
      };
    }
    // Bare-string inner: only an Undo(Follow) referencing a known local edge is
    // actor-scoped; anything else (Undo of a like/announce by id, or unknown)
    // falls through to the follower fan-out.
    const innerId = getActivityObjectId(activity);
    if (innerId) {
      const follow = await findFollowByActivityId(c.get("db"), innerId);
      if (follow && isLocal(follow.followingApId, baseUrl)) {
        return {
          scoped: true,
          target: await findLocalActorByApId(c, follow.followingApId, baseUrl),
        };
      }
    }
    return { scoped: false, target: null };
  }
  return { scoped: false, target: null };
}

ap.post("/ap/inbox", async (c) => {
  const baseUrl = c.env.APP_URL;

  const result = await verifyAndParseInbox(c, baseUrl);
  if (result instanceof Response) return result;

  const throttled = await applyInboxDomainRateLimit(c, result.actor);
  if (throttled) return throttled;

  const claim = await claimActivityForDispatch(c, result);
  if (claim instanceof Response) return claim;

  const { activity, activityType, actor } = result;

  // The fan-out below may throw before any dispatch runs (e.g. actor cache or
  // follower resolution faults). On such a failure we leave the row uncommitted
  // (processed = 0) so a peer retry re-dispatches and completes delivery rather
  // than being suppressed by the dedup row (#9); we commit it once the fan-out
  // has run so retries are skipped.
  try {
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
      await commitActivityDispatch(c, claim.activityId);
      return c.body(null, 202);
    }

    // Object-actor-scoped activities (Follow / Block / Undo(Follow|Block)) are
    // addressed to the actor NAMED by the activity, NOT to followers of the
    // sender. Routing them through the follower fan-out below would make the
    // handler key off the wrong actor (bogus edge / Accept from the wrong actor
    // / followerCount drift on the wrong actor) or — when the sender has no
    // local followers — silently DROP the request entirely. Resolve the target
    // and dispatch once (mirrors the per-user inbox). Correctly-addressed peers
    // hit /ap/users/:username/inbox; this guards peers that point them here.
    const objectScoped = await resolveObjectActorTarget(
      c,
      activityType,
      activity,
      baseUrl,
    );
    if (objectScoped.scoped) {
      if (objectScoped.target) {
        await dispatchUserActivity(c, activityType, activity, {
          recipient: objectScoped.target,
          actor,
          baseUrl,
        });
      } else {
        log.info("Shared-inbox object-actor activity names no local target", {
          event: "ap.shared_inbox.object_actor_no_target",
          activityType,
          actor,
          object: getActivityObjectId(activity),
        });
      }
      await commitActivityDispatch(c, claim.activityId);
      return c.body(null, 202);
    }

    // Recipient-scoped: fan out to every local follower of the sending actor.
    const recipients = await resolveLocalFollowerRecipients(c, actor, baseUrl);
    if (recipients.length === 0) {
      // No local subscribers for this actor — an honest no-op delivery. Commit
      // the claim so the no-op is not retried indefinitely.
      await commitActivityDispatch(c, claim.activityId);
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

    // Fan-out attempted for every resolved recipient (per-recipient failures
    // are isolated above). Commit the claim so a peer retry does not redeliver
    // to every local follower.
    await commitActivityDispatch(c, claim.activityId);
  } catch (e) {
    log.error("Shared-inbox dispatch failed", {
      event: "ap.shared_inbox.dispatch_error",
      activityType,
      actor,
      error: e,
    });
  }

  return c.body(null, 202);
});

export default ap;
