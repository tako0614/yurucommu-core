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
    // Co-commit the edge delete + guarded counter decrements atomically; the
    // gt(...,0) guards prevent underflow on a redelivered/retried unfollow.
    const ops: unknown[] = [
      db
        .delete(follows)
        .where(
          and(
            eq(follows.followerApId, actor.ap_id),
            eq(follows.followingApId, target.apId),
          ),
        ),
    ];
    if (follow.status === "accepted") {
      ops.push(
        db
          .update(actors)
          .set({ followingCount: sql`${actors.followingCount} - 1` })
          .where(
            and(eq(actors.apId, actor.ap_id), gt(actors.followingCount, 0)),
          ),
        db
          .update(actors)
          .set({ followerCount: sql`${actors.followerCount} - 1` })
          .where(
            and(eq(actors.apId, target.apId), gt(actors.followerCount, 0)),
          ),
      );
    }
    await (db as unknown as Batchable).batch(ops);
  }

  return c.json(ok({ unfollowed: true }));
}

export async function handleGetFollowList(
  c: ToolContext,
  input: Input,
  _actor: { ap_id: string } | null,
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

  const actorList = await fetchFollowList(db, target.apId, direction, limit);

  return c.json(ok({ [direction]: actorList.map(formatActorSummary) }));
}
