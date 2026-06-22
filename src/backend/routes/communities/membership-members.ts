import type { Context, Hono } from "hono";
import { and, asc, count, desc, eq, inArray, or, sql } from "drizzle-orm";
import { communities, communityMembers } from "../../../db/index.ts";
import { chunkForInClause } from "../../lib/chunk.ts";
import type { Env, Variables } from "../../types.ts";
import {
  formatUsername,
  parseLimit,
  parseOffset,
} from "../../federation-helpers.ts";
import {
  batchLoadActorInfo,
  fetchCommunityId,
  memberWhere,
  removeMemberAtomic,
  requireManager,
  resolveCommunityApId,
} from "./membership-shared.ts";

const MAX_MEMBER_BATCH_SIZE = 100;

function validateBatchApIds(ids: unknown): string | null {
  if (!Array.isArray(ids) || ids.length === 0) {
    return "actor_ap_ids array is required";
  }
  if (ids.some((id) => typeof id !== "string" || id.trim().length === 0)) {
    return "actor_ap_ids array is required";
  }
  if (ids.length > MAX_MEMBER_BATCH_SIZE) {
    return `Batch size exceeds maximum of ${MAX_MEMBER_BATCH_SIZE}`;
  }
  return null;
}

export function registerMembershipMemberRoutes(
  communitiesRouter: Hono<{ Bindings: Env; Variables: Variables }>,
) {
  // DELETE /api/communities/:identifier/members/:actorApId - Remove a member
  communitiesRouter.delete(
    "/:identifier/members/:actorApId",
    async (c: Context<{ Bindings: Env; Variables: Variables }>) => {
      const actor = c.get("actor");
      if (!actor) return c.json({ error: "Unauthorized" }, 401);

      const identifier = c.req.param("identifier")!;
      const targetApId = decodeURIComponent(c.req.param("actorApId")!);
      const db = c.get("db");

      const { community } = await fetchCommunityId(c, identifier);
      if (!community) {
        return c.json({ error: "Community not found" }, 404);
      }

      const actorMembership = await requireManager(
        db,
        community.apId,
        actor.ap_id,
      );
      if (!actorMembership) {
        return c.json({ error: "Forbidden" }, 403);
      }

      if (targetApId === actor.ap_id) {
        return c.json(
          { error: "Use /leave endpoint to leave the community" },
          400,
        );
      }

      const targetMembership = await db
        .select()
        .from(communityMembers)
        .where(memberWhere(community.apId, targetApId))
        .get();
      if (!targetMembership) {
        return c.json({ error: "User is not a member" }, 404);
      }

      if (
        targetMembership.role === "owner" &&
        actorMembership.role !== "owner"
      ) {
        return c.json({ error: "Only owners can remove other owners" }, 403);
      }

      await removeMemberAtomic(db, community.apId, targetApId);

      return c.json({ success: true });
    },
  );

  // PATCH /api/communities/:identifier/members/:actorApId - Update member role
  communitiesRouter.patch(
    "/:identifier/members/:actorApId",
    async (c: Context<{ Bindings: Env; Variables: Variables }>) => {
      const actor = c.get("actor");
      if (!actor) return c.json({ error: "Unauthorized" }, 401);

      const identifier = c.req.param("identifier")!;
      const targetApId = decodeURIComponent(c.req.param("actorApId")!);
      const db = c.get("db");
      const body = await c.req.json<{
        role: "owner" | "moderator" | "member";
      }>();

      if (!body.role || !["owner", "moderator", "member"].includes(body.role)) {
        return c.json({ error: "Invalid role" }, 400);
      }

      const { community } = await fetchCommunityId(c, identifier);
      if (!community) {
        return c.json({ error: "Community not found" }, 404);
      }

      // Only owners can change roles
      const actorMembership = await db
        .select()
        .from(communityMembers)
        .where(memberWhere(community.apId, actor.ap_id))
        .get();
      if (!actorMembership || actorMembership.role !== "owner") {
        return c.json({ error: "Only owners can change member roles" }, 403);
      }

      const targetMembership = await db
        .select()
        .from(communityMembers)
        .where(memberWhere(community.apId, targetApId))
        .get();
      if (!targetMembership) {
        return c.json({ error: "User is not a member" }, 404);
      }

      // Can't demote yourself if you're the last owner
      if (
        targetApId === actor.ap_id &&
        targetMembership.role === "owner" &&
        body.role !== "owner"
      ) {
        const ownerCountResult = await db
          .select({ count: count() })
          .from(communityMembers)
          .where(
            and(
              eq(communityMembers.communityApId, community.apId),
              eq(communityMembers.role, "owner"),
            ),
          )
          .get();
        if ((ownerCountResult?.count ?? 0) <= 1) {
          return c.json(
            { error: "Cannot demote: you are the only owner" },
            400,
          );
        }
      }

      await db
        .update(communityMembers)
        .set({ role: body.role })
        .where(memberWhere(community.apId, targetApId));

      return c.json({ success: true });
    },
  );

  // GET /api/communities/:identifier/members - List members
  communitiesRouter.get(
    "/:identifier/members",
    async (c: Context<{ Bindings: Env; Variables: Variables }>) => {
      const identifier = c.req.param("identifier")!;
      const db = c.get("db");
      const baseUrl = c.env.APP_URL;
      const apId = resolveCommunityApId(baseUrl, identifier);
      const limit = parseLimit(c.req.query("limit"), 100, 500);
      const offset = parseOffset(c.req.query("offset"), 0, 10000);

      const community = await db
        .select({ apId: communities.apId, visibility: communities.visibility })
        .from(communities)
        .where(
          or(
            eq(communities.apId, apId),
            eq(communities.preferredUsername, identifier),
          ),
        )
        .get();
      if (!community) {
        return c.json({ members: [] });
      }

      // Read gate: a non-public community's roster is members-only, mirroring the
      // /messages and /timeline?community= gates. Without this, anyone (even
      // unauthenticated) could enumerate a private community's full membership.
      if ((community.visibility || "public") !== "public") {
        const actor = c.get("actor");
        if (!actor) return c.json({ error: "Unauthorized" }, 401);
        const membership = await db
          .select({ role: communityMembers.role })
          .from(communityMembers)
          .where(memberWhere(community.apId, actor.ap_id))
          .get();
        if (!membership) {
          return c.json({ error: "Not a community member" }, 403);
        }
      }

      // Fetch limit+1 to signal whether more members exist beyond this page —
      // previously the roster was silently truncated at the page size with no
      // has_more, so a client could not tell a >page community from a complete
      // one. `total` is an accurate COUNT (the indexed communityApId scan is
      // cheap) so the UI can show the real member count.
      const [scanned, countRow] = await Promise.all([
        db
          .select()
          .from(communityMembers)
          .where(eq(communityMembers.communityApId, community.apId))
          .orderBy(desc(communityMembers.role), asc(communityMembers.joinedAt))
          .limit(limit + 1)
          .offset(offset),
        db
          .select({ c: count() })
          .from(communityMembers)
          .where(eq(communityMembers.communityApId, community.apId))
          .get(),
      ]);
      const hasMore = scanned.length > limit;
      const members = hasMore ? scanned.slice(0, limit) : scanned;
      const total = countRow?.c ?? members.length;

      const memberApIds = members.map((m) => m.actorApId);
      const actorInfoMap = await batchLoadActorInfo(db, memberApIds);

      const result = members.map((m) => {
        const actorInfo = actorInfoMap.get(m.actorApId);
        return {
          ap_id: m.actorApId,
          username: formatUsername(m.actorApId),
          preferred_username: actorInfo?.preferredUsername || null,
          name: actorInfo?.name || null,
          icon_url: actorInfo?.iconUrl || null,
          role: m.role,
          joined_at: m.joinedAt,
        };
      });

      return c.json({ members: result, has_more: hasMore, total });
    },
  );

  // POST /api/communities/:identifier/members/batch/remove - Bulk remove members
  communitiesRouter.post(
    "/:identifier/members/batch/remove",
    async (c: Context<{ Bindings: Env; Variables: Variables }>) => {
      const actor = c.get("actor");
      if (!actor) return c.json({ error: "Unauthorized" }, 401);

      const identifier = c.req.param("identifier")!;
      const db = c.get("db");
      const body = await c.req.json<{ actor_ap_ids: string[] }>();

      const validationError = validateBatchApIds(body.actor_ap_ids);
      if (validationError) return c.json({ error: validationError }, 400);

      const { community } = await fetchCommunityId(c, identifier);
      if (!community) {
        return c.json({ error: "Community not found" }, 404);
      }

      const actorMembership = await requireManager(
        db,
        community.apId,
        actor.ap_id,
      );
      if (!actorMembership) {
        return c.json({ error: "Permission denied" }, 403);
      }

      const results: { ap_id: string; success: boolean; error?: string }[] = [];

      // Pre-load every target's membership in ONE (chunked) query instead of a
      // SELECT per target; the role/owner checks below read from this map and
      // only the atomic removal stays per-target. Chunked because the batch
      // (<=100) plus the community param would otherwise exceed D1's 100-bound-
      // parameter cap.
      const membershipByApId = new Map<string, { role: string }>();
      for (const chunk of chunkForInClause(body.actor_ap_ids)) {
        const rows = await db
          .select({
            actorApId: communityMembers.actorApId,
            role: communityMembers.role,
          })
          .from(communityMembers)
          .where(
            and(
              eq(communityMembers.communityApId, community.apId),
              inArray(communityMembers.actorApId, chunk),
            ),
          );
        for (const r of rows) {
          membershipByApId.set(r.actorApId, { role: r.role });
        }
      }

      for (const targetApId of body.actor_ap_ids) {
        try {
          if (targetApId === actor.ap_id) {
            results.push({
              ap_id: targetApId,
              success: false,
              error: "Cannot remove yourself",
            });
            continue;
          }

          const targetMembership = membershipByApId.get(targetApId);
          if (!targetMembership) {
            results.push({
              ap_id: targetApId,
              success: false,
              error: "Not a member",
            });
            continue;
          }

          if (
            actorMembership.role !== "owner" &&
            targetMembership.role === "owner"
          ) {
            results.push({
              ap_id: targetApId,
              success: false,
              error: "Cannot remove owner",
            });
            continue;
          }

          await removeMemberAtomic(db, community.apId, targetApId);

          results.push({ ap_id: targetApId, success: true });
        } catch {
          results.push({
            ap_id: targetApId,
            success: false,
            error: "Internal error",
          });
        }
      }

      const removedCount = results.filter((r) => r.success).length;
      return c.json({ results, removed_count: removedCount });
    },
  );

  // POST /api/communities/:identifier/members/batch/role - Bulk update member roles
  communitiesRouter.post(
    "/:identifier/members/batch/role",
    async (c: Context<{ Bindings: Env; Variables: Variables }>) => {
      const actor = c.get("actor");
      if (!actor) return c.json({ error: "Unauthorized" }, 401);

      const identifier = c.req.param("identifier")!;
      const db = c.get("db");
      const body = await c.req.json<{
        actor_ap_ids: string[];
        role: "owner" | "moderator" | "member";
      }>();

      const validationError = validateBatchApIds(body.actor_ap_ids);
      if (validationError) return c.json({ error: validationError }, 400);

      if (!body.role || !["owner", "moderator", "member"].includes(body.role)) {
        return c.json({ error: "Valid role is required" }, 400);
      }

      const { community } = await fetchCommunityId(c, identifier);
      if (!community) {
        return c.json({ error: "Community not found" }, 404);
      }

      // Only owners can change roles
      const actorMembership = await db
        .select()
        .from(communityMembers)
        .where(memberWhere(community.apId, actor.ap_id))
        .get();
      if (!actorMembership || actorMembership.role !== "owner") {
        return c.json({ error: "Only owners can change roles" }, 403);
      }

      const results: { ap_id: string; success: boolean; error?: string }[] = [];

      for (const targetApId of body.actor_ap_ids) {
        try {
          const targetMembership = await db
            .select()
            .from(communityMembers)
            .where(memberWhere(community.apId, targetApId))
            .get();
          if (!targetMembership) {
            results.push({
              ap_id: targetApId,
              success: false,
              error: "Not a member",
            });
            continue;
          }

          // Can't demote yourself if you're the last owner
          if (
            targetApId === actor.ap_id &&
            targetMembership.role === "owner" &&
            body.role !== "owner"
          ) {
            const ownerCountResult = await db
              .select({ count: count() })
              .from(communityMembers)
              .where(
                and(
                  eq(communityMembers.communityApId, community.apId),
                  eq(communityMembers.role, "owner"),
                ),
              )
              .get();
            if ((ownerCountResult?.count ?? 0) <= 1) {
              results.push({
                ap_id: targetApId,
                success: false,
                error: "Cannot demote: only owner",
              });
              continue;
            }
          }

          await db
            .update(communityMembers)
            .set({ role: body.role })
            .where(memberWhere(community.apId, targetApId));

          results.push({ ap_id: targetApId, success: true });
        } catch {
          results.push({
            ap_id: targetApId,
            success: false,
            error: "Internal error",
          });
        }
      }

      return c.json({
        results,
        updated_count: results.filter((r) => r.success).length,
      });
    },
  );
}
