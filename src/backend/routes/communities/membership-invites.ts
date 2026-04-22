import type { Context, Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { communityInvites } from "../../../db/index.ts";
import type { Env, Variables } from "../../types.ts";
import { formatUsername, generateId } from "../../federation-helpers.ts";
import {
  batchLoadActorInfo,
  fetchCommunityId,
  requireManager,
} from "./membership-shared.ts";

export function registerMembershipInviteRoutes(
  communitiesRouter: Hono<{ Bindings: Env; Variables: Variables }>,
) {
  // GET /api/communities/:identifier/invites - List invites
  communitiesRouter.get(
    "/:identifier/invites",
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

      const invites = await db.select().from(communityInvites)
        .where(eq(communityInvites.communityApId, community.apId))
        .orderBy(desc(communityInvites.createdAt));

      const invitedByApIds = [
        ...new Set(invites.map((inv) => inv.invitedByApId)),
      ];
      const actorInfoMap = await batchLoadActorInfo(db, invitedByApIds, false);

      const result = invites.map((inv) => {
        const invitedByInfo = actorInfoMap.get(inv.invitedByApId);
        return {
          id: inv.id,
          invited_ap_id: inv.invitedApId,
          invited_by: {
            ap_id: inv.invitedByApId,
            username: formatUsername(inv.invitedByApId),
            preferred_username: invitedByInfo?.preferredUsername || null,
            name: invitedByInfo?.name || null,
          },
          created_at: inv.createdAt,
          expires_at: inv.expiresAt,
          used_at: inv.usedAt,
          used_by_ap_id: inv.usedByApId,
          is_valid: !inv.usedAt &&
            (!inv.expiresAt || new Date(inv.expiresAt) > new Date()),
        };
      });

      return c.json({ invites: result });
    },
  );

  // POST /api/communities/:identifier/invites - Create invite
  communitiesRouter.post(
    "/:identifier/invites",
    async (c: Context<{ Bindings: Env; Variables: Variables }>) => {
      const actor = c.get("actor");
      if (!actor) return c.json({ error: "Unauthorized" }, 401);

      const identifier = c.req.param("identifier")!;
      const db = c.get("db");
      let invitedApId: string | null = null;
      let expiresInHours: number | null = null;
      try {
        const body = await c.req.json<
          { invited_ap_id?: string; expires_in_hours?: number }
        >();
        invitedApId = body.invited_ap_id?.trim() || null;
        expiresInHours = body.expires_in_hours || null;
      } catch {
        invitedApId = null;
        expiresInHours = null;
      }

      const { community } = await fetchCommunityId(c, identifier);
      if (!community) {
        return c.json({ error: "Community not found" }, 404);
      }

      const manager = await requireManager(db, community.apId, actor.ap_id);
      if (!manager) {
        return c.json({ error: "Forbidden" }, 403);
      }

      const inviteId = generateId();
      const now = new Date();
      const expiresAt = expiresInHours
        ? new Date(now.getTime() + expiresInHours * 60 * 60 * 1000)
          .toISOString()
        : null;

      await db.insert(communityInvites).values({
        id: inviteId,
        communityApId: community.apId,
        invitedByApId: actor.ap_id,
        invitedApId,
        createdAt: now.toISOString(),
        expiresAt,
      });

      return c.json({ invite_id: inviteId, expires_at: expiresAt });
    },
  );

  // DELETE /api/communities/:identifier/invites/:inviteId - Revoke invite
  communitiesRouter.delete(
    "/:identifier/invites/:inviteId",
    async (c: Context<{ Bindings: Env; Variables: Variables }>) => {
      const actor = c.get("actor");
      if (!actor) return c.json({ error: "Unauthorized" }, 401);

      const identifier = c.req.param("identifier")!;
      const inviteId = c.req.param("inviteId")!;
      const db = c.get("db");

      const { community } = await fetchCommunityId(c, identifier);
      if (!community) {
        return c.json({ error: "Community not found" }, 404);
      }

      const manager = await requireManager(db, community.apId, actor.ap_id);
      if (!manager) {
        return c.json({ error: "Forbidden" }, 403);
      }

      const invite = await db.select().from(communityInvites)
        .where(and(
          eq(communityInvites.id, inviteId),
          eq(communityInvites.communityApId, community.apId),
        ))
        .get();
      if (!invite) {
        return c.json({ error: "Invite not found" }, 404);
      }

      await db.delete(communityInvites)
        .where(eq(communityInvites.id, inviteId));

      return c.json({ success: true });
    },
  );
}
