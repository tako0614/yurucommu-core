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
import type { InstanceActorResult } from "../utils.ts";
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

export async function handleGroupFollow(
  c: ActivityContext,
  _activity: Activity,
  instanceActor: InstanceActorResult,
  actorApIdStr: string,
  baseUrl: string,
  activityId: string,
) {
  const db = c.get("db");
  const followerKey = {
    followerApId: actorApIdStr,
    followingApId: instanceActor.apId,
  };

  const existing = await db.query.follows.findFirst({
    where: and(
      eq(follows.followerApId, followerKey.followerApId),
      eq(follows.followingApId, followerKey.followingApId),
    ),
  });
  if (existing) return;

  const status =
    JOIN_POLICY_STATUS[instanceActor.joinPolicy ?? ""] ?? "accepted";

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
    actor: instanceActor.apId,
    object: activityId,
  };

  await db.insert(activities).values({
    apId: responseId,
    type: responseType,
    actorApId: instanceActor.apId,
    objectApId: activityId,
    rawJson: JSON.stringify(responseActivity),
    direction: "outbound",
  });

  // Outbound delivery must be async (no remote POST in request path).
  await enqueueDeliveryToActor(c.env, responseId, actorApIdStr);
}

export async function handleGroupUndo(
  c: ActivityContext,
  activity: Activity,
  instanceActor: InstanceActorResult,
) {
  const db = c.get("db");
  const objectId = getActivityObjectId(activity);
  if (!objectId) return;

  // Try exact match by activity AP ID first.
  const follow = await db.query.follows.findFirst({
    where: and(
      eq(follows.activityApId, objectId),
      eq(follows.followingApId, instanceActor.apId),
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
        eq(follows.followingApId, instanceActor.apId),
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

  await db.insert(objects).values({
    apId: newObjectId,
    type: "Note",
    attributedTo: actorApIdStr,
    content: object.content || "",
    summary: object.summary || null,
    attachmentsJson: attachments,
    visibility: "group",
    communityApId: community.apId,
    published: now,
    isLocal: 0,
  });

  // Using raw SQL with INSERT OR IGNORE since ObjectRecipient FK expects Actor, not Community
  await db.run(sql`
    INSERT OR IGNORE INTO object_recipients (object_ap_id, recipient_ap_id, type, created_at)
    VALUES (${newObjectId}, ${community.apId}, 'audience', ${now})
  `);
}
