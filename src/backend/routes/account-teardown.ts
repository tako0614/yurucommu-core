import { and, asc, eq, gt, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import {
  activities,
  actors,
  announces,
  blocks,
  bookmarks,
  communities,
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
  mutes,
  notificationArchived,
  nowIso,
  objectRecipients,
  objects,
  sessions,
  storyShares,
  storyViews,
  storyVotes,
} from "../../db/index.ts";
import type { Database } from "../../db/index.ts";
import type { Env } from "../types.ts";
import type { IObjectStorage } from "../runtime/types.ts";
import { activityApId, generateId } from "../federation-helpers.ts";
import { snapshotAndEnqueueFollowerDeliveries } from "../lib/delivery/queue-batching.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ component: "actors" });

/**
 * Hard-delete an actor's media uploads and best-effort purge the backing R2
 * objects. The DB rows are removed regardless of whether the object-store
 * delete succeeds; account teardown is never blocked on storage availability.
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
    }
  }
  await db.delete(mediaUploads).where(eq(mediaUploads.uploaderApId, apId));
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
 */
export async function teardownActor(
  db: Database,
  env: Env,
  baseUrl: string,
  apId: string,
  followersUrl: string,
): Promise<void> {
  // Federate the Delete BEFORE local teardown, snapshotting follower inboxes
  // into delivery jobs while the follower graph + activity row still exist. The
  // Delete activity row is preserved through teardown (excluded from the
  // activities delete below) so the deliver_endpoint consumer can read its
  // rawJson after the actor's other rows are gone.
  const deleteActivityId = activityApId(baseUrl, generateId());
  const deleteActivity = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: deleteActivityId,
    type: "Delete",
    actor: apId,
    to: ["https://www.w3.org/ns/activitystreams#Public"],
    cc: [followersUrl],
    object: apId,
  };
  try {
    await db.insert(activities).values({
      apId: deleteActivityId,
      type: "Delete",
      actorApId: apId,
      objectApId: apId,
      rawJson: JSON.stringify(deleteActivity),
      direction: "outbound",
    });
    await snapshotAndEnqueueFollowerDeliveries(db, env, deleteActivityId, apId);
  } catch (err) {
    // Federation is best-effort; never block local teardown on it.
    log.error("Failed to enqueue account Delete federation", {
      event: "actors.account.delete_federation_failed",
      actor: apId,
      error: err,
    });
  }

  await db.delete(sessions).where(eq(sessions.memberId, apId));

  // Reconcile counterparties' follower/following counts BEFORE dropping edges.
  // Only ACCEPTED edges ever incremented a counter; gt(...,0) guards underflow.
  await db
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
    );
  await db
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
    );

  await db
    .delete(follows)
    .where(or(eq(follows.followerApId, apId), eq(follows.followingApId, apId)));
  await db
    .delete(blocks)
    .where(or(eq(blocks.blockerApId, apId), eq(blocks.blockedApId, apId)));
  await db
    .delete(mutes)
    .where(or(eq(mutes.muterApId, apId), eq(mutes.mutedApId, apId)));

  // Reconcile like/announce/share counters on OTHER actors' objects BEFORE
  // deleting this actor's edges (griefable inflated counters otherwise).
  await db
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
    );
  await db
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
    );
  await db
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
    );

  await db.delete(likes).where(eq(likes.actorApId, apId));
  await db.delete(bookmarks).where(eq(bookmarks.actorApId, apId));
  await db.delete(announces).where(eq(announces.actorApId, apId));

  await db.delete(inbox).where(eq(inbox.actorApId, apId));
  await db
    .delete(notificationArchived)
    .where(eq(notificationArchived.actorApId, apId));

  // Media: hard-delete the actor's uploads + best-effort purge backing R2.
  await purgeActorMediaUploads(db, env.MEDIA, apId);

  // Story interactions the actor performed on OTHER/remote stories.
  await db.delete(storyVotes).where(eq(storyVotes.actorApId, apId));
  await db.delete(storyViews).where(eq(storyViews.actorApId, apId));
  await db.delete(storyShares).where(eq(storyShares.actorApId, apId));

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
  const communityApIds = memberships.map((m) => m.communityApId);

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
    }
  }

  if (communityApIds.length > 0) {
    await db
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
      );
  }
  await db.delete(communityMembers).where(eq(communityMembers.actorApId, apId));

  await db
    .delete(objectRecipients)
    .where(eq(objectRecipients.recipientApId, apId));
  // Preserve the federation Delete activity (the delivery consumer needs its
  // rawJson); all other activities by this actor go.
  await db
    .delete(activities)
    .where(
      and(
        eq(activities.actorApId, apId),
        ne(activities.apId, deleteActivityId),
      ),
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

  // Tombstone + scrub the actor row (keep only the delivery signer's key
  // material; free the unique handle by renaming it to a sentinel).
  await db
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
    .where(eq(actors.apId, apId));
}
