import { and, eq, or, sql } from "drizzle-orm";
import {
  activities,
  communities,
  follows,
  objectRecipients,
  objects,
} from "../../../../db/index.ts";
import {
  activityApId,
  generateId,
  getDomain,
  isLocal,
  objectApId,
} from "../../../federation-helpers.ts";
import { enqueueDeliveryToActor } from "../../../lib/delivery/queue.ts";
import type { InstanceActorResult } from "../query-helpers.ts";
import {
  type Activity,
  type ActivityContext,
  getActivityObject,
  getActivityObjectId,
} from "../inbox-types.ts";

const AS_CONTEXT = "https://www.w3.org/ns/activitystreams";

const JOIN_POLICY_STATUS: Record<string, "accepted" | "pending" | "rejected"> =
  {
    approval: "pending",
    invite: "rejected",
  };

/**
 * Minimal shape of a Group-style actor whose inbox accepts Follows: the
 * instance actor AND any community Group share this handler. Only the apId
 * (the thing being followed / signed as) and the joinPolicy (auto-accept vs
 * hold pending) are needed, so both `InstanceActorResult` and a loaded
 * community satisfy it structurally.
 */
export interface GroupFollowTarget {
  apId: string;
  joinPolicy?: string;
}

export async function handleGroupFollow(
  c: ActivityContext,
  _activity: Activity,
  group: GroupFollowTarget,
  actorApIdStr: string,
  baseUrl: string,
  activityId: string,
) {
  const db = c.get("db");
  const followerKey = {
    followerApId: actorApIdStr,
    followingApId: group.apId,
  };

  const existing = await db.query.follows.findFirst({
    where: and(
      eq(follows.followerApId, followerKey.followerApId),
      eq(follows.followingApId, followerKey.followingApId),
    ),
  });
  if (existing) return;

  const status = JOIN_POLICY_STATUS[group.joinPolicy ?? ""] ?? "accepted";

  const now = new Date().toISOString();
  await db.insert(follows).values({
    ...followerKey,
    status,
    activityApId: activityId,
    acceptedAt: status === "accepted" ? now : null,
  });

  if (isLocal(actorApIdStr, baseUrl)) return;
  if (status === "pending") return;

  const responseType = status === "accepted" ? "Accept" : "Reject";
  const responseId = activityApId(baseUrl, generateId());
  const responseActivity = {
    "@context": AS_CONTEXT,
    id: responseId,
    type: responseType,
    actor: group.apId,
    object: activityId,
  };

  await db.insert(activities).values({
    apId: responseId,
    type: responseType,
    actorApId: group.apId,
    objectApId: activityId,
    rawJson: JSON.stringify(responseActivity),
    direction: "outbound",
  });

  // Outbound delivery must be async (no remote POST in request path). The
  // Accept is signed by `group.apId` — queue-delivery resolves the community /
  // instance-actor key for that apId.
  await enqueueDeliveryToActor(c.env, responseId, actorApIdStr);
}

export async function handleGroupUndo(
  c: ActivityContext,
  activity: Activity,
  group: GroupFollowTarget,
) {
  const db = c.get("db");
  const objectId = getActivityObjectId(activity);
  if (!objectId) return;

  // Try exact match by activity AP ID first.
  const follow = await db.query.follows.findFirst({
    where: and(
      eq(follows.activityApId, objectId),
      eq(follows.followingApId, group.apId),
    ),
  });

  if (follow) {
    await db
      .delete(follows)
      .where(
        and(
          eq(follows.followerApId, follow.followerApId),
          eq(follows.followingApId, follow.followingApId),
        ),
      );
    return;
  }

  // Fallback: if the undone object is a Follow, delete by actor pair.
  if (getActivityObject(activity)?.type !== "Follow") return;

  await db
    .delete(follows)
    .where(
      and(
        eq(follows.followerApId, activity.actor as string),
        eq(follows.followingApId, group.apId),
      ),
    );
}

export async function handleGroupCreate(
  c: ActivityContext,
  activity: Activity,
  instanceActor: InstanceActorResult,
  actorApIdStr: string,
  baseUrl: string,
) {
  const db = c.get("db");
  const object = getActivityObject(activity);
  if (!object || object.type !== "Note") return;

  if (object.id) {
    try {
      if (
        isLocal(object.id, baseUrl) ||
        getDomain(object.id) !== getDomain(actorApIdStr)
      ) {
        return;
      }
    } catch {
      return;
    }
  }

  const roomUrl = object.room || activity.room;
  if (!roomUrl || typeof roomUrl !== "string") return;
  const match = roomUrl.match(/\/ap\/rooms\/([^\/]+)$/);
  if (!match) return;
  const roomId = match[1];

  const community = await db.query.communities.findFirst({
    where: or(
      eq(communities.preferredUsername, roomId),
      eq(communities.apId, roomId),
    ),
    columns: { apId: true, preferredUsername: true },
  });
  if (!community) return;

  const postingPolicy = instanceActor.postingPolicy || "members";
  if (postingPolicy !== "anyone") {
    const followRecord = await db.query.follows.findFirst({
      where: and(
        eq(follows.followerApId, actorApIdStr),
        eq(follows.followingApId, instanceActor.apId),
        eq(follows.status, "accepted"),
      ),
    });
    if (!followRecord) return;
    if (postingPolicy === "mods" || postingPolicy === "owners") return;
  }

  const newObjectId = object.id || objectApId(baseUrl, generateId());
  const existingObj = await db.query.objects.findFirst({
    where: eq(objects.apId, newObjectId),
  });
  if (existingObj) return;

  const attachments = object.attachment
    ? JSON.stringify(object.attachment)
    : "[]";
  const now = object.published || new Date().toISOString();

  // This is a federated room (group-CHAT) message, addressed to the community
  // via the object_recipients audience link below. The chat reader and the
  // chat unread count (communities/messages.ts, dm/contacts.ts) treat the chat
  // object-set as audience-linked Notes with `communityApId IS NULL`, disjoint
  // from the feed object-set (which carries `communityApId`). Leave
  // `communityApId` NULL here so the message surfaces in the group chat and
  // unread count rather than being misrouted into the community feed.
  await db.insert(objects).values({
    apId: newObjectId,
    type: "Note",
    attributedTo: actorApIdStr,
    content: object.content || "",
    summary: object.summary || null,
    attachmentsJson: attachments,
    visibility: "group",
    communityApId: null,
    published: now,
    isLocal: 0,
  });

  // Using raw SQL with INSERT OR IGNORE since ObjectRecipient FK expects Actor, not Community
  await db.run(sql`
    INSERT OR IGNORE INTO object_recipients (object_ap_id, recipient_ap_id, type, created_at)
    VALUES (${newObjectId}, ${community.apId}, 'audience', ${now})
  `);
}
