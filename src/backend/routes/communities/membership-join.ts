import type { Context, Hono } from "hono";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
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
  isMemberBanned,
  memberWhere,
  removeMemberAtomic,
  removeOwnerIfAnotherExists,
  unbanMember,
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
          // onConflictDoNothing so two concurrent first-time join requests by
          // the same actor (double-click / retry) don't 500 the loser on the
          // (communityApId, actorApId) composite PK — the request is idempotent
          // (matches the invite-join / open-join branches' unique handling).
          await db
            .insert(communityJoinRequests)
            .values({
              communityApId: community.apId,
              actorApId: actor.ap_id,
              status: "pending",
              createdAt: now,
            })
            .onConflictDoNothing();
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

          // Consuming a valid invite is an explicit re-admission — lift any ban.
          await unbanMember(db, community.apId, actor.ap_id);
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

      // Durable ban: a removed member cannot self-rejoin via OPEN join (the
      // auto-admit path the kick was meant to stop). Approval (a mod decides)
      // and invite (explicit re-admission) paths above stay open and lift the
      // ban on success, so a moderator can always let someone back in.
      if (await isMemberBanned(db, community.apId, actor.ap_id)) {
        return c.json(
          {
            error: "You have been removed from this community",
            status: "banned",
          },
          403,
        );
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

      // Don't allow the last owner to leave. Enforced ATOMICALLY rather than as
      // a count(owners) > 1 check then a separate delete — that is a TOCTOU two
      // concurrent owners can both pass, leaving the community with ZERO owners.
      // removeOwnerIfAnotherExists conditions the delete on another owner still
      // existing and reports whether it removed.
      if (membership.role === "owner") {
        const removed = await removeOwnerIfAnotherExists(
          db,
          community.apId,
          actor.ap_id,
        );
        if (!removed) {
          return c.json({ error: "Cannot leave: you are the only owner" }, 400);
        }
        return c.json({ success: true });
      }

      await removeMemberAtomic(db, community.apId, actor.ap_id);

      return c.json({ success: true });
    },
  );
}
