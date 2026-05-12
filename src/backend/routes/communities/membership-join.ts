import type { Context, Hono } from "hono";
import { and, count, eq, gt, isNull, or, sql } from "drizzle-orm";
import {
  affectedRowCount,
  communities,
  communityInvites,
  communityJoinRequests,
  communityMembers,
} from "../../../db/index.ts";
import type { Env, Variables } from "../../types.ts";
import { fetchCommunityDetails, memberWhere } from "./membership-shared.ts";
import { isUniqueConstraintError } from "../../lib/parse-helpers.ts";

export function registerMembershipJoinRoutes(
  communitiesRouter: Hono<{ Bindings: Env; Variables: Variables }>,
) {
  // POST /api/communities/:identifier/join - Join a community
  communitiesRouter.post(
    "/:identifier/join",
    async (c: Context<{ Bindings: Env; Variables: Variables }>) => {
      const actor = c.get("actor");
      if (!actor) return c.json({ error: "Unauthorized" }, 401);

      const identifier = c.req.param("identifier")!;
      const db = c.get("db");

      let inviteId: string | undefined;
      try {
        const body = await c.req.json<{ invite_id?: string }>();
        inviteId = body.invite_id?.trim() || undefined;
      } catch {
        inviteId = undefined;
      }

      const { community } = await fetchCommunityDetails(c, identifier);
      if (!community) {
        return c.json({ error: "Community not found" }, 404);
      }

      // Check if already member
      const existing = await db.select().from(communityMembers)
        .where(memberWhere(community.apId, actor.ap_id))
        .get();
      if (existing) {
        return c.json({ error: "Already a member" }, 409);
      }

      const now = new Date().toISOString();

      if (community.joinPolicy === "approval") {
        // Upsert: check if exists, then insert or update
        const existingRequest = await db.select().from(communityJoinRequests)
          .where(and(
            eq(communityJoinRequests.communityApId, community.apId),
            eq(communityJoinRequests.actorApId, actor.ap_id),
          ))
          .get();

        if (existingRequest) {
          await db.update(communityJoinRequests)
            .set({ status: "pending", createdAt: now, processedAt: null })
            .where(and(
              eq(communityJoinRequests.communityApId, community.apId),
              eq(communityJoinRequests.actorApId, actor.ap_id),
            ));
        } else {
          await db.insert(communityJoinRequests).values({
            communityApId: community.apId,
            actorApId: actor.ap_id,
            status: "pending",
            createdAt: now,
          });
        }

        return c.json({ success: true, status: "pending" });
      }

      if (community.joinPolicy === "invite") {
        if (!inviteId) {
          return c.json(
            { error: "Invite required", status: "invite_required" },
            403,
          );
        }

        try {
          // Find the invite
          const invite = await db.select().from(communityInvites)
            .where(and(
              eq(communityInvites.id, inviteId),
              eq(communityInvites.communityApId, community.apId),
              isNull(communityInvites.usedAt),
              or(
                isNull(communityInvites.expiresAt),
                gt(communityInvites.expiresAt, now),
              ),
            ))
            .get();

          if (!invite) {
            return c.json({
              error: "Invalid or expired invite",
              status: "invite_required",
            }, 403);
          }
          if (invite.invitedApId && invite.invitedApId !== actor.ap_id) {
            return c.json({
              error: "Invite not for this account",
              status: "invite_required",
            }, 403);
          }

          // Create member
          await db.insert(communityMembers).values({
            communityApId: community.apId,
            actorApId: actor.ap_id,
            role: "member",
            joinedAt: now,
          });

          // Increment member count
          await db.update(communities)
            .set({ memberCount: sql`${communities.memberCount} + 1` })
            .where(eq(communities.apId, community.apId));

          // Claim the invite - update only if conditions still match
          const claimResult = await db.update(communityInvites)
            .set({ usedByApId: actor.ap_id, usedAt: now })
            .where(and(
              eq(communityInvites.id, inviteId),
              eq(communityInvites.communityApId, community.apId),
              isNull(communityInvites.usedAt),
              or(
                isNull(communityInvites.expiresAt),
                gt(communityInvites.expiresAt, now),
              ),
              or(
                isNull(communityInvites.invitedApId),
                eq(communityInvites.invitedApId, actor.ap_id),
              ),
            ));
          if (affectedRowCount(claimResult) !== 1) {
            throw new Error("INVITE_CLAIM_FAILED");
          }

          return c.json({ success: true, status: "joined" });
        } catch (error) {
          if (isUniqueConstraintError(error)) {
            return c.json({ error: "Already a member" }, 409);
          }
          console.error("[Communities] Failed to join with invite:", error);
          return c.json({ error: "Failed to join community" }, 500);
        }
      }

      // Open join
      try {
        await db.insert(communityMembers).values({
          communityApId: community.apId,
          actorApId: actor.ap_id,
          role: "member",
          joinedAt: now,
        });

        await db.update(communities)
          .set({ memberCount: sql`${communities.memberCount} + 1` })
          .where(eq(communities.apId, community.apId));

        return c.json({ success: true, status: "joined" });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          return c.json({ error: "Already a member" }, 409);
        }
        console.error("[Communities] Failed to join community:", error);
        return c.json({ error: "Failed to join community" }, 500);
      }
    },
  );

  // POST /api/communities/:identifier/leave - Leave a community
  communitiesRouter.post(
    "/:identifier/leave",
    async (c: Context<{ Bindings: Env; Variables: Variables }>) => {
      const actor = c.get("actor");
      if (!actor) return c.json({ error: "Unauthorized" }, 401);

      const identifier = c.req.param("identifier")!;
      const db = c.get("db");

      const { community } = await fetchCommunityDetails(c, identifier);
      if (!community) {
        return c.json({ error: "Community not found" }, 404);
      }

      const membership = await db.select().from(communityMembers)
        .where(memberWhere(community.apId, actor.ap_id))
        .get();
      if (!membership) {
        return c.json({ error: "Not a member" }, 400);
      }

      // Don't allow the last owner to leave
      if (membership.role === "owner") {
        const ownerCountResult = await db.select({ count: count() }).from(
          communityMembers,
        )
          .where(and(
            eq(communityMembers.communityApId, community.apId),
            eq(communityMembers.role, "owner"),
          ))
          .get();
        if ((ownerCountResult?.count ?? 0) <= 1) {
          return c.json({ error: "Cannot leave: you are the only owner" }, 400);
        }
      }

      await db.delete(communityMembers)
        .where(memberWhere(community.apId, actor.ap_id));

      await db.update(communities)
        .set({ memberCount: sql`${communities.memberCount} - 1` })
        .where(eq(communities.apId, community.apId));

      return c.json({ success: true });
    },
  );
}
