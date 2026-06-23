import type { Context, Hono } from "hono";
import { and, count, desc, eq, sql } from "drizzle-orm";
import {
  communities,
  communityJoinRequests,
  communityMembers,
} from "../../../db/index.ts";
import type { Env, Variables } from "../../types.ts";
import { formatUsername } from "../../federation-helpers.ts";
import {
  addMemberAtomic,
  batchLoadActorInfo,
  fetchCommunityId,
  memberWhere,
  requireManager,
} from "./membership-shared.ts";

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

      // Cap the pending-requests list (newest-first) so the response can't grow
      // unbounded with a flood of join requests.
      const requests = await db
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

      const requestActorApIds = requests.map((r) => r.actorApId);
      const actorInfoMap = await batchLoadActorInfo(db, requestActorApIds);

      const result = requests.map((r) => {
        const actorInfo = actorInfoMap.get(r.actorApId);
        return {
          ap_id: r.actorApId,
          username: formatUsername(r.actorApId),
          preferred_username: actorInfo?.preferredUsername || null,
          name: actorInfo?.name || null,
          icon_url: actorInfo?.iconUrl || null,
          created_at: r.createdAt,
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
          new Date().toISOString(),
        );
      }

      await db
        .update(communityJoinRequests)
        .set({ status: "accepted", processedAt: new Date().toISOString() })
        .where(
          and(
            eq(communityJoinRequests.communityApId, community.apId),
            eq(communityJoinRequests.actorApId, body.actor_ap_id),
          ),
        );

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
