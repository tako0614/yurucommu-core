/**
 * Takos Tools - Follow handlers
 *
 * Handles: yurucommu_follow_user, yurucommu_unfollow_user,
 *          yurucommu_get_followers, yurucommu_get_following
 */

import { and, eq, gt } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { actors, follows } from "../../../db/index.ts";
import { isUniqueConstraintError } from "../../lib/parse-helpers.ts";
import {
  errAuth,
  errNotFound,
  errRequired,
  fetchFollowList,
  formatActorSummary,
  ok,
  requireString,
  toolLimit,
  type ToolResponse,
} from "../takos-tools-response.ts";
import type { Input, ToolContext } from "./types.ts";

// `.batch` lives only on the concrete D1/libsql subclasses; reach it through a
// narrow structural cast so the edge + counter updates commit atomically.
type Batchable = { batch: (stmts: unknown[]) => Promise<unknown> };

export async function handleFollowUser(
  c: ToolContext,
  input: Input,
  actor: { ap_id: string } | null,
) {
  if (!actor) return c.json(errAuth(), 401);

  const db = c.get("db");
  const username = requireString(input, "username");
  if (!username) return c.json(errRequired("Username"), 400);

  const target = await db
    .select()
    .from(actors)
    .where(eq(actors.preferredUsername, username))
    .get();
  if (!target) return c.json(errNotFound("User"), 404);

  if (target.apId === actor.ap_id) {
    return c.json(
      { success: false, error: "Cannot follow yourself" } as ToolResponse,
      400,
    );
  }

  const existingFollow = await db
    .select()
    .from(follows)
    .where(
      and(
        eq(follows.followerApId, actor.ap_id),
        eq(follows.followingApId, target.apId),
      ),
    )
    .get();

  if (!existingFollow) {
    const status = target.isPrivate ? "pending" : "accepted";

    // Co-commit the edge + counter bumps in one atomic batch so a mid-write
    // failure can't leave the edge with un-incremented counts (permanent drift).
    const ops: unknown[] = [
      db.insert(follows).values({
        followerApId: actor.ap_id,
        followingApId: target.apId,
        status,
      }),
    ];
    if (status === "accepted") {
      ops.push(
        db
          .update(actors)
          .set({ followingCount: sql`${actors.followingCount} + 1` })
          .where(eq(actors.apId, actor.ap_id)),
        db
          .update(actors)
          .set({ followerCount: sql`${actors.followerCount} + 1` })
          .where(eq(actors.apId, target.apId)),
      );
    }
    try {
      await (db as unknown as Batchable).batch(ops);
    } catch (e) {
      // A concurrent follow won the race past the existing-check: the unique
      // (follower, following) edge now exists and its atomic batch already
      // applied the +1s. Treat as idempotent success instead of a 500.
      if (!isUniqueConstraintError(e)) throw e;
    }
  }

  return c.json(
    ok({
      following: true,
      status: target.isPrivate ? "pending" : "accepted",
    }),
  );
}

export async function handleUnfollowUser(
  c: ToolContext,
  input: Input,
  actor: { ap_id: string } | null,
) {
  if (!actor) return c.json(errAuth(), 401);

  const db = c.get("db");
  const username = requireString(input, "username");
  if (!username) return c.json(errRequired("Username"), 400);

  const target = await db
    .select()
    .from(actors)
    .where(eq(actors.preferredUsername, username))
    .get();
  if (!target) return c.json(errNotFound("User"), 404);

  const follow = await db
    .select()
    .from(follows)
    .where(
      and(
        eq(follows.followerApId, actor.ap_id),
        eq(follows.followingApId, target.apId),
      ),
    )
    .get();

  if (follow) {
    // #COUNTER-SYM: the decrements run BEFORE the delete and are each gated on
    // the accepted edge STILL existing (correlated EXISTS), so two concurrent /
    // retried unfollows can't double-decrement — the second batch's EXISTS is
    // false (the first already deleted the edge) → its -1s match 0 rows. gt(>0)
    // additionally guards underflow. Mirrors the canonical web/federated paths.
    const acceptedEdgeExists = sql`EXISTS (SELECT 1 FROM ${follows} WHERE ${follows.followerApId} = ${actor.ap_id} AND ${follows.followingApId} = ${target.apId} AND ${follows.status} = 'accepted')`;
    const ops: unknown[] = [];
    if (follow.status === "accepted") {
      ops.push(
        db
          .update(actors)
          .set({ followingCount: sql`${actors.followingCount} - 1` })
          .where(
            and(
              eq(actors.apId, actor.ap_id),
              gt(actors.followingCount, 0),
              acceptedEdgeExists,
            ),
          ),
        db
          .update(actors)
          .set({ followerCount: sql`${actors.followerCount} - 1` })
          .where(
            and(
              eq(actors.apId, target.apId),
              gt(actors.followerCount, 0),
              acceptedEdgeExists,
            ),
          ),
      );
    }
    ops.push(
      db
        .delete(follows)
        .where(
          and(
            eq(follows.followerApId, actor.ap_id),
            eq(follows.followingApId, target.apId),
          ),
        ),
    );
    await (db as unknown as Batchable).batch(ops);
  }

  return c.json(ok({ unfollowed: true }));
}

export async function handleGetFollowList(
  c: ToolContext,
  input: Input,
  actor: { ap_id: string } | null,
  direction: "followers" | "following",
) {
  const db = c.get("db");
  const username = requireString(input, "username");
  const limit = toolLimit(input.limit, 20, 50);

  if (!username) return c.json(errRequired("Username"), 400);

  const target = await db
    .select()
    .from(actors)
    .where(eq(actors.preferredUsername, username))
    .get();
  if (!target) return c.json(errNotFound("User"), 404);

  // A locked (private) account's follower/following list is withheld from
  // everyone but the account owner — count only — matching the web route
  // listFollowRelation. Without this the MCP surface would be a graph-
  // enumeration bypass of the locked-account gate.
  if (target.isPrivate && actor?.ap_id !== target.apId) {
    const count =
      direction === "followers" ? target.followerCount : target.followingCount;
    return c.json(ok({ [direction]: [], count }));
  }

  const actorList = await fetchFollowList(db, target.apId, direction, limit);

  return c.json(ok({ [direction]: actorList.map(formatActorSummary) }));
}
