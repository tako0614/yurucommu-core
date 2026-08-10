import type { Context, Hono } from "hono";
import { and, count, desc, eq, sql } from "drizzle-orm";
import {
  communities,
  communityJoinRequests,
  follows,
  runBatch,
  type D1Statement,
} from "../../../db/index.ts";
import type { Env, Variables } from "../../types.ts";
import { formatUsername, isLocal } from "../../federation-helpers.ts";
import {
  isActorBlockedStrict,
  operatorActorNotBlockedSql,
} from "../../lib/blocklist.ts";
import { prepareResponseIfRemote } from "../follow-helpers.ts";
import {
  batchLoadActorInfo,
  fetchCommunityId,
  prepareAddMemberStatements,
  prepareUnbanMemberStatement,
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
            operatorActorNotBlockedSql(sql`${communityJoinRequests.actorApId}`),
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
            operatorActorNotBlockedSql(sql`${follows.followerApId}`),
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
          username: formatUsername(apId, actorInfo?.preferredUsername),
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
      if (await isActorBlockedStrict(db, body.actor_ap_id)) {
        return c.json({ error: "Join request not found" }, 404);
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
        const statements: D1Statement[] = [
          ...prepareAddMemberStatements(
            db,
            community.apId,
            body.actor_ap_id,
            "member",
            now,
          ),
          // Accepting a join request is an explicit re-admission.
          prepareUnbanMemberStatement(db, community.apId, body.actor_ap_id),
        ];
        if (localRequest) {
          statements.push(
            db
              .update(communityJoinRequests)
              .set({ status: "accepted", processedAt: now })
              .where(
                and(
                  eq(communityJoinRequests.communityApId, community.apId),
                  eq(communityJoinRequests.actorApId, body.actor_ap_id),
                  eq(communityJoinRequests.status, "pending"),
                ),
              ) as D1Statement,
          );
        }
        await runBatch(db, statements as [D1Statement, ...D1Statement[]]);
      } else {
        // A REMOTE member's membership IS the pending follows edge to the Group
        // actor — NOT a communityMembers row (which would diverge from how the
        // rest of the system resolves remote membership). Flip that edge to
        // accepted and emit the community-signed Accept so the remote learns it
        // was approved and our handleGroupCreate (which requires status=accepted)
        // starts relaying its posts. The pending edge carries the original Follow
        // activity id the Accept must reference.
        const preparedResponse = pendingEdge?.activityApId
          ? await prepareResponseIfRemote(
              c.env,
              db,
              c.env.APP_URL,
              "Accept",
              community.apId,
              body.actor_ap_id,
              pendingEdge.activityApId,
            )
          : null;
        const statements: D1Statement[] = [
          db
            .update(follows)
            .set({ status: "accepted", acceptedAt: now })
            .where(
              and(
                eq(follows.followerApId, body.actor_ap_id),
                eq(follows.followingApId, community.apId),
                eq(follows.status, "pending"),
              ),
            ) as D1Statement,
        ];
        if (preparedResponse) statements.push(...preparedResponse.statements);
        statements.push(
          prepareUnbanMemberStatement(db, community.apId, body.actor_ap_id),
        );
        if (localRequest) {
          statements.push(
            db
              .update(communityJoinRequests)
              .set({ status: "accepted", processedAt: now })
              .where(
                and(
                  eq(communityJoinRequests.communityApId, community.apId),
                  eq(communityJoinRequests.actorApId, body.actor_ap_id),
                  eq(communityJoinRequests.status, "pending"),
                ),
              ) as D1Statement,
          );
        }
        await runBatch(db, statements as [D1Statement, ...D1Statement[]]);
        // The durable intent is committed above; Queue is only a best-effort
        // wakeup, so an outage cannot turn a committed approval into a 500.
        await preparedResponse?.publish();
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
      const statements: D1Statement[] = [];

      if (pendingEdge) {
        statements.push(
          db
            .delete(follows)
            .where(
              and(
                eq(follows.followerApId, body.actor_ap_id),
                eq(follows.followingApId, community.apId),
                eq(follows.status, "pending"),
              ),
            ) as D1Statement,
        );
      }

      // A remote approval request exists as a pending Follow edge. Reject it
      // with the Group actor and commit the edge removal, Activity, and durable
      // delivery intent together so the local and remote states cannot diverge.
      const preparedResponse = pendingEdge
        ? await prepareResponseIfRemote(
            c.env,
            db,
            c.env.APP_URL,
            "Reject",
            community.apId,
            body.actor_ap_id,
            pendingEdge.activityApId,
          )
        : null;
      if (preparedResponse) statements.push(...preparedResponse.statements);

      if (localRequest) {
        statements.push(
          db
            .update(communityJoinRequests)
            .set({ status: "rejected", processedAt: now })
            .where(
              and(
                eq(communityJoinRequests.communityApId, community.apId),
                eq(communityJoinRequests.actorApId, body.actor_ap_id),
                eq(communityJoinRequests.status, "pending"),
              ),
            ) as D1Statement,
        );
      }

      await runBatch(db, statements as [D1Statement, ...D1Statement[]]);
      // The durable intent is committed above; Queue is only a best-effort
      // wakeup, so an outage cannot turn a committed rejection into a 500.
      await preparedResponse?.publish();

      return c.json({ success: true });
    },
  );
}
