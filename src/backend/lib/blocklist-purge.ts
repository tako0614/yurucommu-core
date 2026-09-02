import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  activities,
  actors,
  announces,
  bookmarks,
  follows,
  likes,
  objects,
  runBatch,
  storyShares,
  storyViews,
  storyVotes,
} from "../../db/index.ts";
import type { Database } from "../../db/index.ts";
import type { ObjectStore } from "../runtime/types.ts";
import { chunkForInClause, D1_IN_CHUNK } from "./chunk.ts";
import { normalizeDomain } from "./blocklist.ts";
import { isSameActivityPubActor } from "./activitypub-actor-identity.ts";
import {
  deleteObjectsCascade,
  purgeMediaBlobs,
} from "../routes/posts/delete-cascade.ts";
import { logger } from "./logger.ts";
import { deleteActivitiesCascade } from "./activity-delete-cascade.ts";

const log = logger.child({ component: "blocklist" });

// Actor identity equivalence cannot use a simple indexed equality lookup: the
// accepted cosmetic spellings include host case, default ports, fragments,
// and one trailing slash. Scan retained identity columns in fixed-size pages
// instead of re-materializing the whole table once per delete chunk.
const ACTOR_IDENTITY_SCAN_PAGE = 512;

// An exact-actor purge can carry both a page of retained raw actor spellings
// and a page of affected object/counterpart ids in the same DELETE. Keep their
// combined bound parameters below D1's 100-variable ceiling with headroom for
// any fixed predicate values. Domain purges bind two additional host values.
const INTERACTION_EDGE_PAGE = 40;

export interface BlocklistContentPurgeResult {
  complete: boolean;
  deletedObjects: number;
  deletedActivities: number;
}

/**
 * Match an HTTP(S) ActivityPub URL by its exact hostname or a real subdomain.
 *
 * Do not replace this with LIKE. Cloudflare D1 rejects sufficiently long LIKE
 * patterns as too complex, which previously made a valid long domain block
 * retain all historical content. Extracting the authority with literal
 * instr/substr operations also keeps domain text in the URL path, lookalike
 * suffixes, and credentials outside the match. Parse the authority down to its
 * hostname so an explicit HTTPS port and a DNS root dot have the same meaning
 * as the block decision path.
 */
function activityPubUrlHostMatchesDomain(
  column: SQLiteColumn,
  domain: string,
): SQL {
  const lowerUrl = sql`lower(${column})`;
  const schemeSeparator = sql`instr(${lowerUrl}, '://')`;
  const scheme = sql`substr(${lowerUrl}, 1, ${schemeSeparator} - 1)`;
  const authorityTail = sql`substr(${lowerUrl}, ${schemeSeparator} + 3)`;
  const slash = sql`instr(${authorityTail}, '/')`;
  const authority = sql`substr(${authorityTail}, 1, ${slash} - 1)`;
  const closingBracket = sql`instr(${authority}, ']')`;
  const hostWithRootDot = sql`
    CASE
      WHEN substr(${authority}, 1, 1) = '[' AND ${closingBracket} > 1
        THEN substr(${authority}, 1, ${closingBracket})
      WHEN instr(${authority}, ':') > 0
        THEN substr(${authority}, 1, instr(${authority}, ':') - 1)
      ELSE ${authority}
    END
  `;
  const host = sql`
    CASE
      WHEN substr(${hostWithRootDot}, -1) = '.'
        THEN substr(${hostWithRootDot}, 1, length(${hostWithRootDot}) - 1)
      ELSE ${hostWithRootDot}
    END
  `;
  const subdomainSuffix = `.${domain}`;

  return sql`
    ${schemeSeparator} > 1
    AND ${scheme} IN ('http', 'https')
    AND ${slash} > 1
    AND instr(${authority}, '@') = 0
    AND (
      ${host} = ${domain}
      OR substr(${host}, -length(${subdomainSuffix})) = ${subdomainSuffix}
    )
  `;
}

// Hard-delete a set of objects (with their child cascade + R2 blobs). Shared by
// the actor / domain purge below. apIds are EXACTLY the objects to remove.
async function purgeObjects(
  db: Database,
  apIds: string[],
  media?: ObjectStore,
): Promise<void> {
  if (apIds.length === 0) return;
  const parentRows = await db
    .selectDistinct({ apId: objects.inReplyTo })
    .from(objects)
    .where(and(inArray(objects.apId, apIds), isNotNull(objects.inReplyTo)));
  const parentApIds = parentRows.flatMap((row) =>
    typeof row.apId === "string" ? [row.apId] : [],
  );
  const mediaKeys = await deleteObjectsCascade(db, apIds, media);
  for (const chunk of chunkForInClause(apIds)) {
    // Co-commit the authored-object delete with an exact recomputation of every
    // surviving parent touched by this page. A retry can therefore never see a
    // deleted reply whose contribution remains stranded in reply_count.
    await runBatch(db, [
      db.delete(objects).where(inArray(objects.apId, chunk)),
      db
        .update(objects)
        .set({
          replyCount: sql`(SELECT COUNT(*) FROM ${objects} AS retained_reply WHERE retained_reply.in_reply_to = ${objects.apId})`,
        })
        .where(inArray(objects.apId, parentApIds)),
    ]);
  }
  await purgeMediaBlobs(media, mediaKeys);
}

type ActorEdgeWhere = (column: SQLiteColumn) => SQL;

type InteractionEdge = { actorApId: string; targetApId: string };

async function drainAffectedEdges(
  selectPage: () => Promise<InteractionEdge[]>,
  mutatePage: (edges: InteractionEdge[]) => Promise<void>,
): Promise<void> {
  while (true) {
    const rows = await selectPage();
    if (rows.length === 0) return;
    await mutatePage(rows);
  }
}

function exactEdgePairsWhere(
  actorColumn: SQLiteColumn,
  targetColumn: SQLiteColumn,
  edges: InteractionEdge[],
): SQL {
  return or(
    ...edges.map((edge) =>
      and(eq(actorColumn, edge.actorApId), eq(targetColumn, edge.targetApId)),
    ),
  )!;
}

function affectedTargetApIds(edges: InteractionEdge[]): string[] {
  return [...new Set(edges.map((edge) => edge.targetApId))];
}

/**
 * Remove every retained interaction performed by one actor predicate against
 * still-present content and reconcile denormalized counters from the surviving
 * edges. Each page is one atomic delete+recompute unit, so a 503 retry resumes
 * from remaining edges without leaving an already-deleted contribution in a
 * visible count.
 */
async function purgeRetainedInteractionEdges(
  db: Database,
  actorWhere: ActorEdgeWhere,
): Promise<void> {
  await drainAffectedEdges(
    () =>
      db
        .select({ actorApId: likes.actorApId, targetApId: likes.objectApId })
        .from(likes)
        .where(actorWhere(likes.actorApId))
        .orderBy(asc(likes.actorApId), asc(likes.objectApId))
        .limit(INTERACTION_EDGE_PAGE),
    (edges) => {
      const targetApIds = affectedTargetApIds(edges);
      return runBatch(db, [
        db
          .delete(likes)
          .where(exactEdgePairsWhere(likes.actorApId, likes.objectApId, edges)),
        db
          .update(objects)
          .set({
            likeCount: sql`(SELECT COUNT(*) FROM ${likes} WHERE ${likes.objectApId} = ${objects.apId})`,
          })
          .where(inArray(objects.apId, targetApIds)),
      ]);
    },
  );

  await drainAffectedEdges(
    () =>
      db
        .select({
          actorApId: announces.actorApId,
          targetApId: announces.objectApId,
        })
        .from(announces)
        .where(actorWhere(announces.actorApId))
        .orderBy(asc(announces.actorApId), asc(announces.objectApId))
        .limit(INTERACTION_EDGE_PAGE),
    (edges) => {
      const targetApIds = affectedTargetApIds(edges);
      return runBatch(db, [
        db
          .delete(announces)
          .where(
            exactEdgePairsWhere(
              announces.actorApId,
              announces.objectApId,
              edges,
            ),
          ),
        db
          .update(objects)
          .set({
            announceCount: sql`(SELECT COUNT(*) FROM ${announces} WHERE ${announces.objectApId} = ${objects.apId})`,
          })
          .where(inArray(objects.apId, targetApIds)),
      ]);
    },
  );

  await drainAffectedEdges(
    () =>
      db
        .select({
          actorApId: storyShares.actorApId,
          targetApId: storyShares.storyApId,
        })
        .from(storyShares)
        .where(actorWhere(storyShares.actorApId))
        .orderBy(asc(storyShares.actorApId), asc(storyShares.storyApId))
        .limit(INTERACTION_EDGE_PAGE),
    (edges) => {
      const targetApIds = affectedTargetApIds(edges);
      return runBatch(db, [
        db
          .delete(storyShares)
          .where(
            exactEdgePairsWhere(
              storyShares.actorApId,
              storyShares.storyApId,
              edges,
            ),
          ),
        db
          .update(objects)
          .set({
            shareCount: sql`(SELECT COUNT(*) FROM ${storyShares} WHERE ${storyShares.storyApId} = ${objects.apId})`,
          })
          .where(inArray(objects.apId, targetApIds)),
      ]);
    },
  );

  await drainAffectedEdges(
    () =>
      db
        .select({
          actorApId: bookmarks.actorApId,
          targetApId: bookmarks.objectApId,
        })
        .from(bookmarks)
        .where(actorWhere(bookmarks.actorApId))
        .orderBy(asc(bookmarks.actorApId), asc(bookmarks.objectApId))
        .limit(INTERACTION_EDGE_PAGE),
    async (edges) => {
      await db
        .delete(bookmarks)
        .where(
          exactEdgePairsWhere(bookmarks.actorApId, bookmarks.objectApId, edges),
        );
    },
  );

  await drainAffectedEdges(
    () =>
      db
        .select({
          actorApId: storyViews.actorApId,
          targetApId: storyViews.storyApId,
        })
        .from(storyViews)
        .where(actorWhere(storyViews.actorApId))
        .orderBy(asc(storyViews.actorApId), asc(storyViews.storyApId))
        .limit(INTERACTION_EDGE_PAGE),
    async (edges) => {
      await db
        .delete(storyViews)
        .where(
          exactEdgePairsWhere(
            storyViews.actorApId,
            storyViews.storyApId,
            edges,
          ),
        );
    },
  );

  await drainAffectedEdges(
    () =>
      db
        .select({
          actorApId: storyVotes.actorApId,
          targetApId: storyVotes.storyApId,
        })
        .from(storyVotes)
        .where(actorWhere(storyVotes.actorApId))
        .orderBy(asc(storyVotes.actorApId), asc(storyVotes.storyApId))
        .limit(INTERACTION_EDGE_PAGE),
    async (edges) => {
      await db
        .delete(storyVotes)
        .where(
          exactEdgePairsWhere(
            storyVotes.actorApId,
            storyVotes.storyApId,
            edges,
          ),
        );
    },
  );

  // A blocked remote following a local actor contributes to follower_count;
  // a local actor following the blocked remote contributes to following_count.
  // Delete first, then recompute the local counterpart in the same batch.
  await drainAffectedEdges(
    () =>
      db
        .select({
          actorApId: follows.followerApId,
          targetApId: follows.followingApId,
        })
        .from(follows)
        .where(actorWhere(follows.followerApId))
        .orderBy(asc(follows.followerApId), asc(follows.followingApId))
        .limit(INTERACTION_EDGE_PAGE),
    (edges) => {
      const targetApIds = affectedTargetApIds(edges);
      return runBatch(db, [
        db
          .delete(follows)
          .where(
            exactEdgePairsWhere(
              follows.followerApId,
              follows.followingApId,
              edges,
            ),
          ),
        db
          .update(actors)
          .set({
            followerCount: sql`(SELECT COUNT(*) FROM ${follows} WHERE ${follows.followingApId} = ${actors.apId} AND ${follows.status} = 'accepted')`,
          })
          .where(inArray(actors.apId, targetApIds)),
      ]);
    },
  );

  await drainAffectedEdges(
    () =>
      db
        .select({
          actorApId: follows.followingApId,
          targetApId: follows.followerApId,
        })
        .from(follows)
        .where(actorWhere(follows.followingApId))
        .orderBy(asc(follows.followingApId), asc(follows.followerApId))
        .limit(INTERACTION_EDGE_PAGE),
    (edges) => {
      const targetApIds = affectedTargetApIds(edges);
      return runBatch(db, [
        db
          .delete(follows)
          .where(
            exactEdgePairsWhere(
              follows.followingApId,
              follows.followerApId,
              edges,
            ),
          ),
        db
          .update(actors)
          .set({
            followingCount: sql`(SELECT COUNT(*) FROM ${follows} WHERE ${follows.followerApId} = ${actors.apId} AND ${follows.status} = 'accepted')`,
          })
          .where(inArray(actors.apId, targetApIds)),
      ]);
    },
  );
}

type ActorIdentityPage = (
  cursor: string | undefined,
) => Promise<{ actorApId: string }[]>;

async function purgeActorInteractionIdentityPages(
  db: Database,
  blockedApId: string,
  selectPage: ActorIdentityPage,
): Promise<void> {
  let cursor: string | undefined;
  while (true) {
    const rows = await selectPage(cursor);
    if (rows.length === 0) return;
    cursor = rows[rows.length - 1]!.actorApId;
    const aliases = rows
      .map((row) => row.actorApId)
      .filter((actorApId) => isSameActivityPubActor(actorApId, blockedApId));
    for (
      let index = 0;
      index < aliases.length;
      index += INTERACTION_EDGE_PAGE
    ) {
      const chunk = aliases.slice(index, index + INTERACTION_EDGE_PAGE);
      await purgeRetainedInteractionEdges(db, (column) =>
        inArray(column, chunk),
      );
    }
  }
}

/**
 * Scan each interaction identity column in bounded distinct pages. Keep these
 * as separate selects: Cloudflare D1 rejects the formerly convenient eight-way
 * UNION with `too many terms in compound SELECT`, even though libsql accepts it.
 * Purging a discovered alias across every table before scanning the next table
 * is safe and reduces later pages without losing aliases unique to that table.
 */
async function purgeActorInteractionEdges(
  db: Database,
  blockedApId: string,
): Promise<void> {
  const scan = (selectPage: ActorIdentityPage) =>
    purgeActorInteractionIdentityPages(db, blockedApId, selectPage);

  await scan((cursor) =>
    db
      .selectDistinct({ actorApId: likes.actorApId })
      .from(likes)
      .where(cursor === undefined ? undefined : gt(likes.actorApId, cursor))
      .orderBy(asc(likes.actorApId))
      .limit(ACTOR_IDENTITY_SCAN_PAGE),
  );
  await scan((cursor) =>
    db
      .selectDistinct({ actorApId: announces.actorApId })
      .from(announces)
      .where(cursor === undefined ? undefined : gt(announces.actorApId, cursor))
      .orderBy(asc(announces.actorApId))
      .limit(ACTOR_IDENTITY_SCAN_PAGE),
  );
  await scan((cursor) =>
    db
      .selectDistinct({ actorApId: bookmarks.actorApId })
      .from(bookmarks)
      .where(cursor === undefined ? undefined : gt(bookmarks.actorApId, cursor))
      .orderBy(asc(bookmarks.actorApId))
      .limit(ACTOR_IDENTITY_SCAN_PAGE),
  );
  await scan((cursor) =>
    db
      .selectDistinct({ actorApId: storyShares.actorApId })
      .from(storyShares)
      .where(
        cursor === undefined ? undefined : gt(storyShares.actorApId, cursor),
      )
      .orderBy(asc(storyShares.actorApId))
      .limit(ACTOR_IDENTITY_SCAN_PAGE),
  );
  await scan((cursor) =>
    db
      .selectDistinct({ actorApId: storyViews.actorApId })
      .from(storyViews)
      .where(
        cursor === undefined ? undefined : gt(storyViews.actorApId, cursor),
      )
      .orderBy(asc(storyViews.actorApId))
      .limit(ACTOR_IDENTITY_SCAN_PAGE),
  );
  await scan((cursor) =>
    db
      .selectDistinct({ actorApId: storyVotes.actorApId })
      .from(storyVotes)
      .where(
        cursor === undefined ? undefined : gt(storyVotes.actorApId, cursor),
      )
      .orderBy(asc(storyVotes.actorApId))
      .limit(ACTOR_IDENTITY_SCAN_PAGE),
  );
  await scan((cursor) =>
    db
      .selectDistinct({ actorApId: follows.followerApId })
      .from(follows)
      .where(
        cursor === undefined ? undefined : gt(follows.followerApId, cursor),
      )
      .orderBy(asc(follows.followerApId))
      .limit(ACTOR_IDENTITY_SCAN_PAGE),
  );
  await scan((cursor) =>
    db
      .selectDistinct({ actorApId: follows.followingApId })
      .from(follows)
      .where(
        cursor === undefined ? undefined : gt(follows.followingApId, cursor),
      )
      .orderBy(asc(follows.followingApId))
      .limit(ACTOR_IDENTITY_SCAN_PAGE),
  );
}

/**
 * Delete a predicate's objects in bounded, retryable units.
 *
 * Selecting every matching id before the first delete made a large domain
 * block consume memory in direct proportion to retained history. Keeping each
 * unit at D1_IN_CHUNK also means a failed statement leaves at most one page
 * incomplete; retrying the idempotent operator block resumes from the rows that
 * remain instead of rebuilding an unbounded in-memory id set. A stable AP-ID
 * keyset prevents unmatched history before the current page from being scanned
 * again after each successful delete.
 */
async function purgeMatchingObjects(
  db: Database,
  where: SQL,
  media?: ObjectStore,
  onPageDeleted?: (count: number) => void,
): Promise<void> {
  let cursor: string | undefined;
  while (true) {
    const rows = await db
      .select({ apId: objects.apId })
      .from(objects)
      .where(
        cursor === undefined ? where : and(where, gt(objects.apId, cursor)),
      )
      .orderBy(asc(objects.apId))
      .limit(D1_IN_CHUNK);
    if (rows.length === 0) return;
    cursor = rows[rows.length - 1]!.apId;
    await purgeObjects(
      db,
      rows.map((row) => row.apId),
      media,
    );
    onPageDeleted?.(rows.length);
  }
}

async function purgeMatchingActivities(
  db: Database,
  where: SQL,
  onPageDeleted?: (count: number) => void,
): Promise<void> {
  let cursor: string | undefined;
  while (true) {
    const rows = await db
      .select({ apId: activities.apId })
      .from(activities)
      .where(
        cursor === undefined ? where : and(where, gt(activities.apId, cursor)),
      )
      .orderBy(asc(activities.apId))
      .limit(D1_IN_CHUNK);
    if (rows.length === 0) return;
    cursor = rows[rows.length - 1]!.apId;
    await deleteActivitiesCascade(
      db,
      inArray(
        activities.apId,
        rows.map((row) => row.apId),
      ),
    );
    onPageDeleted?.(rows.length);
  }
}

/**
 * Scan retained objects once by stable AP-ID and remove matching actor rows in
 * D1-sized units. The operator block is active before this cleanup starts, so
 * the scan does not have to restart from the beginning after every delete.
 */
async function purgeActorObjects(
  db: Database,
  blockedApId: string,
  media?: ObjectStore,
  onPageDeleted?: (count: number) => void,
): Promise<void> {
  let cursor: string | undefined;
  while (true) {
    const rows = await db
      .select({ apId: objects.apId, attributedTo: objects.attributedTo })
      .from(objects)
      .where(cursor === undefined ? undefined : gt(objects.apId, cursor))
      .orderBy(asc(objects.apId))
      .limit(ACTOR_IDENTITY_SCAN_PAGE);
    if (rows.length === 0) return;
    cursor = rows[rows.length - 1]!.apId;

    const targetApIds = rows
      .filter((row) => isSameActivityPubActor(row.attributedTo, blockedApId))
      .map((row) => row.apId);
    for (const chunk of chunkForInClause(targetApIds)) {
      await purgeObjects(db, chunk, media);
      onPageDeleted?.(chunk.length);
    }
  }
}

async function purgeActorActivities(
  db: Database,
  blockedApId: string,
  onPageDeleted?: (count: number) => void,
): Promise<void> {
  let cursor: string | undefined;
  while (true) {
    const rows = await db
      .select({ apId: activities.apId, actorApId: activities.actorApId })
      .from(activities)
      .where(cursor === undefined ? undefined : gt(activities.apId, cursor))
      .orderBy(asc(activities.apId))
      .limit(ACTOR_IDENTITY_SCAN_PAGE);
    if (rows.length === 0) return;
    cursor = rows[rows.length - 1]!.apId;

    const targetApIds = rows
      .filter((row) => isSameActivityPubActor(row.actorApId, blockedApId))
      .map((row) => row.apId);
    for (const chunk of chunkForInClause(targetApIds)) {
      await deleteActivitiesCascade(db, inArray(activities.apId, chunk));
      onPageDeleted?.(chunk.length);
    }
  }
}

/**
 * Purge a blocked REMOTE actor's already-ingested content. The operator
 * blocklist is otherwise ingest/delivery-only, so without this a defederated
 * actor's prior posts/replies/stories stay live in timelines, search, and
 * object serving — contradicting the operator's "they're gone" expectation.
 * Removes the actor's authored objects (cascade) + their activity ledger rows.
 * Failures are logged and returned to the operator route. The block mutation
 * remains active, while a non-success response makes retry converge cleanup.
 */
export async function purgeActorContent(
  db: Database,
  blockedApId: string,
  media?: ObjectStore,
): Promise<BlocklistContentPurgeResult> {
  let deletedObjects = 0;
  let deletedActivities = 0;
  try {
    // Clean still-visible local counterpart state first. If a later media/
    // authored-content page fails, the active block no longer leaves the
    // blocked actor's reactions or relationship counts exposed while the
    // operator retries the idempotent cleanup.
    await purgeActorInteractionEdges(db, blockedApId);
    await purgeActorObjects(db, blockedApId, media, (count) => {
      deletedObjects += count;
    });
    await purgeActorActivities(db, blockedApId, (count) => {
      deletedActivities += count;
    });
    return { complete: true, deletedObjects, deletedActivities };
  } catch (err) {
    log.warn("blocklist.purgeActorContent failed", {
      event: "blocklist.purge_actor_failed",
      actor: blockedApId,
      error: err,
    });
    return { complete: false, deletedObjects, deletedActivities };
  }
}

/**
 * Purge already-ingested content authored by any actor on a blocked DOMAIN (the
 * host itself OR a subdomain). Host-boundary matching means `evil.com` matches
 * `https://evil.com/...` and `https://node1.evil.com/...` but NOT `notevil.com`.
 * Failures are logged and returned to the operator route so its response can
 * require a retry. Local content is never matched (local objects carry the
 * local host; the operator never blocks their own domain).
 */
export async function purgeDomainContent(
  db: Database,
  domainOrUrl: string,
  media?: ObjectStore,
): Promise<BlocklistContentPurgeResult> {
  const domain = normalizeDomain(domainOrUrl);
  if (!domain) {
    return { complete: true, deletedObjects: 0, deletedActivities: 0 };
  }
  let deletedObjects = 0;
  let deletedActivities = 0;
  try {
    await purgeRetainedInteractionEdges(db, (column) =>
      activityPubUrlHostMatchesDomain(column, domain),
    );
    await purgeMatchingObjects(
      db,
      activityPubUrlHostMatchesDomain(objects.attributedTo, domain),
      media,
      (count) => {
        deletedObjects += count;
      },
    );
    await purgeMatchingActivities(
      db,
      activityPubUrlHostMatchesDomain(activities.actorApId, domain),
      (count) => {
        deletedActivities += count;
      },
    );
    return { complete: true, deletedObjects, deletedActivities };
  } catch (err) {
    log.warn("blocklist.purgeDomainContent failed", {
      event: "blocklist.purge_domain_failed",
      domain,
      error: err,
    });
    return { complete: false, deletedObjects, deletedActivities };
  }
}
