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
import { eq } from "drizzle-orm";
import { actorCache } from "../../db/index.ts";
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
  | { ok: false; reason: ActorCacheFailureReason };

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

  let data: RemoteActorDocument | null;
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
    if (!res.ok) return { ok: false, reason: "fetch_not_ok" };
    const raw: unknown = await res.json();
    data = tryParseRemoteActor(raw);
  } catch {
    return { ok: false, reason: "fetch_failed" };
  }

  if (!data) return { ok: false, reason: "invalid_document" };
  if (data.id !== actorApId) return { ok: false, reason: "id_mismatch" };
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

  const fields = buildActorCacheFields(data);

  if (mode === "insert") {
    // Cache-when-absent: leave an existing row untouched. The early-existence
    // check at the call site is best-effort, so two isolates racing the same
    // cold actor can both reach this insert; `onConflictDoNothing` keeps that
    // race-safe instead of throwing a primary-key violation.
    await db
      .insert(actorCache)
      .values({ apId: data.id, ...fields })
      .onConflictDoNothing();
  } else {
    await db
      .insert(actorCache)
      .values({ apId: data.id, ...fields })
      .onConflictDoUpdate({ target: actorCache.apId, set: fields });
  }

  const row = await db
    .select()
    .from(actorCache)
    .where(eq(actorCache.apId, data.id))
    .get();
  if (!row) return { ok: false, reason: "fetch_failed" };

  return { ok: true, data, row };
}
