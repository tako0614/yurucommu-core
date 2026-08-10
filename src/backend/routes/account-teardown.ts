import {
  and,
  asc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  ne,
  not,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import {
  activities,
  actors,
  announces,
  blocks,
  bookmarks,
  communities,
  communityBans,
  communityInvites,
  communityJoinRequests,
  communityMembers,
  dmArchivedConversations,
  dmCommunityReadStatus,
  dmReadStatus,
  dmTyping,
  follows,
  inbox,
  likes,
  mediaUploads,
  messageStampRefs,
  mutes,
  notificationArchived,
  notificationPushers,
  notificationPushJobs,
  nowIso,
  objectRecipients,
  objects,
  sessions,
  stampEntitlements,
  stampFavorites,
  stampInstallations,
  stampPacks,
  stampRecents,
  storyShares,
  storyViews,
  storyVotes,
} from "../../db/index.ts";
import type { Database } from "../../db/index.ts";
import type { Env } from "../types.ts";
import type { IObjectStorage } from "../runtime/types.ts";
import { activityApId, generateId } from "../federation-helpers.ts";
import { chunkForInClause } from "../lib/chunk.ts";
import { snapshotAndEnqueueFollowerDeliveries } from "../lib/delivery/queue-batching.ts";
import { logger } from "../lib/logger.ts";
import { deleteActivitiesCascade } from "../lib/activity-delete-cascade.ts";

const log = logger.child({ component: "actors" });

// D1 has no interactive transactions, but both the D1 and libsql drivers
// expose an atomic `db.batch([...])` surface. Keep follow-edge removal and its
// counter reconciliation in one batch so a retry can never observe counters
// updated while the edge is still present.
type BatchStatement = BatchItem<"sqlite">;
interface BatchableDb {
  batch(
    statements: readonly [BatchStatement, ...BatchStatement[]],
  ): Promise<unknown>;
}

/**
 * Hard-delete an actor's media uploads after purging the backing R2 objects.
 *
 * The media row is the durable retry/GC identity (`r2_key`). When a configured
 * object store rejects a delete, keep that row and propagate the error so the
 * account route reports failure and a later retry can attempt the same key.
 * Without a MEDIA binding there is no external delete to fail, so metadata can
 * still be removed.
 * Shared by the owner teardown (routes/actors.ts POST /me/delete) and each
 * sub-account teardown in {@link teardownActor}.
 */
export async function purgeActorMediaUploads(
  db: Database,
  media: IObjectStorage | undefined,
  apId: string,
): Promise<void> {
  const uploads = await db
    .select({ r2Key: mediaUploads.r2Key })
    .from(mediaUploads)
    .where(eq(mediaUploads.uploaderApId, apId));
  if (uploads.length === 0) return;
  if (media) {
    const keys = uploads.map((u) => u.r2Key);
    // R2 caps a single delete() at 1000 keys; chunk the purge.
    const R2_DELETE_BATCH = 1000;
    try {
      for (let i = 0; i < keys.length; i += R2_DELETE_BATCH) {
        await media.delete(keys.slice(i, i + R2_DELETE_BATCH));
      }
    } catch (err) {
      log.error("Failed to purge R2 objects for deleted account", {
        event: "actors.account.delete_media_purge_failed",
        actor: apId,
        count: keys.length,
        error: err,
      });
      // Do not discard the only durable identity from which a later retry or
      // GC pass can recover the object. The caller must return a non-success
      // response while the metadata remains available for retry.
      throw err;
    }
  }
  await db.delete(mediaUploads).where(eq(mediaUploads.uploaderApId, apId));
}

/**
 * Tombstone and scrub an actor after every owner/sub-account teardown step has
 * succeeded. Keeping this finalization separate lets the owner route retain a
 * live actor/session while a sub-account still needs a retry.
 */
export async function finalizeActorDeletion(
  db: Database,
  apId: string,
): Promise<void> {
  await actorDeletionUpdate(db, apId);
}

function actorDeletionUpdate(db: Database, apId: string): BatchStatement {
  return db
    .update(actors)
    .set({
      preferredUsername: `deleted-${generateId()}`,
      name: null,
      summary: null,
      iconUrl: null,
      headerUrl: null,
      takosUserId: null,
      followerCount: 0,
      followingCount: 0,
      postCount: 0,
      fieldsJson: "[]",
      alsoKnownAsJson: "[]",
      movedTo: null,
      ownerActorApId: null,
      role: "member",
      deletedAt: nowIso(),
    })
    .where(eq(actors.apId, apId)) as unknown as BatchStatement;
}

/**
 * Commit the owner's final tombstone and every owner/sub-account session
 * deletion together. If either operation fails, D1/libsql rolls the whole
 * batch back so the live owner session can retry the incomplete cascade.
 */
export async function finalizeActorDeletionAndSessions(
  db: Database,
  apId: string,
  sessionActorIds: string[],
): Promise<void> {
  const statements: BatchStatement[] = [actorDeletionUpdate(db, apId)];
  for (const chunk of chunkForInClause(sessionActorIds)) {
    statements.push(
      db
        .delete(sessions)
        .where(inArray(sessions.memberId, chunk)) as unknown as BatchStatement,
    );
  }
  await (db as unknown as BatchableDb).batch(
    statements as [BatchStatement, ...BatchStatement[]],
  );
}

/**
 * Persist one stable outbound Delete intent and snapshot every current remote
 * follower before its authority edge can be removed. Both account actors and
 * community Group actors use the same durable-delivery contract.
 */
async function ensureDeleteFollowerSnapshot(
  db: Database,
  env: Env,
  baseUrl: string,
  subjectApId: string,
  followersUrl: string,
): Promise<string> {
  const existingDelete = await db
    .select({ apId: activities.apId })
    .from(activities)
    .where(
      and(
        eq(activities.actorApId, subjectApId),
        eq(activities.type, "Delete"),
        eq(activities.direction, "outbound"),
      ),
    )
    .orderBy(asc(activities.createdAt))
    .get();
  const deleteActivityId =
    existingDelete?.apId ?? activityApId(baseUrl, generateId());
  const deleteActivity = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: deleteActivityId,
    type: "Delete",
    actor: subjectApId,
    to: ["https://www.w3.org/ns/activitystreams#Public"],
    cc: [followersUrl],
    object: subjectApId,
  };

  if (!existingDelete) {
    await db.insert(activities).values({
      apId: deleteActivityId,
      type: "Delete",
      actorApId: subjectApId,
      objectApId: subjectApId,
      rawJson: JSON.stringify(deleteActivity),
      direction: "outbound",
    });
  }
  await snapshotAndEnqueueFollowerDeliveries(
    db,
    env,
    deleteActivityId,
    subjectApId,
  );
  return deleteActivityId;
}

/**
 * Full per-actor teardown for account deletion: federate Delete(Actor),
 * reconcile every counterparty's denormalized counters, delete all of the
 * actor's edges / interactions / memberships / media / DM state, hand off
 * sole-owned communities to an heir, hard-delete its authored objects, and
 * tombstone+scrub the actor row.
 *
 * Applied to the deleting OWNER **and to each of its sub-accounts** (profiles
 * minted via /accounts + /switch). A sub-account is a first-class actor that can
 * post / follow / like / join+own communities, so without this its "deleted"
 * content stays live in feeds, its edges keep counterparty counters inflated,
 * its memberships keep community rosters/counts wrong (and a sole-owned
 * community becomes permanently unmanageable), and remote followers never learn
 * it is gone. This MUST mirror the owner teardown in routes/actors.ts
 * (POST /me/delete) — keep the two in sync.
 *
 * `followersUrl` is the actor's followers collection (used as the Delete's cc).
 * `options.finalizeActor = false` leaves the actor live for a parent owner
 * route to finalize after every sub-account has completed.
 */
export async function teardownActor(
  db: Database,
  env: Env,
  baseUrl: string,
  apId: string,
  followersUrl: string,
  options: { finalizeActor?: boolean } = {},
): Promise<void> {
  // Federate the Delete BEFORE local teardown, snapshotting follower inboxes
  // into delivery jobs while the follower graph + activity row still exist. The
  // Delete activity row is preserved through teardown (excluded from the
  // activities delete below) so the deliver_endpoint consumer can read its
  // rawJson after the actor's other rows are gone.
  // Retry the same durable Delete intent when an earlier teardown attempt
  // failed after snapshotting followers. Minting a fresh Activity here would
  // see an already-erased follower graph, then the cleanup below could delete
  // the original Activity and its only endpoint/resolution jobs.
  try {
    await ensureDeleteFollowerSnapshot(db, env, baseUrl, apId, followersUrl);
  } catch (err) {
    // Queue publication is already best-effort inside the snapshot helper, but
    // the durable Activity/outbox write is not. Continuing would erase the
    // follower graph and make the missing remote Delete impossible to rebuild.
    // Preserve the live actor/session as retry authority, matching media purge
    // failures later in this same teardown.
    log.error("Failed to persist account Delete follower snapshot", {
      event: "actors.account.delete_snapshot_failed",
      actor: apId,
      error: err,
    });
    throw err;
  }

  // Reconcile counterparties' follower/following counts BEFORE dropping edges.
  // Only ACCEPTED edges ever incremented a counter; gt(...,0) guards underflow.
  // Keep both updates and the edge delete in one atomic batch. If a later
  // teardown step fails, a retry sees either the original edge+counts or the
  // fully removed edge+reconciled counts — never a half-applied decrement.
  await (db as unknown as BatchableDb).batch([
    db
      .update(actors)
      .set({ followerCount: sql`${actors.followerCount} - 1` })
      .where(
        and(
          inArray(
            actors.apId,
            db
              .select({ id: follows.followingApId })
              .from(follows)
              .where(
                and(
                  eq(follows.followerApId, apId),
                  eq(follows.status, "accepted"),
                ),
              ),
          ),
          gt(actors.followerCount, 0),
        ),
      ),
    db
      .update(actors)
      .set({ followingCount: sql`${actors.followingCount} - 1` })
      .where(
        and(
          inArray(
            actors.apId,
            db
              .select({ id: follows.followerApId })
              .from(follows)
              .where(
                and(
                  eq(follows.followingApId, apId),
                  eq(follows.status, "accepted"),
                ),
              ),
          ),
          gt(actors.followingCount, 0),
        ),
      ),
    db
      .delete(follows)
      .where(
        or(eq(follows.followerApId, apId), eq(follows.followingApId, apId)),
      ),
  ]);
  await db
    .delete(blocks)
    .where(or(eq(blocks.blockerApId, apId), eq(blocks.blockedApId, apId)));
  await db
    .delete(mutes)
    .where(or(eq(mutes.muterApId, apId), eq(mutes.mutedApId, apId)));

  // Reconcile like/announce/share counters on OTHER actors' objects together
  // with deleting this actor's edges. If a delete fails after a counter update,
  // a retry must not see the surviving edge and apply the same decrement again.
  await (db as unknown as BatchableDb).batch([
    db
      .update(objects)
      .set({ likeCount: sql`${objects.likeCount} - 1` })
      .where(
        and(
          inArray(
            objects.apId,
            db
              .select({ id: likes.objectApId })
              .from(likes)
              .where(eq(likes.actorApId, apId)),
          ),
          gt(objects.likeCount, 0),
        ),
      ),
    db
      .update(objects)
      .set({ announceCount: sql`${objects.announceCount} - 1` })
      .where(
        and(
          inArray(
            objects.apId,
            db
              .select({ id: announces.objectApId })
              .from(announces)
              .where(eq(announces.actorApId, apId)),
          ),
          gt(objects.announceCount, 0),
        ),
      ),
    db
      .update(objects)
      .set({ shareCount: sql`${objects.shareCount} - 1` })
      .where(
        and(
          inArray(
            objects.apId,
            db
              .select({ id: storyShares.storyApId })
              .from(storyShares)
              .where(eq(storyShares.actorApId, apId)),
          ),
          gt(objects.shareCount, 0),
        ),
      ),
    db.delete(likes).where(eq(likes.actorApId, apId)),
    db.delete(bookmarks).where(eq(bookmarks.actorApId, apId)),
    db.delete(announces).where(eq(announces.actorApId, apId)),
    db.delete(storyShares).where(eq(storyShares.actorApId, apId)),
  ]);

  await db.delete(inbox).where(eq(inbox.actorApId, apId));
  await db
    .delete(notificationArchived)
    .where(eq(notificationArchived.actorApId, apId));

  // Notification push state (no FK cascade — these tables intentionally declare
  // no actors FK; see migrations/0019). Remove the actor's registered pushers
  // (their pushkey is an external push endpoint that must stop being woken) and
  // any durable outbox rows keyed to the actor.
  await db
    .delete(notificationPushers)
    .where(eq(notificationPushers.actorApId, apId));
  await db
    .delete(notificationPushJobs)
    .where(eq(notificationPushJobs.actorApId, apId));

  // Media: purge backing R2 first, then remove the durable upload metadata.
  // A storage failure propagates and leaves the row for the retry path.
  await purgeActorMediaUploads(db, env.MEDIA, apId);

  // Story interactions the actor performed on OTHER/remote stories.
  await db.delete(storyVotes).where(eq(storyVotes.actorApId, apId));
  await db.delete(storyViews).where(eq(storyViews.actorApId, apId));

  // Per-actor DM status metadata (no FK cascade).
  await db.delete(dmReadStatus).where(eq(dmReadStatus.actorApId, apId));
  await db
    .delete(dmCommunityReadStatus)
    .where(eq(dmCommunityReadStatus.actorApId, apId));
  await db
    .delete(dmArchivedConversations)
    .where(eq(dmArchivedConversations.actorApId, apId));
  await db
    .delete(dmTyping)
    .where(or(eq(dmTyping.actorApId, apId), eq(dmTyping.recipientApId, apId)));

  // Actor-scoped Stamp picker and send authority. Published pack content is
  // retained for immutable message history, but deletion closes the pack to
  // new installs/sends instead of rewriting prior Message snapshots.
  await db
    .delete(stampEntitlements)
    .where(eq(stampEntitlements.actorApId, apId));
  await db
    .delete(stampInstallations)
    .where(eq(stampInstallations.actorApId, apId));
  await db.delete(stampFavorites).where(eq(stampFavorites.actorApId, apId));
  await db.delete(stampRecents).where(eq(stampRecents.actorApId, apId));
  await db
    .update(stampPacks)
    .set({ status: "deleted", updatedAt: nowIso() })
    .where(eq(stampPacks.publisherActorId, apId));

  // Community membership lifecycle rows.
  await db
    .delete(communityJoinRequests)
    .where(eq(communityJoinRequests.actorApId, apId));
  await db
    .delete(communityInvites)
    .where(
      or(
        eq(communityInvites.invitedByApId, apId),
        eq(communityInvites.usedByApId, apId),
        eq(communityInvites.invitedApId, apId),
      ),
    );

  const memberships = await db
    .select({
      communityApId: communityMembers.communityApId,
      role: communityMembers.role,
    })
    .from(communityMembers)
    .where(eq(communityMembers.actorApId, apId));
  const retirementCandidates: string[] = [];

  // Hand off sole-owned communities to the oldest remaining member.
  for (const m of memberships) {
    if (m.role !== "owner") continue;
    const otherOwner = await db
      .select({ actorApId: communityMembers.actorApId })
      .from(communityMembers)
      .where(
        and(
          eq(communityMembers.communityApId, m.communityApId),
          eq(communityMembers.role, "owner"),
          ne(communityMembers.actorApId, apId),
        ),
      )
      .get();
    if (otherOwner) continue;
    const heir = await db
      .select({ actorApId: communityMembers.actorApId })
      .from(communityMembers)
      .where(
        and(
          eq(communityMembers.communityApId, m.communityApId),
          ne(communityMembers.actorApId, apId),
        ),
      )
      .orderBy(asc(communityMembers.joinedAt))
      .get();
    if (heir) {
      await db
        .update(communityMembers)
        .set({ role: "owner" })
        .where(
          and(
            eq(communityMembers.communityApId, m.communityApId),
            eq(communityMembers.actorApId, heir.actorApId),
          ),
        );
    } else {
      retirementCandidates.push(m.communityApId);
    }
  }

  // A community with no successor cannot keep a live Group actor after its
  // only owner disappears. Retire it first with an atomic last-member guard.
  // Keeping the membership/follow graph at this stage gives a failed snapshot
  // a durable retry path; once deletedAt is set, every join/write/read route is
  // closed so no new heir can race in between retirement and cleanup.
  const retiredCommunityApIds: string[] = [];
  for (const communityApId of retirementCandidates) {
    const otherMember = db
      .select({ actorApId: communityMembers.actorApId })
      .from(communityMembers)
      .where(
        and(
          eq(communityMembers.communityApId, communityApId),
          ne(communityMembers.actorApId, apId),
        ),
      )
      .limit(1);
    const deletingOwner = db
      .select({ actorApId: communityMembers.actorApId })
      .from(communityMembers)
      .where(
        and(
          eq(communityMembers.communityApId, communityApId),
          eq(communityMembers.actorApId, apId),
          eq(communityMembers.role, "owner"),
        ),
      )
      .limit(1);
    await db
      .update(communities)
      .set({ deletedAt: nowIso() })
      .where(
        and(
          eq(communities.apId, communityApId),
          isNull(communities.deletedAt),
          notExists(otherMember),
          exists(deletingOwner),
        ),
      );

    const retired = await db
      .select({
        deletedAt: communities.deletedAt,
        followersUrl: communities.followersUrl,
      })
      .from(communities)
      .where(eq(communities.apId, communityApId))
      .get();
    if (!retired?.deletedAt) continue;

    try {
      await ensureDeleteFollowerSnapshot(
        db,
        env,
        baseUrl,
        communityApId,
        retired.followersUrl,
      );
    } catch (err) {
      log.error("Failed to persist community Delete follower snapshot", {
        event: "actors.account.community_delete_snapshot_failed",
        actor: apId,
        community: communityApId,
        error: err,
      });
      throw err;
    }
    retiredCommunityApIds.push(communityApId);
  }

  if (memberships.length > 0) {
    // Keep the denormalized count and its membership authority edge atomic.
    // Otherwise a failed DELETE leaves the edge visible to a retry, which
    // would decrement the same community for a second time.
    const membershipCleanup: BatchStatement[] = [
      db
        .update(communities)
        .set({ memberCount: sql`${communities.memberCount} - 1` })
        .where(
          and(
            inArray(
              communities.apId,
              db
                .select({ id: communityMembers.communityApId })
                .from(communityMembers)
                .where(eq(communityMembers.actorApId, apId)),
            ),
            gt(communities.memberCount, 0),
          ),
        ) as unknown as BatchStatement,
    ];

    // A retired Group keeps its row + signing keys while the durable Delete
    // drains, but no membership, moderation/read state, or follow authority
    // should remain. Chunk every IN predicate for D1's 100-bind limit and keep
    // all retirement cleanup in the same batch as memberCount + membership.
    // The follows DELETE binds each id twice (follower OR following), so use
    // 45 rather than the normal 90 to stay below D1's 100-bind query ceiling.
    for (const chunk of chunkForInClause(retiredCommunityApIds, 45)) {
      membershipCleanup.push(
        db
          .delete(follows)
          .where(
            or(
              inArray(follows.followerApId, chunk),
              inArray(follows.followingApId, chunk),
            ),
          ) as unknown as BatchStatement,
        db
          .delete(communityJoinRequests)
          .where(
            inArray(communityJoinRequests.communityApId, chunk),
          ) as unknown as BatchStatement,
        db
          .delete(communityInvites)
          .where(
            inArray(communityInvites.communityApId, chunk),
          ) as unknown as BatchStatement,
        db
          .delete(communityBans)
          .where(
            inArray(communityBans.communityApId, chunk),
          ) as unknown as BatchStatement,
        db
          .delete(dmCommunityReadStatus)
          .where(
            inArray(dmCommunityReadStatus.communityApId, chunk),
          ) as unknown as BatchStatement,
      );
    }
    membershipCleanup.push(
      db
        .delete(communityMembers)
        .where(
          eq(communityMembers.actorApId, apId),
        ) as unknown as BatchStatement,
    );
    await (db as unknown as BatchableDb).batch(
      membershipCleanup as [BatchStatement, ...BatchStatement[]],
    );
  }

  await db
    .delete(objectRecipients)
    .where(eq(objectRecipients.recipientApId, apId));
  // Preserve every outbound federation Delete activity (the delivery consumer
  // needs rawJson). Current retries reuse the oldest one, while retaining all
  // covers rows created by older builds without cancelling their delivery
  // projections before they drain.
  await deleteActivitiesCascade(
    db,
    and(
      eq(activities.actorApId, apId),
      not(
        and(
          eq(activities.type, "Delete"),
          eq(activities.direction, "outbound"),
        )!,
      ),
    )!,
  );

  // Interactions on the actor's authored objects, via subqueries.
  const authoredObjectIds = () =>
    db
      .select({ id: objects.apId })
      .from(objects)
      .where(eq(objects.attributedTo, apId));
  await db.delete(likes).where(inArray(likes.objectApId, authoredObjectIds()));
  await db
    .delete(announces)
    .where(inArray(announces.objectApId, authoredObjectIds()));
  await db
    .delete(bookmarks)
    .where(inArray(bookmarks.objectApId, authoredObjectIds()));
  await db
    .delete(storyVotes)
    .where(inArray(storyVotes.storyApId, authoredObjectIds()));
  await db
    .delete(storyViews)
    .where(inArray(storyViews.storyApId, authoredObjectIds()));
  await db
    .delete(storyShares)
    .where(inArray(storyShares.storyApId, authoredObjectIds()));
  await db
    .delete(objectRecipients)
    .where(inArray(objectRecipients.objectApId, authoredObjectIds()));
  await db
    .delete(messageStampRefs)
    .where(inArray(messageStampRefs.messageId, authoredObjectIds()));

  // Recompute affected parents' replyCount as COUNT(*) of remaining replies.
  await db
    .update(objects)
    .set({
      replyCount: sql`(SELECT COUNT(*) FROM objects AS child WHERE child.in_reply_to = ${objects.apId} AND child.attributed_to <> ${apId})`,
    })
    .where(
      inArray(
        objects.apId,
        db
          .select({ id: objects.inReplyTo })
          .from(objects)
          .where(
            and(eq(objects.attributedTo, apId), isNotNull(objects.inReplyTo)),
          ),
      ),
    );

  await db.delete(objects).where(eq(objects.attributedTo, apId));

  // Tombstone + scrub the actor row only when the caller asks for immediate
  // finalization. The owner route defers this final step until every
  // sub-account has completed, retaining a live retry authority on failure.
  if (options.finalizeActor !== false) {
    await finalizeActorDeletion(db, apId);
  }
}
