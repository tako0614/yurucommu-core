import type { Context, Hono } from "hono";
import { and, count, desc, eq, sql } from "drizzle-orm";
import {
  activities,
  communities,
  communityJoinRequests,
  communityMembers,
  follows,
} from "../../../db/index.ts";
import type { Env, Variables } from "../../types.ts";
import {
  activityApId,
  formatUsername,
  generateId,
  isLocal,
} from "../../federation-helpers.ts";
import { enqueueDeliveryToActor } from "../../lib/delivery/queue.ts";
import {
  addMemberAtomic,
  batchLoadActorInfo,
  fetchCommunityId,
  memberWhere,
  requireManager,
} from "./membership-shared.ts";

const AS_CONTEXT = "https://www.w3.org/ns/activitystreams";

export function registerMembershipRequestRoutes(
  communitiesRouter: Hono<{ Bindings: Env; Variables: Variables }>,
) {
  // GET /api/communities/:identifier/requests - List pending join requests
  communitiesRouter.get(
    "/:identifier/requests",
    async (c: Context<{ Bindings: Env; Variables: Variables }>) => {
      const actor = c.get("actor");
      if (!actor) return c.json({ error: "Unauthorized" }, 401);

      const identifier = c.req.param("identifier")!;
      const db = c.get("db");

      const { community } = await fetchCommunityId(c, identifier);
      if (!community) {
        return c.json({ error: "Community not found" }, 404);
      }

      const manager = await requireManager(db, community.apId, actor.ap_id);
      if (!manager) {
        return c.json({ error: "Forbidden" }, 403);
      }

      // Pending join requests come from TWO sources, merged (newest-first, capped
      // so the response can't grow unbounded): local approval-joins recorded in
      // community_join_requests, AND remote approval-joins which exist ONLY as a
      // PENDING follows edge to the Group actor (a remote follower has no `actors`
      // row, so it can't be mirrored into community_join_requests).
      const localRequests = await db
        .select()
        .from(communityJoinRequests)
        .where(
          and(
            eq(communityJoinRequests.communityApId, community.apId),
            eq(communityJoinRequests.status, "pending"),
          ),
        )
        .orderBy(desc(communityJoinRequests.createdAt))
        .limit(200);
      const pendingEdges = await db
        .select({
          actorApId: follows.followerApId,
          createdAt: follows.createdAt,
        })
        .from(follows)
        .where(
          and(
            eq(follows.followingApId, community.apId),
            eq(follows.status, "pending"),
          ),
        )
        .orderBy(desc(follows.createdAt))
        .limit(200);

      const byActor = new Map<string, string>(); // actorApId -> createdAt
      for (const e of pendingEdges) byActor.set(e.actorApId, e.createdAt);
      for (const r of localRequests) byActor.set(r.actorApId, r.createdAt);
      const merged = [...byActor.entries()]
        .sort((a, b) => (a[1] < b[1] ? 1 : -1))
        .slice(0, 200);

      const actorInfoMap = await batchLoadActorInfo(
        db,
        merged.map(([apId]) => apId),
      );

      const result = merged.map(([apId, createdAt]) => {
        const actorInfo = actorInfoMap.get(apId);
        return {
          ap_id: apId,
          username: formatUsername(apId),
          preferred_username: actorInfo?.preferredUsername || null,
          name: actorInfo?.name || null,
          icon_url: actorInfo?.iconUrl || null,
          created_at: createdAt,
        };
      });

      return c.json({ requests: result });
    },
  );

  // POST /api/communities/:identifier/requests/accept - Accept join request
  communitiesRouter.post(
    "/:identifier/requests/accept",
    async (c: Context<{ Bindings: Env; Variables: Variables }>) => {
      const actor = c.get("actor");
      if (!actor) return c.json({ error: "Unauthorized" }, 401);

      const identifier = c.req.param("identifier")!;
      const db = c.get("db");
      const body = await c.req.json<{ actor_ap_id: string }>();

      if (!body.actor_ap_id) {
        return c.json({ error: "actor_ap_id required" }, 400);
      }

      const { community } = await fetchCommunityId(c, identifier);
      if (!community) {
        return c.json({ error: "Community not found" }, 404);
      }

      const manager = await requireManager(db, community.apId, actor.ap_id);
      if (!manager) {
        return c.json({ error: "Forbidden" }, 403);
      }

      // A pending request is EITHER a community_join_requests row (local
      // approval-join) OR a pending follows edge to the Group (remote
      // approval-join — no join-request row, since a remote has no `actors` row).
      const localRequest = await db
        .select()
        .from(communityJoinRequests)
        .where(
          and(
            eq(communityJoinRequests.communityApId, community.apId),
            eq(communityJoinRequests.actorApId, body.actor_ap_id),
            eq(communityJoinRequests.status, "pending"),
          ),
        )
        .get();
      const pendingEdge = await db
        .select({ activityApId: follows.activityApId })
        .from(follows)
        .where(
          and(
            eq(follows.followerApId, body.actor_ap_id),
            eq(follows.followingApId, community.apId),
            eq(follows.status, "pending"),
          ),
        )
        .get();
      if (!localRequest && !pendingEdge) {
        return c.json({ error: "Join request not found" }, 404);
      }

      const now = new Date().toISOString();

      if (isLocal(body.actor_ap_id, c.env.APP_URL)) {
        const existingMember = await db
          .select()
          .from(communityMembers)
          .where(memberWhere(community.apId, body.actor_ap_id))
          .get();
        if (!existingMember) {
          // Atomic insert + guarded increment so a crash between them, or a
          // concurrent double-accept, can't leave the count under/over the truth.
          await addMemberAtomic(
            db,
            community.apId,
            body.actor_ap_id,
            "member",
            now,
          );
        }
      } else {
        // A REMOTE member's membership IS the pending follows edge to the Group
        // actor — NOT a communityMembers row (which would diverge from how the
        // rest of the system resolves remote membership). Flip that edge to
        // accepted and emit the community-signed Accept so the remote learns it
        // was approved and our handleGroupCreate (which requires status=accepted)
        // starts relaying its posts. The pending edge carries the original Follow
        // activity id the Accept must reference.
        await db
          .update(follows)
          .set({ status: "accepted", acceptedAt: now })
          .where(
            and(
              eq(follows.followerApId, body.actor_ap_id),
              eq(follows.followingApId, community.apId),
            ),
          );
        if (pendingEdge?.activityApId) {
          const acceptId = activityApId(c.env.APP_URL, generateId());
          const acceptActivity = {
            "@context": AS_CONTEXT,
            id: acceptId,
            type: "Accept",
            actor: community.apId,
            object: pendingEdge.activityApId,
          };
          await db.insert(activities).values({
            apId: acceptId,
            type: "Accept",
            actorApId: community.apId,
            objectApId: pendingEdge.activityApId,
            rawJson: JSON.stringify(acceptActivity),
            direction: "outbound",
          });
          // Delivery resolves the community's signing key from actor=community.apId.
          await enqueueDeliveryToActor(c.env, acceptId, body.actor_ap_id);
        }
      }

      // Mark the local join-request row processed (a remote accept has none).
      if (localRequest) {
        await db
          .update(communityJoinRequests)
          .set({ status: "accepted", processedAt: now })
          .where(
            and(
              eq(communityJoinRequests.communityApId, community.apId),
              eq(communityJoinRequests.actorApId, body.actor_ap_id),
            ),
          );
      }

      return c.json({ success: true });
    },
  );

  // POST /api/communities/:identifier/requests/reject - Reject join request
  communitiesRouter.post(
    "/:identifier/requests/reject",
    async (c: Context<{ Bindings: Env; Variables: Variables }>) => {
      const actor = c.get("actor");
      if (!actor) return c.json({ error: "Unauthorized" }, 401);

      const identifier = c.req.param("identifier")!;
      const db = c.get("db");
      const body = await c.req.json<{ actor_ap_id: string }>();

      if (!body.actor_ap_id) {
        return c.json({ error: "actor_ap_id required" }, 400);
      }

      const { community } = await fetchCommunityId(c, identifier);
      if (!community) {
        return c.json({ error: "Community not found" }, 404);
      }

      const manager = await requireManager(db, community.apId, actor.ap_id);
      if (!manager) {
        return c.json({ error: "Forbidden" }, 403);
      }

      const request = await db
        .select()
        .from(communityJoinRequests)
        .where(
          and(
            eq(communityJoinRequests.communityApId, community.apId),
            eq(communityJoinRequests.actorApId, body.actor_ap_id),
            eq(communityJoinRequests.status, "pending"),
          ),
        )
        .get();
      if (!request) {
        return c.json({ error: "Join request not found" }, 404);
      }

      await db
        .update(communityJoinRequests)
        .set({ status: "rejected", processedAt: new Date().toISOString() })
        .where(
          and(
            eq(communityJoinRequests.communityApId, community.apId),
            eq(communityJoinRequests.actorApId, body.actor_ap_id),
          ),
        );

      return c.json({ success: true });
    },
  );
}
