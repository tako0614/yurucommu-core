import { Hono } from "hono";
import { and, eq, isNotNull, isNull, ne, not, sql } from "drizzle-orm";
import {
  activities,
  communities,
  communityMembers,
  objectRecipients,
  objects,
} from "../../../db/index.ts";
import { excludeModeratedActors } from "../../lib/feed-exclude.ts";
import { peerArchivedSql } from "../../lib/talk-peer-archives.ts";
import type { HonoEnv } from "./conversations-helpers.ts";

const targets = new Hono<HonoEnv>();

function validId(value: string | undefined): value is string {
  return (
    value !== undefined &&
    value.length > 0 &&
    value.length <= 2048 &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

// Push event_id is an activity AP ID; room_id is only an optional object
// cross-check. Neither is a peer, a Group, or authorization to read a chat.
targets.get("/notification-target", async (c) => {
  c.header("cache-control", "no-store");
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  const eventIds = c.req.queries("event_id");
  const objectIds = c.req.queries("object_id");
  const eventId = eventIds?.[0];
  const objectId = objectIds?.[0];
  if (
    eventIds?.length !== 1 ||
    !validId(eventId) ||
    (objectIds !== undefined && (objectIds.length !== 1 || !validId(objectId)))
  ) {
    return c.json({ error: "Invalid notification target request" }, 400);
  }

  const db = c.get("db");
  const common = [
    eq(activities.apId, eventId),
    eq(activities.type, "Create"),
    eq(activities.actorApId, objects.attributedTo),
    ne(objects.attributedTo, actor.ap_id),
    eq(objects.type, "Note"),
    isNull(objects.communityApId),
    excludeModeratedActors(actor.ap_id, objects.attributedTo),
    ...(objectId !== undefined ? [eq(objects.apId, objectId)] : []),
  ];

  const direct = db
    .select({
      type: sql<"user" | "community">`'user'`.as("target_type"),
      ap_id: objects.attributedTo,
    })
    .from(activities)
    .innerJoin(objects, eq(objects.apId, activities.objectApId))
    .innerJoin(
      objectRecipients,
      and(
        eq(objectRecipients.objectApId, objects.apId),
        eq(objectRecipients.type, "to"),
        eq(objectRecipients.recipientApId, actor.ap_id),
      ),
    )
    .where(
      and(
        ...common,
        eq(objects.visibility, "direct"),
        isNotNull(objects.conversation),
        not(
          peerArchivedSql(
            sql`${actor.ap_id}`,
            sql`${objects.attributedTo}`,
            sql`${objects.conversation}`,
          ),
        ),
      ),
    );

  const group = db
    .select({
      type: sql<"user" | "community">`'community'`.as("target_type"),
      ap_id: communities.apId,
    })
    .from(activities)
    .innerJoin(objects, eq(objects.apId, activities.objectApId))
    .innerJoin(
      objectRecipients,
      and(
        eq(objectRecipients.objectApId, objects.apId),
        eq(objectRecipients.type, "audience"),
      ),
    )
    .innerJoin(
      communities,
      and(
        eq(communities.apId, objectRecipients.recipientApId),
        isNull(communities.deletedAt),
      ),
    )
    .innerJoin(
      communityMembers,
      and(
        eq(communityMembers.communityApId, communities.apId),
        eq(communityMembers.actorApId, actor.ap_id),
      ),
    )
    .where(and(...common));

  // One read snapshot, at most two rows. Never guess if malformed data names
  // multiple readable targets. No profile/network await after this authority
  // check, and no inbox/read-receipt/archive mutation on this GET.
  const candidates = await direct.unionAll(group).limit(2);
  if (candidates.length !== 1)
    return c.json({ error: "Notification target unavailable" }, 404);
  return c.json({
    event_id: eventId,
    recipient_ap_id: actor.ap_id,
    target: candidates[0],
  });
});

export default targets;
