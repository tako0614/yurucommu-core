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
import {
  fetchCommunityDetails,
  memberWhere,
  removeMemberAtomic,
} from "./membership-shared.ts";
import { isUniqueConstraintError } from "../../lib/parse-helpers.ts";
import { logger } from "../../lib/logger.ts";

const log = logger.child({ component: "communities.join" });

/**
 * Narrow view over the concrete D1/libsql drizzle client's atomic batch API.
 * The shared `Database` union type does not surface `batch` (it lives on the
 * concrete subclasses), so we reach it through a structural cast at the one
 * call site that needs an atomic multi-statement write.
 */
type Batchable = {
  batch(statements: readonly unknown[]): Promise<unknown>;
};

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
      const existing = await db
        .select()
        .from(communityMembers)
        .where(memberWhere(community.apId, actor.ap_id))
        .get();
      if (existing) {
        return c.json({ error: "Already a member" }, 409);
      }

      const now = new Date().toISOString();

      // A PRIVATE community must never be OPENLY self-joinable — open join would
      // let ANY logged-in actor join and thereby read its members-only content,
      // defeating the privacy. If an owner left joinPolicy="open" while flipping
      // the community private, treat the join as "approval" (held pending) so the
      // owner still gates who gets in. Invite-policy is unaffected.
      const effectiveJoinPolicy =
        community.visibility === "private" && community.joinPolicy === "open"
          ? "approval"
          : community.joinPolicy;

      if (effectiveJoinPolicy === "approval") {
        // Upsert: check if exists, then insert or update
        const existingRequest = await db
          .select()
          .from(communityJoinRequests)
          .where(
            and(
              eq(communityJoinRequests.communityApId, community.apId),
              eq(communityJoinRequests.actorApId, actor.ap_id),
            ),
          )
          .get();

        if (existingRequest) {
          await db
            .update(communityJoinRequests)
            .set({ status: "pending", createdAt: now, processedAt: null })
            .where(
              and(
                eq(communityJoinRequests.communityApId, community.apId),
                eq(communityJoinRequests.actorApId, actor.ap_id),
              ),
            );
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

      if (effectiveJoinPolicy === "invite") {
        if (!inviteId) {
          return c.json(
            { error: "Invite required", status: "invite_required" },
            403,
          );
        }

        try {
          // Find the invite
          const invite = await db
            .select()
            .from(communityInvites)
            .where(
              and(
                eq(communityInvites.id, inviteId),
                eq(communityInvites.communityApId, community.apId),
                isNull(communityInvites.usedAt),
                or(
                  isNull(communityInvites.expiresAt),
                  gt(communityInvites.expiresAt, now),
                ),
              ),
            )
            .get();

          if (!invite) {
            return c.json(
              {
                error: "Invalid or expired invite",
                status: "invite_required",
              },
              403,
            );
          }
          if (invite.invitedApId && invite.invitedApId !== actor.ap_id) {
            return c.json(
              {
                error: "Invite not for this account",
                status: "invite_required",
              },
              403,
            );
          }

          // Claim the invite FIRST — this conditional single-use UPDATE is the
          // race GATE. Only the writer that flips usedAt from NULL (affecting
          // exactly one row) is allowed to materialize the membership; a racing
          // loser sees 0 rows affected and is rejected, so it never leaves a
          // phantom member row or an inflated memberCount behind.
          const claimResult = await db
            .update(communityInvites)
            .set({ usedByApId: actor.ap_id, usedAt: now })
            .where(
              and(
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
              ),
            );
          if (affectedRowCount(claimResult) !== 1) {
            // Lost the single-use claim race (or invite was used/expired
            // between the read above and this write). Reject without touching
            // membership or the count.
            return c.json(
              {
                error: "Invalid or expired invite",
                status: "invite_required",
              },
              403,
            );
          }

          // Won the claim: create the member + bump the count atomically.
          // D1 has no interactive transactions; group the member insert and
          // the counter increment into a single batch so they cannot diverge.
          // The `Database` union type does not surface `batch` (it is only on
          // the concrete D1/libsql subclasses), so reach it through a narrow
          // structural cast.
          const memberInsert = db.insert(communityMembers).values({
            communityApId: community.apId,
            actorApId: actor.ap_id,
            role: "member",
            joinedAt: now,
          });
          const countBump = db
            .update(communities)
            .set({ memberCount: sql`${communities.memberCount} + 1` })
            .where(eq(communities.apId, community.apId));
          await (db as unknown as Batchable).batch([memberInsert, countBump]);

          return c.json({ success: true, status: "joined" });
        } catch (error) {
          if (isUniqueConstraintError(error)) {
            return c.json({ error: "Already a member" }, 409);
          }
          log.error("Failed to join with invite", {
            event: "communities.join.invite_failed",
            community: community.apId,
            actor: actor.ap_id,
            error,
          });
          return c.json({ error: "Failed to join community" }, 500);
        }
      }

      // Open join — create the member + bump the count atomically. D1 has no
      // interactive transactions; group the member insert and the counter
      // increment into a single batch so they cannot diverge on a mid-request
      // failure (matching the invite-join path). The `Database` union type does
      // not surface `batch` (it is only on the concrete D1/libsql subclasses),
      // so reach it through a narrow structural cast.
      try {
        const memberInsert = db.insert(communityMembers).values({
          communityApId: community.apId,
          actorApId: actor.ap_id,
          role: "member",
          joinedAt: now,
        });
        const countBump = db
          .update(communities)
          .set({ memberCount: sql`${communities.memberCount} + 1` })
          .where(eq(communities.apId, community.apId));
        await (db as unknown as Batchable).batch([memberInsert, countBump]);

        return c.json({ success: true, status: "joined" });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          return c.json({ error: "Already a member" }, 409);
        }
        log.error("Failed to join community", {
          event: "communities.join.failed",
          community: community.apId,
          actor: actor.ap_id,
          error,
        });
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

      const membership = await db
        .select()
        .from(communityMembers)
        .where(memberWhere(community.apId, actor.ap_id))
        .get();
      if (!membership) {
        return c.json({ error: "Not a member" }, 400);
      }

      // Don't allow the last owner to leave
      if (membership.role === "owner") {
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
          return c.json({ error: "Cannot leave: you are the only owner" }, 400);
        }
      }

      await removeMemberAtomic(db, community.apId, actor.ap_id);

      return c.json({ success: true });
    },
  );
}
