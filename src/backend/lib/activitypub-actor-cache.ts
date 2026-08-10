/**
 * Canonical remote-actor fetch + parse + cache helper.
 *
 * Before this module existed, four separate code paths (inbox cold-cache fill,
 * Move-target refresh, delivery resolve-actor, and remote-follow) each inlined
 * their own fetch/parse/guard/upsert block with *divergent* column sets. The
 * inbox path in particular omitted `outbox` / `followersUrl` / `sharedInbox`,
 * so which columns a cached actor row carried depended on whichever path
 * happened to fetch it first. `sharedInbox` is the primary fan-out target for
 * Mastodon-scale servers, so a row first seen via the inbox path silently lost
 * the column that drives delivery — a federation-correctness bug.
 *
 * This helper owns the single canonical SUPERSET cache-field shape and the
 * one fetch/guard/upsert flow, so every cached actor row is now populated
 * identically regardless of entry path.
 */
import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  notExists,
  or,
} from "drizzle-orm";
import {
  actorCache,
  affectedRowCount,
  type D1Statement,
  remoteActorFetchFailures,
  runBatch,
} from "../../db/index.ts";
import type { Database } from "../../db/index.ts";
import {
  fetchWithTimeout,
  isSafeRemoteUrl,
  signRequest,
} from "../federation-helpers.ts";
import {
  tryParseRemoteActor,
  type RemoteActorDocument,
} from "./activitypub-validators.ts";

/**
 * The signing identity used to HTTP-sign an outbound actor GET so instances
 * running in authorized-fetch / secure mode (which 401 unsigned GETs) will
 * serve the actor document. `keyId` must resolve to a publicly-fetchable key
 * (e.g. the instance actor's `#main-key`) so the remote can verify us.
 */
export interface RemoteFetchSigner {
  keyId: string;
  privateKeyPem: string;
}

/**
 * Load the instance actor's signing identity straight from the DB (there is
 * exactly one instance actor row per deployment), WITHOUT lazy-creating it.
 * Returns null if the row does not exist yet — callers then fall back to an
 * unsigned fetch. Used by paths that have only a `db` handle (e.g. inbound
 * signature verification) and not the request context the lazy-creating
 * `getInstanceFetchSigner(c)` needs.
 */
export async function getInstanceFetchSignerByDb(
  db: Database,
): Promise<RemoteFetchSigner | null> {
  const row = await db.query.instanceActor.findFirst({
    columns: { apId: true, privateKeyPem: true },
  });
  if (!row?.privateKeyPem) return null;
  return { keyId: `${row.apId}#main-key`, privateKeyPem: row.privateKeyPem };
}

const DEFAULT_FETCH_TIMEOUT_MS = 15000;

/**
 * Remote actor display fields are attacker-controlled — bounded only by the
 * fetched document size, which can run to megabytes. The cached `name` /
 * `summary` / `preferredUsername` columns are rendered verbatim in every feed
 * row and search result, so an unbounded value bloats those payloads (and the
 * handle the client builds). Truncate at the single cache chokepoint, mirroring
 * the local profile caps (display name 50, summary 500). `rawJson` keeps the
 * full document for re-parsing; only the indexed/rendered columns are bounded.
 */
const MAX_REMOTE_NAME_LENGTH = 50;
const MAX_REMOTE_SUMMARY_LENGTH = 500;
const MAX_REMOTE_USERNAME_LENGTH = 100;

function boundField(s: string | null | undefined, max: number): string | null {
  if (typeof s !== "string" || s.length === 0) return null;
  return s.length > max ? s.slice(0, max) : s;
}

/** Drizzle insert-values shape for the `actor_cache` table. */
type ActorCacheInsert = typeof actorCache.$inferInsert;

/**
 * The ONE canonical superset of columns written to `actor_cache`. Every fetch
 * path goes through this so no entry point can silently drop a column (notably
 * `outbox` / `followersUrl` / `sharedInbox`, the delivery-relevant ones).
 */
export function buildActorCacheFields(
  data: RemoteActorDocument,
): Omit<ActorCacheInsert, "apId" | "createdAt"> {
  return {
    type: data.type || "Person",
    preferredUsername: boundField(
      data.preferredUsername,
      MAX_REMOTE_USERNAME_LENGTH,
    ),
    name: boundField(data.name, MAX_REMOTE_NAME_LENGTH),
    summary: boundField(data.summary, MAX_REMOTE_SUMMARY_LENGTH),
    iconUrl: data.icon?.url || null,
    inbox: data.inbox!,
    outbox: data.outbox || null,
    followersUrl: data.followers || null,
    followingUrl: data.following || null,
    sharedInbox: data.endpoints?.sharedInbox || null,
    publicKeyId: data.publicKey?.id || null,
    publicKeyPem: data.publicKey?.publicKeyPem || null,
    rawJson: JSON.stringify(data),
    lastFetchedAt: new Date().toISOString(),
  };
}

/** Why a fetch+upsert did not produce a cached row. */
export type ActorCacheFailureReason =
  | "fetch_failed" // network/timeout error or thrown during fetch
  | "fetch_not_ok" // non-2xx HTTP response
  | "invalid_document" // body did not parse as a remote actor
  | "id_mismatch" // returned `id` did not match the requested URL
  | "missing_inbox" // no inbox, or inbox/id failed the SSRF safety check
  | "missing_public_key"; // required public key absent (mode === "require-key")

export type ActorCacheResult =
  | { ok: true; data: RemoteActorDocument; row: typeof actorCache.$inferSelect }
  | {
      ok: false;
      reason: "fetch_not_ok";
      status: number;
      retryAfterSeconds: number | null;
    }
  | {
      ok: false;
      reason: Exclude<ActorCacheFailureReason, "fetch_not_ok">;
    };

export type ActorCacheFailureResult = Extract<ActorCacheResult, { ok: false }>;

export type RemoteActorFetchFailureKind = "gone" | "unavailable" | "invalid";

export interface RemoteActorFetchFailureState {
  readonly actorApId: string;
  readonly kind: RemoteActorFetchFailureKind;
  readonly reason: ActorCacheFailureReason;
  readonly httpStatus: number | null;
  readonly failureCount: number;
  readonly retryAt: string | null;
  readonly retryAfterSeconds: number | null;
}

const TRANSIENT_BACKOFF_BASE_SECONDS = 30;
const INVALID_BACKOFF_BASE_SECONDS = 5 * 60;
const MAX_FETCH_BACKOFF_SECONDS = 60 * 60;
const MAX_REMOTE_RETRY_AFTER_SECONDS = 24 * 60 * 60;
const FETCH_FAILURE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const FETCH_FAILURE_REAP_LIMIT = 50;
// The default remote GET timeout is 15s. Keep the claim alive for twice that
// window so request scheduling / D1 latency cannot let a peer steal it while
// the owner is still completing the bounded network call.
const REMOTE_ACTOR_FETCH_LEASE_MS = 30 * 1000;

function clampSeconds(seconds: number, max: number): number {
  return Math.max(1, Math.min(max, Math.ceil(seconds)));
}

function parseRetryAfterSeconds(
  value: string | null,
  nowMs: number,
): number | null {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return clampSeconds(numeric, MAX_REMOTE_RETRY_AFTER_SECONDS);
  }
  const dateMs = Date.parse(value);
  if (!Number.isFinite(dateMs) || dateMs <= nowMs) return null;
  return clampSeconds((dateMs - nowMs) / 1000, MAX_REMOTE_RETRY_AFTER_SECONDS);
}

function classifyFetchFailure(
  failure: ActorCacheFailureResult,
): RemoteActorFetchFailureKind {
  if (failure.reason === "fetch_not_ok" && failure.status === 410) {
    return "gone";
  }
  if (
    failure.reason === "invalid_document" ||
    failure.reason === "id_mismatch" ||
    failure.reason === "missing_inbox" ||
    failure.reason === "missing_public_key"
  ) {
    return "invalid";
  }
  return "unavailable";
}

function failureBackoffSeconds(
  kind: RemoteActorFetchFailureKind,
  failureCount: number,
  remoteRetryAfterSeconds: number | null,
): number | null {
  if (kind === "gone") return null;
  const base =
    kind === "invalid"
      ? INVALID_BACKOFF_BASE_SECONDS
      : TRANSIENT_BACKOFF_BASE_SECONDS;
  const exponent = Math.min(Math.max(0, failureCount - 1), 8);
  const exponential = Math.min(MAX_FETCH_BACKOFF_SECONDS, base * 2 ** exponent);
  return Math.max(exponential, remoteRetryAfterSeconds ?? 0);
}

function stateFromRow(
  row: typeof remoteActorFetchFailures.$inferSelect,
  nowMs: number,
): RemoteActorFetchFailureState {
  const retryAtMs = row.retryAt ? Date.parse(row.retryAt) : Number.NaN;
  const retryAfterSeconds =
    row.kind === "gone" || !Number.isFinite(retryAtMs)
      ? null
      : clampSeconds(
          (retryAtMs - nowMs) / 1000,
          MAX_REMOTE_RETRY_AFTER_SECONDS,
        );
  return {
    actorApId: row.actorApId,
    kind: row.kind as RemoteActorFetchFailureKind,
    reason: row.reason as ActorCacheFailureReason,
    httpStatus: row.httpStatus,
    failureCount: row.failureCount,
    retryAt: row.retryAt,
    retryAfterSeconds,
  };
}

/**
 * Return an active terminal/cooldown decision. An expired retry window returns
 * null so the caller may make one new network attempt and update the ledger.
 */
export async function getRemoteActorFetchFailure(
  db: Database,
  actorApId: string,
  now: Date = new Date(),
): Promise<RemoteActorFetchFailureState | null> {
  const row = await db
    .select()
    .from(remoteActorFetchFailures)
    .where(eq(remoteActorFetchFailures.actorApId, actorApId))
    .get();
  if (!row) return null;
  if (row.kind === "gone") return stateFromRow(row, now.getTime());
  const retryAtMs = row.retryAt ? Date.parse(row.retryAt) : Number.NaN;
  if (!Number.isFinite(retryAtMs) || retryAtMs <= now.getTime()) return null;
  return stateFromRow(row, now.getTime());
}

export type RemoteActorFetchClaim =
  | { readonly owned: true; readonly token: string }
  | {
      readonly owned: false;
      readonly failure: RemoteActorFetchFailureState;
    };

function activeLeaseFailure(
  row: typeof remoteActorFetchFailures.$inferSelect,
  nowMs: number,
): RemoteActorFetchFailureState {
  const leaseExpiresAtMs = row.leaseExpiresAt
    ? Date.parse(row.leaseExpiresAt)
    : Number.NaN;
  const retryAfterSeconds = Number.isFinite(leaseExpiresAtMs)
    ? clampSeconds(
        (leaseExpiresAtMs - nowMs) / 1000,
        MAX_REMOTE_RETRY_AFTER_SECONDS,
      )
    : TRANSIENT_BACKOFF_BASE_SECONDS;
  return {
    actorApId: row.actorApId,
    kind: "unavailable",
    reason: "fetch_failed",
    httpStatus: null,
    failureCount: row.failureCount,
    retryAt: Number.isFinite(leaseExpiresAtMs) ? row.leaseExpiresAt : null,
    retryAfterSeconds,
  };
}

function currentFailureOrLease(
  row: typeof remoteActorFetchFailures.$inferSelect,
  nowMs: number,
): RemoteActorFetchFailureState {
  if (row.kind === "gone") return stateFromRow(row, nowMs);
  const retryAtMs = row.retryAt ? Date.parse(row.retryAt) : Number.NaN;
  if (Number.isFinite(retryAtMs) && retryAtMs > nowMs) {
    return stateFromRow(row, nowMs);
  }
  return activeLeaseFailure(row, nowMs);
}

/**
 * Claim the one remote GET allowed for an actor whose cache row is missing.
 *
 * The token fences completion: if a slow owner outlives this bounded lease, it
 * cannot overwrite the failure recorded by a newer owner or clear a cache
 * decision after that newer fetch succeeds.
 */
export async function claimRemoteActorFetch(
  db: Database,
  actorApId: string,
  now: Date = new Date(),
): Promise<RemoteActorFetchClaim> {
  const nowIso = now.toISOString();
  const token = crypto.randomUUID();
  const leaseExpiresAt = new Date(
    now.getTime() + REMOTE_ACTOR_FETCH_LEASE_MS,
  ).toISOString();

  const inserted = await db
    .insert(remoteActorFetchFailures)
    .values({
      actorApId,
      kind: "unavailable",
      reason: "fetch_failed",
      httpStatus: null,
      failureCount: 0,
      retryAt: null,
      processingToken: token,
      leaseExpiresAt,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    .onConflictDoNothing();
  if (affectedRowCount(inserted) > 0) return { owned: true, token };

  const claimed = await db
    .update(remoteActorFetchFailures)
    .set({ processingToken: token, leaseExpiresAt, updatedAt: nowIso })
    .where(
      and(
        eq(remoteActorFetchFailures.actorApId, actorApId),
        ne(remoteActorFetchFailures.kind, "gone"),
        or(
          isNull(remoteActorFetchFailures.retryAt),
          lte(remoteActorFetchFailures.retryAt, nowIso),
        ),
        or(
          isNull(remoteActorFetchFailures.processingToken),
          isNull(remoteActorFetchFailures.leaseExpiresAt),
          lte(remoteActorFetchFailures.leaseExpiresAt, nowIso),
        ),
      ),
    );
  if (affectedRowCount(claimed) > 0) return { owned: true, token };

  const current = await db
    .select()
    .from(remoteActorFetchFailures)
    .where(eq(remoteActorFetchFailures.actorApId, actorApId))
    .get();
  if (!current) {
    // A successful owner may have deleted the ledger between our failed claim
    // and this read. The current request did not own a GET, so fail closed and
    // let a later profile load observe the newly cached actor or retry.
    return {
      owned: false,
      failure: {
        actorApId,
        kind: "unavailable",
        reason: "fetch_failed",
        httpStatus: null,
        failureCount: 0,
        retryAt: null,
        retryAfterSeconds: TRANSIENT_BACKOFF_BASE_SECONDS,
      },
    };
  }
  return {
    owned: false,
    failure: currentFailureOrLease(current, now.getTime()),
  };
}

/** Persist one failed fetch and return the exact response/backoff authority. */
export async function recordRemoteActorFetchFailure(
  db: Database,
  actorApId: string,
  failure: ActorCacheFailureResult,
  now: Date = new Date(),
  claimToken?: string,
): Promise<RemoteActorFetchFailureState> {
  const prior = await db
    .select({ failureCount: remoteActorFetchFailures.failureCount })
    .from(remoteActorFetchFailures)
    .where(eq(remoteActorFetchFailures.actorApId, actorApId))
    .get();
  const failureCount = Math.min((prior?.failureCount ?? 0) + 1, 1_000_000);
  const kind = classifyFetchFailure(failure);
  const remoteRetryAfterSeconds =
    failure.reason === "fetch_not_ok" ? failure.retryAfterSeconds : null;
  const backoffSeconds = failureBackoffSeconds(
    kind,
    failureCount,
    remoteRetryAfterSeconds,
  );
  const nowIso = now.toISOString();
  const retryAt =
    backoffSeconds === null
      ? null
      : new Date(now.getTime() + backoffSeconds * 1000).toISOString();
  const values = {
    actorApId,
    kind,
    reason: failure.reason,
    httpStatus: failure.reason === "fetch_not_ok" ? failure.status : null,
    failureCount,
    retryAt,
    processingToken: null,
    leaseExpiresAt: null,
    updatedAt: nowIso,
  };

  if (claimToken) {
    const recorded = await db
      .update(remoteActorFetchFailures)
      .set(values)
      .where(
        and(
          eq(remoteActorFetchFailures.actorApId, actorApId),
          eq(remoteActorFetchFailures.processingToken, claimToken),
          notExists(
            db
              .select({ apId: actorCache.apId })
              .from(actorCache)
              .where(eq(actorCache.apId, actorApId)),
          ),
        ),
      );
    if (affectedRowCount(recorded) === 0) {
      const cached = await db
        .select({ apId: actorCache.apId })
        .from(actorCache)
        .where(eq(actorCache.apId, actorApId))
        .get();
      if (cached) {
        // A successful writer won the race. Remove only this claimant's stale
        // lease (never a newer owner's) so cache eviction cannot resurrect the
        // losing request's failure decision later.
        await db
          .delete(remoteActorFetchFailures)
          .where(
            and(
              eq(remoteActorFetchFailures.actorApId, actorApId),
              eq(remoteActorFetchFailures.processingToken, claimToken),
            ),
          );
      }
      const current = await db
        .select()
        .from(remoteActorFetchFailures)
        .where(eq(remoteActorFetchFailures.actorApId, actorApId))
        .get();
      if (current) return currentFailureOrLease(current, now.getTime());
      return {
        actorApId,
        kind: "unavailable",
        reason: "fetch_failed",
        httpStatus: null,
        failureCount: 0,
        retryAt: null,
        retryAfterSeconds: TRANSIENT_BACKOFF_BASE_SECONDS,
      };
    }
  } else {
    await db
      .insert(remoteActorFetchFailures)
      .values({ ...values, createdAt: nowIso })
      .onConflictDoUpdate({
        target: remoteActorFetchFailures.actorApId,
        set: values,
      });
  }

  return {
    ...values,
    retryAfterSeconds: backoffSeconds,
  };
}

export async function clearRemoteActorFetchFailure(
  db: Database,
  actorApId: string,
  claimToken?: string,
): Promise<void> {
  await db
    .delete(remoteActorFetchFailures)
    .where(
      claimToken
        ? and(
            eq(remoteActorFetchFailures.actorApId, actorApId),
            eq(remoteActorFetchFailures.processingToken, claimToken),
          )
        : eq(remoteActorFetchFailures.actorApId, actorApId),
    );
}

/** Remove one D1-safe batch of stale negative-cache/backoff rows. */
export async function reapRemoteActorFetchFailures(
  db: Database,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(
    now.getTime() - FETCH_FAILURE_RETENTION_MS,
  ).toISOString();
  const candidates = await db
    .select({ actorApId: remoteActorFetchFailures.actorApId })
    .from(remoteActorFetchFailures)
    .where(
      and(
        lt(remoteActorFetchFailures.updatedAt, cutoff),
        or(
          isNull(remoteActorFetchFailures.leaseExpiresAt),
          lte(remoteActorFetchFailures.leaseExpiresAt, now.toISOString()),
        ),
      ),
    )
    .orderBy(asc(remoteActorFetchFailures.updatedAt))
    .limit(FETCH_FAILURE_REAP_LIMIT);
  if (candidates.length === 0) return 0;
  const result = await db.delete(remoteActorFetchFailures).where(
    and(
      inArray(
        remoteActorFetchFailures.actorApId,
        candidates.map((row) => row.actorApId),
      ),
      lt(remoteActorFetchFailures.updatedAt, cutoff),
      or(
        isNull(remoteActorFetchFailures.leaseExpiresAt),
        lte(remoteActorFetchFailures.leaseExpiresAt, now.toISOString()),
      ),
    ),
  );
  return affectedRowCount(result);
}

export interface FetchAndUpsertActorCacheOptions {
  /** Fetch timeout in ms. Defaults to 15s. */
  timeout?: number;
  /**
   * `"upsert"` (default) refreshes an existing row via `onConflictDoUpdate`.
   * `"insert"` is cache-when-absent: it uses `onConflictDoNothing`, so a row
   * that already exists is left untouched and the just-fetched `row` is still
   * returned by re-reading it.
   */
  mode?: "upsert" | "insert";
  /**
   * When `"require-key"`, an actor document without a `publicKey.publicKeyPem`
   * is rejected with `missing_public_key`. Defaults to `"allow-keyless"`,
   * matching the refresh/delivery paths that tolerate a missing key.
   */
  publicKey?: "require-key" | "allow-keyless";
  /**
   * When provided, the outbound GET is HTTP-signed with this identity so a
   * remote running in authorized-fetch / secure mode serves the document
   * instead of 401ing the unsigned request. Omit for plain (unsigned) fetches.
   */
  signer?: RemoteFetchSigner;
}

export type CacheRemoteActorDocumentOptions = Pick<
  FetchAndUpsertActorCacheOptions,
  "mode" | "publicKey"
>;

/**
 * Validate and persist an already-fetched remote actor document.
 *
 * This is the single successful-write authority for `actor_cache`: the cache
 * mutation and deletion of any older terminal/cooldown/lease row are committed
 * atomically. Indexed fields come from the bounded parsed shape while
 * `rawJson` preserves the original document, including extension fields such
 * as `attachment`, `alsoKnownAs`, and `endpoints.rtcSignal`.
 */
export async function cacheRemoteActorDocument(
  db: Database,
  expectedActorApId: string,
  rawDocument: unknown,
  options: CacheRemoteActorDocumentOptions = {},
): Promise<ActorCacheResult> {
  const { mode = "upsert", publicKey = "allow-keyless" } = options;

  if (!isSafeRemoteUrl(expectedActorApId)) {
    return { ok: false, reason: "missing_inbox" };
  }

  const data = tryParseRemoteActor(rawDocument);
  if (!data) return { ok: false, reason: "invalid_document" };
  if (data.id !== expectedActorApId) {
    return { ok: false, reason: "id_mismatch" };
  }
  if (
    !data.inbox ||
    !isSafeRemoteUrl(data.id) ||
    !isSafeRemoteUrl(data.inbox)
  ) {
    return { ok: false, reason: "missing_inbox" };
  }
  if (publicKey === "require-key" && !data.publicKey?.publicKeyPem) {
    return { ok: false, reason: "missing_public_key" };
  }

  const fields = {
    ...buildActorCacheFields(data),
    rawJson: JSON.stringify(rawDocument),
  };
  const write =
    mode === "insert"
      ? db
          .insert(actorCache)
          .values({ apId: data.id, ...fields })
          .onConflictDoNothing()
      : db
          .insert(actorCache)
          .values({ apId: data.id, ...fields })
          .onConflictDoUpdate({ target: actorCache.apId, set: fields });
  const clearFailure = db
    .delete(remoteActorFetchFailures)
    .where(eq(remoteActorFetchFailures.actorApId, data.id));

  await runBatch(db, [
    write as unknown as D1Statement,
    clearFailure as unknown as D1Statement,
  ]);

  const row = await db
    .select()
    .from(actorCache)
    .where(eq(actorCache.apId, data.id))
    .get();
  if (!row) return { ok: false, reason: "fetch_failed" };

  return { ok: true, data, row };
}

/**
 * Fetch a remote actor document, validate it, and upsert it into
 * `actor_cache` using the single canonical column set. Returns a discriminated
 * result so callers can surface their own error responses while still sharing
 * the fetch/guard/upsert logic.
 *
 * Guards (in order): SSRF safety on the requested URL, HTTP ok, parseable
 * actor document, `id` equals the requested URL, inbox present and SSRF-safe,
 * and (optionally) a public key present.
 */
export async function fetchAndUpsertActorCache(
  db: Database,
  actorApId: string,
  options: FetchAndUpsertActorCacheOptions = {},
): Promise<ActorCacheResult> {
  const {
    timeout = DEFAULT_FETCH_TIMEOUT_MS,
    mode = "upsert",
    publicKey = "allow-keyless",
    signer,
  } = options;

  if (!isSafeRemoteUrl(actorApId)) {
    return { ok: false, reason: "missing_inbox" };
  }

  let raw: unknown;
  try {
    const headers: Record<string, string> = {
      Accept: "application/activity+json, application/ld+json",
    };
    if (signer) {
      // Authorized-fetch: sign the bodyless GET as the instance actor so a
      // secure-mode remote (which 401s unsigned GETs) serves the document.
      // signRequest covers `(request-target) host date` for a bodyless request.
      Object.assign(
        headers,
        await signRequest(signer.privateKeyPem, signer.keyId, "GET", actorApId),
      );
    }
    const res = await fetchWithTimeout(actorApId, {
      headers,
      timeout,
    });
    if (!res.ok) {
      return {
        ok: false,
        reason: "fetch_not_ok",
        status: res.status,
        retryAfterSeconds: parseRetryAfterSeconds(
          res.headers.get("retry-after"),
          Date.now(),
        ),
      };
    }
    raw = await res.json();
  } catch {
    return { ok: false, reason: "fetch_failed" };
  }
  return await cacheRemoteActorDocument(db, actorApId, raw, {
    mode,
    publicKey,
  });
}
