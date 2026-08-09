// Account-migration (ActivityPub Move) consent verification, shared by the
// INBOUND Move handler (which only honors a Move whose destination consents) and
// the OUTBOUND /me/move endpoint (which refuses to advertise a migration the
// destination has not consented to, so the local user gets an actionable error
// instead of a silent no-op on every compliant receiver).

import { fetchWithTimeout } from "./federation-fetch.ts";
import { signRequest } from "./ap-signing.ts";
import type { RemoteFetchSigner } from "./activitypub-actor-cache.ts";
import { parseWebFinger } from "./activitypub-validators.ts";
import { isSafeRemoteUrl, normalizeRemoteDomain } from "./ssrf.ts";
import type { Env } from "../types.ts";
import type { Database, D1Statement } from "../../db/index.ts";
import { activities, actors, follows, runBatch } from "../../db/index.ts";
import { and, asc, eq, exists, gt, ne, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { activityApId } from "./ap-ids.ts";
import { enqueueDeliveriesToActor } from "./delivery/queue.ts";
import { sha256Hex } from "./delivery/transformers.ts";

const ALIAS_FETCH_TIMEOUT_MS = 15000;

// `@user@domain` or `user@domain` (a fediverse handle). Rejects embedded
// whitespace and extra `@` so it never matches a URL or a malformed string.
const HANDLE_RE = /^@?([^@\s]+)@([^@\s]+)$/;

/**
 * Resolve a migration target that may be EITHER a full actor URL or a
 * `@user@domain` fediverse handle (what users actually know — and what the
 * Settings move field's placeholder shows). A handle is resolved via WebFinger
 * to its `self` ActivityPub actor URL; a URL is returned untouched for the
 * caller to SSRF-validate. Returns null if the input is neither a usable URL
 * nor a resolvable handle. Fails closed on any error.
 */
export async function resolveMoveTarget(input: string): Promise<string | null> {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    // Full actor URL: the caller still runs isValidHttpUrl + isSafeRemoteUrl.
    return trimmed;
  }
  const match = trimmed.match(HANDLE_RE);
  if (!match) return null;
  const [, username, domain] = match;
  const safeDomain = normalizeRemoteDomain(domain);
  if (!safeDomain) return null;
  try {
    const webfingerUrl = `https://${safeDomain}/.well-known/webfinger?resource=acct:${username}@${safeDomain}`;
    const res = await fetchWithTimeout(webfingerUrl, {
      headers: { Accept: "application/jrd+json" },
      timeout: ALIAS_FETCH_TIMEOUT_MS,
    });
    if (!res.ok) return null;
    const raw: unknown = await res.json();
    const doc = parseWebFinger(raw);
    const self = doc.links?.find(
      (l) => l.rel === "self" && l.type === "application/activity+json",
    );
    if (!self?.href || !isSafeRemoteUrl(self.href)) return null;
    return self.href;
  } catch {
    return null;
  }
}

/**
 * Verify the destination actor of a Move declares the origin actor in its
 * `alsoKnownAs` (the standard Mastodon account-migration consent check): a
 * signed Move only proves the ORIGIN consents to leave; the destination's
 * back-reference is what proves the two accounts are the same person and stops
 * a follower-stealing redirect to an unconsenting account.
 *
 * Fetches the destination actor document fresh and FAILS CLOSED on any error
 * (network failure, non-2xx, malformed document, id mismatch, missing alias).
 * Callers must SSRF-guard `newActorApId` before calling.
 */
export async function destinationDeclaresAlias(
  newActorApId: string,
  oldActorApId: string,
  signer?: RemoteFetchSigner,
): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(newActorApId, {
      headers: {
        Accept: "application/activity+json, application/ld+json",
        // Sign as the instance actor so a destination on a secure-mode
        // instance serves its actor doc — otherwise the alias (consent) check
        // 401s and the Move fails closed even when consent was declared.
        ...(signer
          ? await signRequest(
              signer.privateKeyPem,
              signer.keyId,
              "GET",
              newActorApId,
            )
          : {}),
      },
      timeout: ALIAS_FETCH_TIMEOUT_MS,
    });
    if (!res.ok) return false;
    const raw: unknown = await res.json();
    if (!raw || typeof raw !== "object") return false;
    const doc = raw as { id?: unknown; alsoKnownAs?: unknown };
    if (doc.id !== newActorApId) return false;
    const aka = doc.alsoKnownAs;
    const aliases = Array.isArray(aka)
      ? aka
      : typeof aka === "string"
        ? [aka]
        : [];
    return aliases.includes(oldActorApId);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Inbound Move follow-graph rewrite
// ---------------------------------------------------------------------------

const MOVE_REFOLLOW_PAGE_SIZE = 100;

/**
 * Stable namespace for the outbound Follow activities produced by one inbound
 * Move. The inbox stamps a fixed-size, signer-bound internal activity id before
 * dispatch; the old/new ids are mixed in as defense-in-depth and to keep direct
 * handler tests deterministic when no inbox id is supplied.
 */
export async function moveRefollowPrefix(args: {
  readonly baseUrl: string;
  readonly inboundActivityId?: string;
  readonly oldActorApId: string;
  readonly newActorApId: string;
}): Promise<string> {
  const digest = await sha256Hex(
    `${args.inboundActivityId ?? "synthetic-move"}\0${args.oldActorApId}\0${args.newActorApId}`,
  );
  return activityApId(args.baseUrl, `move-refollow-${digest}-`);
}

/**
 * Re-enqueue every durable local re-Follow created for one Move. Returns the
 * number of persisted activities found, so the handler can resume a graph
 * rewrite that committed before a Queue send failed without re-fetching the
 * destination alias or trying to reconstruct already-deleted old edges.
 */
export async function enqueuePersistedMoveRefollows(args: {
  readonly db: Database;
  readonly env: Env;
  readonly newActorApId: string;
  readonly refollowPrefix: string;
}): Promise<number> {
  let cursor: string | null = null;
  let found = 0;

  while (true) {
    const page = await args.db
      .select({ apId: activities.apId })
      .from(activities)
      .where(
        and(
          eq(activities.type, "Follow"),
          eq(activities.objectApId, args.newActorApId),
          eq(activities.direction, "outbound"),
          // `LIKE prefix%` would hit D1's short LIKE-pattern complexity limit
          // because the stable prefix contains a full URL + SHA-256 digest.
          sql`instr(${activities.apId}, ${args.refollowPrefix}) = 1`,
          cursor ? gt(activities.apId, cursor) : undefined,
        ),
      )
      .orderBy(asc(activities.apId))
      .limit(MOVE_REFOLLOW_PAGE_SIZE);

    if (page.length === 0) break;
    await enqueueDeliveriesToActor(
      args.env,
      page.map((row) => row.apId),
      args.newActorApId,
    );
    found += page.length;
    cursor = page[page.length - 1]!.apId;
    if (page.length < MOVE_REFOLLOW_PAGE_SIZE) break;
  }

  return found;
}

/**
 * Atomically rewrite every edge that names a moved remote actor.
 *
 * The statement count is fixed at eight regardless of graph size. Each INSERT
 * reads the old graph with INSERT ... SELECT, so it binds only the handful of
 * actor/prefix values rather than six parameters per edge. Both counter repairs
 * are set-based UPDATEs. This is deliberately not implemented as insertMany()
 * chunks: a large graph would eventually exceed the 50-statement atomic-batch
 * ceiling, while splitting the delete/insert work across batches would expose
 * a permanent half-migrated graph after a crash.
 *
 * Outbound local re-Follow activities are written in the same batch as their
 * pending edges. If Queue delivery throws after commit, the stable prefix lets
 * a retry call enqueuePersistedMoveRefollows() before touching the graph.
 */
export async function rewriteMovedFollowGraph(args: {
  readonly db: Database;
  readonly oldActorApId: string;
  readonly newActorApId: string;
  readonly refollowPrefix: string;
}): Promise<void> {
  const oldAsFollower = alias(follows, "move_old_as_follower");
  const oldAsFollowee = alias(follows, "move_old_as_followee");
  const existingFollowerTarget = alias(
    follows,
    "move_existing_follower_target",
  );
  const existingFollowingSource = alias(
    follows,
    "move_existing_following_source",
  );
  const localFollowerActor = alias(actors, "move_local_follower_actor");

  // These aliases belong to the counter statements. Keep them separate from
  // the INSERT aliases so each generated statement is unambiguous to SQLite.
  const acceptedOldFollowee = alias(follows, "move_accepted_old_followee");
  const acceptedOldFollower = alias(follows, "move_accepted_old_follower");
  const duplicateNewFollower = alias(follows, "move_duplicate_new_follower");

  const decrementLocalFollowers = args.db
    .update(actors)
    .set({ followingCount: sql`${actors.followingCount} - 1` })
    .where(
      and(
        gt(actors.followingCount, 0),
        exists(
          args.db
            .select({ one: sql`1` })
            .from(acceptedOldFollowee)
            .where(
              and(
                eq(acceptedOldFollowee.followingApId, args.oldActorApId),
                eq(acceptedOldFollowee.followerApId, actors.apId),
                eq(acceptedOldFollowee.status, "accepted"),
              ),
            ),
        ),
      ),
    );

  const decrementDroppedLocalFollowees = args.db
    .update(actors)
    .set({ followerCount: sql`${actors.followerCount} - 1` })
    .where(
      and(
        gt(actors.followerCount, 0),
        exists(
          args.db
            .select({ one: sql`1` })
            .from(acceptedOldFollower)
            .where(
              and(
                eq(acceptedOldFollower.followerApId, args.oldActorApId),
                eq(acceptedOldFollower.followingApId, actors.apId),
                eq(acceptedOldFollower.status, "accepted"),
              ),
            ),
        ),
        sql`(
          ${actors.apId} = ${args.newActorApId}
          OR ${exists(
            args.db
              .select({ one: sql`1` })
              .from(duplicateNewFollower)
              .where(
                and(
                  eq(duplicateNewFollower.followerApId, args.newActorApId),
                  eq(duplicateNewFollower.followingApId, actors.apId),
                ),
              ),
          )}
        )`,
      ),
    );

  const rewriteOldAsFollower = args.db
    .insert(follows)
    .select(
      args.db
        .select({
          followerApId: sql<string>`${args.newActorApId}`.as("follower_ap_id"),
          followingApId: oldAsFollower.followingApId,
          status: oldAsFollower.status,
          activityApId: oldAsFollower.activityApId,
          createdAt: oldAsFollower.createdAt,
          acceptedAt: oldAsFollower.acceptedAt,
        })
        .from(oldAsFollower)
        .where(
          and(
            eq(oldAsFollower.followerApId, args.oldActorApId),
            ne(oldAsFollower.followingApId, args.newActorApId),
            notExists(
              args.db
                .select({ one: sql`1` })
                .from(existingFollowerTarget)
                .where(
                  and(
                    eq(existingFollowerTarget.followerApId, args.newActorApId),
                    eq(
                      existingFollowerTarget.followingApId,
                      oldAsFollower.followingApId,
                    ),
                  ),
                ),
            ),
          ),
        ),
    )
    .onConflictDoNothing();

  const localFollowerExists = exists(
    args.db
      .select({ one: sql`1` })
      .from(localFollowerActor)
      .where(eq(localFollowerActor.apId, oldAsFollowee.followerApId)),
  );
  const targetEdgeDoesNotExist = notExists(
    args.db
      .select({ one: sql`1` })
      .from(existingFollowingSource)
      .where(
        and(
          eq(existingFollowingSource.followerApId, oldAsFollowee.followerApId),
          eq(existingFollowingSource.followingApId, args.newActorApId),
        ),
      ),
  );

  const rewriteLocalFollowers = args.db
    .insert(follows)
    .select(
      args.db
        .select({
          followerApId: oldAsFollowee.followerApId,
          followingApId: sql<string>`${args.newActorApId}`.as(
            "following_ap_id",
          ),
          status: sql<string>`'pending'`.as("status"),
          activityApId:
            sql<string>`${args.refollowPrefix} || lower(hex(randomblob(32)))`.as(
              "activity_ap_id",
            ),
          createdAt: oldAsFollowee.createdAt,
          acceptedAt: sql<null>`NULL`.as("accepted_at"),
        })
        .from(oldAsFollowee)
        .where(
          and(
            eq(oldAsFollowee.followingApId, args.oldActorApId),
            ne(oldAsFollowee.followerApId, args.newActorApId),
            targetEdgeDoesNotExist,
            localFollowerExists,
          ),
        ),
    )
    .onConflictDoNothing();

  const rewriteRemoteFollowers = args.db
    .insert(follows)
    .select(
      args.db
        .select({
          followerApId: oldAsFollowee.followerApId,
          followingApId: sql<string>`${args.newActorApId}`.as(
            "following_ap_id",
          ),
          status: oldAsFollowee.status,
          activityApId: oldAsFollowee.activityApId,
          createdAt: oldAsFollowee.createdAt,
          acceptedAt: oldAsFollowee.acceptedAt,
        })
        .from(oldAsFollowee)
        .where(
          and(
            eq(oldAsFollowee.followingApId, args.oldActorApId),
            ne(oldAsFollowee.followerApId, args.newActorApId),
            targetEdgeDoesNotExist,
            notExists(
              args.db
                .select({ one: sql`1` })
                .from(localFollowerActor)
                .where(eq(localFollowerActor.apId, oldAsFollowee.followerApId)),
            ),
          ),
        ),
    )
    .onConflictDoNothing();

  const migratedLocalFollow = alias(follows, "move_migrated_local_follow");
  const recordLocalRefollows = args.db
    .insert(activities)
    .select(
      args.db
        .select({
          apId: migratedLocalFollow.activityApId,
          type: sql<string>`'Follow'`.as("type"),
          actorApId: migratedLocalFollow.followerApId,
          objectApId: sql<string>`${args.newActorApId}`.as("object_ap_id"),
          objectJson: sql<null>`NULL`.as("object_json"),
          targetApId: sql<null>`NULL`.as("target_ap_id"),
          rawJson: sql<string>`json_object(
            '@context', 'https://www.w3.org/ns/activitystreams',
            'id', ${migratedLocalFollow.activityApId},
            'type', 'Follow',
            'actor', ${migratedLocalFollow.followerApId},
            'object', ${args.newActorApId}
          )`.as("raw_json"),
          direction: sql<string>`'outbound'`.as("direction"),
          processed: sql<number>`0`.as("processed"),
          createdAt: sql<string>`datetime('now')`.as("created_at"),
        })
        .from(migratedLocalFollow)
        .where(
          and(
            eq(migratedLocalFollow.followingApId, args.newActorApId),
            sql`instr(${migratedLocalFollow.activityApId}, ${args.refollowPrefix}) = 1`,
          ),
        ),
    )
    .onConflictDoNothing();

  const deleteOldAsFollower = args.db
    .delete(follows)
    .where(eq(follows.followerApId, args.oldActorApId));
  const deleteOldAsFollowee = args.db
    .delete(follows)
    .where(eq(follows.followingApId, args.oldActorApId));

  await runBatch(args.db, [
    decrementLocalFollowers,
    decrementDroppedLocalFollowees,
    rewriteOldAsFollower,
    rewriteLocalFollowers,
    rewriteRemoteFollowers,
    recordLocalRefollows,
    deleteOldAsFollower,
    deleteOldAsFollowee,
  ] as unknown as [D1Statement, ...D1Statement[]]);
}
