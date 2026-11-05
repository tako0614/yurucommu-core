import { and, eq, isNull, or, sql } from "drizzle-orm";
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
  isLocal,
} from "../../../federation-helpers.ts";
import { enqueueDeliveryToActor } from "../../../lib/delivery/queue.ts";
import { isSameActivityPubActor } from "../../../lib/activitypub-actor-identity.ts";
import {
  hasTerminalNoteDeletion,
  InboundNoteUpdateConflict,
  loadInboundNoteUpdateWindow,
} from "../../../lib/inbound-note-update-order.ts";
import {
  commitNoteProjection,
  foldAdmittedNoteUpdates,
  readNoteProjection,
  type NoteProjection,
} from "./inbound-note-update-projection.ts";

import { InboundObjectDeletionConflict } from "../../../lib/inbound-object-deletion.ts";
import { severFollowDirection } from "../../../lib/follow-edge-mutations.ts";
import { isMemberBanned } from "../../communities/membership-shared.ts";
import {
  boundInboundContent,
  boundInboundNoteAttachmentsJson,
  boundInboundSummary,
  boundInboundTagsJson,
} from "../../posts/transformers.ts";
import { normalizeInboundTimestamp } from "./inbound-timestamp.ts";
import {
  canActorPostToInboundCommunity,
  type InboundCommunityAdmission,
} from "./inbound-community-scope.ts";
import { validateInboundObjectIdentity } from "./inbound-object-identity.ts";
import {
  findFollowByActivityId,
  findFollowByFollowerIdentity,
  runBatch,
} from "./inbox-shared-helpers.ts";
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
  sourceActivityId: string = activityId,
) {
  const db = c.get("db");
  const followerKey = {
    followerApId: actorApIdStr,
    followingApId: group.apId,
  };

  const existing = await findFollowByFollowerIdentity(
    db,
    followerKey.followerApId,
    followerKey.followingApId,
  );

  // A banned actor re-Following an OPEN community must NOT auto-rejoin: force a
  // Reject and record no edge (durable kick — mirrors the local open-join ban
  // gate). Only the AUTO-ACCEPT path is blocked; an approval community still
  // lets the Follow go pending so a moderator can re-admit (which lifts the ban).
  const policyStatus = JOIN_POLICY_STATUS[group.joinPolicy ?? ""] ?? "accepted";
  const banned =
    !existing &&
    policyStatus === "accepted" &&
    (await isMemberBanned(db, group.apId, actorApIdStr));

  const status = existing
    ? existing.status
    : banned
      ? "rejected"
      : policyStatus;

  if (!existing && !banned) {
    const now = new Date().toISOString();
    // onConflictDoNothing: the same Follow delivered concurrently to two inbox
    // endpoints (shared + per-actor) can re-claim an in-flight dispatch and run
    // this insert twice; without it the concurrent loser throws a PK violation on
    // (follower_ap_id, following_ap_id) that is caught + logged as noise (#8). The
    // follows edge is idempotent, so silently skipping the duplicate is correct.
    await db
      .insert(follows)
      .values({
        ...followerKey,
        status,
        activityApId: activityId,
        acceptedAt: status === "accepted" ? now : null,
      })
      .onConflictDoNothing();
    // An approval-policy community holds the follow PENDING. The pending follows
    // edge IS the remote join request (it cannot be mirrored into
    // community_join_requests, whose actor_ap_id FKs to the local `actors` table a
    // remote follower has no row in). The manager approval surface
    // (GET /requests + POST /requests/accept) therefore also reads pending
    // follows edges to the community.
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
      eq(activities.objectApId, sourceActivityId),
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
    object: sourceActivityId,
  };

  await db.insert(activities).values({
    apId: responseId,
    type: responseType,
    actorApId: group.apId,
    objectApId: sourceActivityId,
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

  // Resolve either the retained local ledger IRI or the peer's wire id within
  // the verified signer. This also makes a bare-string Undo(Follow) work for a
  // Group instead of requiring an embedded typed Follow object.
  const follow = await findFollowByActivityId(db, objectId, {
    actorApId: actorApIdStr,
    localBaseUrl: c.env.APP_URL,
  });

  if (follow) {
    if (follow.followingApId !== group.apId) return;
    // Bind to the VERIFIED signer: only the follow's own follower may undo it.
    // The activity id is public (it appears in the follower's outbox), so
    // without this check a remote attacker who signs an Undo as any actor on
    // their own domain could resolve a VICTIM's follow by that id and sever the
    // victim's follow/membership edge — the same cross-actor forgery already
    // guarded in the user-inbox undoFollow handler.
    if (!isSameActivityPubActor(follow.followerApId, actorApIdStr)) return;
    await severFollowDirection(db, follow.followerApId, follow.followingApId);
    return;
  }

  // Fallback: if the undone object is a Follow, delete by actor pair — keyed on
  // the verified signer, so it can only remove the signer's OWN follow.
  if (getActivityObject(activity)?.type !== "Follow") return;

  const retainedFollow = await findFollowByFollowerIdentity(
    db,
    actorApIdStr,
    group.apId,
  );
  if (!retainedFollow) return;
  await severFollowDirection(
    db,
    retainedFollow.followerApId,
    retainedFollow.followingApId,
  );
}

export async function handleGroupCreate(
  c: ActivityContext,
  activity: Activity,
  _instanceActor: InstanceActorResult,
  actorApIdStr: string,
  baseUrl: string,
) {
  let db = c.get("db");
  const object = getActivityObject(activity);
  if (!object || !typeIncludes(object.type, "Note")) return;

  const identity = validateInboundObjectIdentity(
    object.id,
    actorApIdStr,
    baseUrl,
  );
  if (!identity.ok) return;

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

  const communityAdmissions: InboundCommunityAdmission[] = [];
  if (
    !(await canActorPostToInboundCommunity(
      db,
      actorApIdStr,
      community,
      (admission) => communityAdmissions.push(admission),
    ))
  ) {
    return;
  }

  const objectId = identity.objectId;
  const window = await loadInboundNoteUpdateWindow(db, actorApIdStr, objectId);
  const before = await readNoteProjection(db, objectId);
  if (!before && activity.id && window.creationActivityId === activity.id)
    return;
  const audienceJson = JSON.stringify([community.apId]);
  if (
    before &&
    (before.type !== "Note" ||
      before.visibility !== "group" ||
      before.isLocal !== 0 ||
      before.deletedAt !== null ||
      !isSameActivityPubActor(before.attributedTo, actorApIdStr) ||
      before.audienceJson !== audienceJson ||
      before.communityApId !== null)
  )
    return;
  const base: NoteProjection = before
    ? {
        ...before,
        recipients: [{ recipientApId: community.apId, type: "audience" }],
      }
    : {
        apId: objectId,
        type: "Note",
        attributedTo: actorApIdStr,
        isLocal: 0,
        deletedAt: null,
        content: boundInboundContent(object.content),
        summary: boundInboundSummary(object.summary),
        attachmentsJson: boundInboundNoteAttachmentsJson(object.attachment),
        tagsJson: boundInboundTagsJson(object.tag),
        visibility: "group",
        audienceJson,
        communityApId: null,
        toJson: "[]",
        ccJson: "[]",
        conversation: null,
        inReplyTo: null,
        endTime: null,
        updated: null,
        published: normalizeInboundTimestamp(
          object.published,
          new Date().toISOString(),
        ),
        recipients: [{ recipientApId: community.apId, type: "audience" }],
      };
  base.communityAdmissions = communityAdmissions;
  const projected = await foldAdmittedNoteUpdates(
    db,
    base,
    window,
    actorApIdStr,
    baseUrl,
  );
  try {
    await commitNoteProjection(db, before, projected, window, {
      activityId: activity.id,
      countPost: false,
    });
  } catch (error) {
    if (
      (error instanceof InboundNoteUpdateConflict &&
        (await hasTerminalNoteDeletion(db, actorApIdStr, objectId))) ||
      error instanceof InboundObjectDeletionConflict
    )
      return;
    throw error;
  }
}
