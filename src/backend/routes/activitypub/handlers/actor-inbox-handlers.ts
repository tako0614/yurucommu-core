import { and, eq, isNull, or, sql } from "drizzle-orm";
import {
  activities,
  communities,
  communityMembers,
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
import {
  boundAttachmentsJson,
  boundInboundContent,
  boundInboundSummary,
} from "../../posts/transformers.ts";
import { normalizeInboundTimestamp } from "./inbound-timestamp.ts";
import type { InstanceActorResult } from "../query-helpers.ts";
import {
  type Activity,
  type ActivityContext,
  getActivityObject,
  getActivityObjectId,
  typeIncludes,
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

  const status = existing
    ? existing.status
    : (JOIN_POLICY_STATUS[group.joinPolicy ?? ""] ?? "accepted");

  if (!existing) {
    const now = new Date().toISOString();
    await db.insert(follows).values({
      ...followerKey,
      status,
      activityApId: activityId,
      acceptedAt: status === "accepted" ? now : null,
    });
  }

  if (isLocal(actorApIdStr, baseUrl)) return;
  if (status === "pending") return;

  const responseType = status === "accepted" ? "Accept" : "Reject";

  // Idempotent (re-)emit of the Accept/Reject. We do NOT early-return on an
  // existing follow: if the follow row was recorded on a prior attempt but the
  // response was LOST (a transient failure between the follow insert and the
  // enqueue left the activity uncommitted, so the remote retried), the old
  // `if (existing) return` suppressed the Accept forever — leaving the remote
  // stuck pending while we record them as accepted. Instead, if a response for
  // THIS Follow already exists just re-enqueue its (dedup'd, durable) delivery;
  // otherwise create + enqueue it.
  const existingResponse = await db.query.activities.findFirst({
    where: and(
      eq(activities.type, responseType),
      eq(activities.actorApId, group.apId),
      eq(activities.objectApId, activityId),
    ),
  });
  if (existingResponse) {
    await enqueueDeliveryToActor(c.env, existingResponse.apId, actorApIdStr);
    return;
  }

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
  actorApIdStr: string,
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
    // Bind to the VERIFIED signer: only the follow's own follower may undo it.
    // The activity id is public (it appears in the follower's outbox), so
    // without this check a remote attacker who signs an Undo as any actor on
    // their own domain could resolve a VICTIM's follow by that id and sever the
    // victim's follow/membership edge — the same cross-actor forgery already
    // guarded in the user-inbox undoFollow handler.
    if (follow.followerApId !== actorApIdStr) return;
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

  // Fallback: if the undone object is a Follow, delete by actor pair — keyed on
  // the verified signer, so it can only remove the signer's OWN follow.
  if (getActivityObject(activity)?.type !== "Follow") return;

  await db
    .delete(follows)
    .where(
      and(
        eq(follows.followerApId, actorApIdStr),
        eq(follows.followingApId, group.apId),
      ),
    );
}

export async function handleGroupCreate(
  c: ActivityContext,
  activity: Activity,
  _instanceActor: InstanceActorResult,
  actorApIdStr: string,
  baseUrl: string,
) {
  const db = c.get("db");
  const object = getActivityObject(activity);
  if (!object || !typeIncludes(object.type, "Note")) return;

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

  // Resolve the TARGET community (filtered to a live, non-deleted row) and
  // authorize the post against THAT community — not the instance actor. The old
  // gate checked postPolicy + a follow of the single instance Group actor, which
  // every open-policy instance-follower satisfied for EVERY community, letting a
  // non-member inject chat messages into ANY community — including private and
  // soft-deleted ones — that then surfaced to that community's members. Mirror
  // checkCommunityPostPermission's semantics, but with the FEDERATION membership
  // model: a remote member is an accepted Follow of the community Group actor
  // (handleGroupFollow records follows.followingApId = community.apId); a local
  // member additionally has a communityMembers row carrying a role.
  const community = await db
    .select({
      apId: communities.apId,
      postPolicy: communities.postPolicy,
      visibility: communities.visibility,
    })
    .from(communities)
    .where(
      and(
        or(
          eq(communities.preferredUsername, roomId),
          eq(communities.apId, roomId),
        ),
        isNull(communities.deletedAt),
      ),
    )
    .get();
  if (!community) return;

  const memberFollow = await db.query.follows.findFirst({
    where: and(
      eq(follows.followerApId, actorApIdStr),
      eq(follows.followingApId, community.apId),
      eq(follows.status, "accepted"),
    ),
  });
  const memberRow = await db.query.communityMembers.findFirst({
    where: and(
      eq(communityMembers.communityApId, community.apId),
      eq(communityMembers.actorApId, actorApIdStr),
    ),
    columns: { role: true },
  });
  const isMember = Boolean(memberFollow) || Boolean(memberRow);
  const role = memberRow?.role;
  const isManager = role === "owner" || role === "moderator";
  const policy = community.postPolicy || "members";

  // A non-public community requires membership to post regardless of policy.
  if ((community.visibility ?? "public") !== "public" && !isMember) return;
  if (policy !== "anyone" && !isMember) return;
  if (policy === "mods" && !isManager) return;
  if (policy === "owners" && role !== "owner") return;

  const newObjectId = object.id || objectApId(baseUrl, generateId());
  const existingObj = await db.query.objects.findFirst({
    where: eq(objects.apId, newObjectId),
  });
  if (existingObj) return;

  const attachments = object.attachment
    ? JSON.stringify(object.attachment)
    : "[]";
  // Clamp + normalize the remote-controlled `published` exactly like the other
  // inbound Note paths (handleCreate / insertDirectNote / handleCreateStory). The
  // community chat reader sorts + keyset-paginates on `desc(objects.published)`
  // and the unread count compares against `object_recipients.created_at`, so a
  // verbatim far-future / malformed value would pin the message atop the chat
  // forever and corrupt unread baselines.
  const now = normalizeInboundTimestamp(
    object.published,
    new Date().toISOString(),
  );

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
    content: boundInboundContent(object.content),
    summary: boundInboundSummary(object.summary),
    attachmentsJson: boundAttachmentsJson(attachments),
    visibility: "group",
    // Record the community in audienceJson too (not just the object_recipients
    // row): the canonical single-object read-gate (canViewerReadObject) keys on
    // audienceJson/communityApId and does NOT consult object_recipients, so
    // without this a federated chat message in a PRIVATE community was served to
    // ANY (even anonymous) caller via GET /api/posts/:id. The local chat POST sets
    // this for the same reason. Safe for the chat reader (joins on
    // object_recipients + communityApId IS NULL, not audienceJson) and the feed
    // (audienceJson != "[]" already excludes it).
    audienceJson: JSON.stringify([community.apId]),
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
