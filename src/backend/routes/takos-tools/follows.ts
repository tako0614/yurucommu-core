/**
 * Takos Tools - Follow handlers
 *
 * Handles: yurucommu_follow_user, yurucommu_unfollow_user,
 *          yurucommu_get_followers, yurucommu_get_following
 */

import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { actors, follows } from "../../../db/index.ts";
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

    await db.insert(follows).values({
      followerApId: actor.ap_id,
      followingApId: target.apId,
      status,
    });

    if (status === "accepted") {
      await db
        .update(actors)
        .set({ followingCount: sql`${actors.followingCount} + 1` })
        .where(eq(actors.apId, actor.ap_id));
      await db
        .update(actors)
        .set({ followerCount: sql`${actors.followerCount} + 1` })
        .where(eq(actors.apId, target.apId));
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
    await db
      .delete(follows)
      .where(
        and(
          eq(follows.followerApId, actor.ap_id),
          eq(follows.followingApId, target.apId),
        ),
      );

    if (follow.status === "accepted") {
      await db
        .update(actors)
        .set({ followingCount: sql`${actors.followingCount} - 1` })
        .where(eq(actors.apId, actor.ap_id));
      await db
        .update(actors)
        .set({ followerCount: sql`${actors.followerCount} - 1` })
        .where(eq(actors.apId, target.apId));
    }
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
