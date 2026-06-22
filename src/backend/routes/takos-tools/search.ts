/**
 * Takos Tools - Search handlers
 *
 * Handles: yurucommu_search_users, yurucommu_search_posts,
 *          yurucommu_get_trending, yurucommu_get_user_profile
 */

import { and, desc, eq, isNull, or } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { actors, objects } from "../../../db/index.ts";

// Escape SQLite LIKE metacharacters so a query containing `%`/`_`/`\` matches
// literally, not as a wildcard (mirrors search.ts / media.ts).
function escapeLike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
import { NO_AUDIENCE_PREDICATE } from "../../lib/community-visibility.ts";
import {
  ACTOR_SUMMARY_COLUMNS,
  errNotFound,
  errRequired,
  formatActorSummary,
  ok,
  requireString,
  toolLimit,
} from "../takos-tools-response.ts";
import type { Input, ToolContext } from "./types.ts";

export function handleSearchUsers(
  c: ToolContext,
  input: Input,
  _actor: { ap_id: string } | null,
) {
  return searchUsers(c, input);
}

export function handleSearchPosts(
  c: ToolContext,
  input: Input,
  _actor: { ap_id: string } | null,
) {
  return searchPosts(c, input);
}

export function handleGetTrending(
  c: ToolContext,
  input: Input,
  _actor: { ap_id: string } | null,
) {
  return getTrending(c, input);
}

export function handleGetUserProfile(
  c: ToolContext,
  input: Input,
  actor: { ap_id: string } | null,
) {
  return getUserProfile(c, input, actor);
}

// ---------------------------------------------------------------------------

async function searchUsers(c: ToolContext, input: Input) {
  const db = c.get("db");
  const query = requireString(input, "query");
  const limit = toolLimit(input.limit, 20, 50);

  if (!query) return c.json(ok({ actors: [] }));

  const results = await db
    .select({
      ...ACTOR_SUMMARY_COLUMNS,
      summary: actors.summary,
      followerCount: actors.followerCount,
    })
    .from(actors)
    .where(
      and(
        eq(actors.isPrivate, 0),
        or(
          sql`${actors.preferredUsername} LIKE ${`%${escapeLike(query)}%`} ESCAPE '\\'`,
          sql`${actors.name} LIKE ${`%${escapeLike(query)}%`} ESCAPE '\\'`,
        ),
      ),
    )
    .orderBy(desc(actors.followerCount))
    .limit(limit);

  return c.json(
    ok({
      actors: results.map((a) => ({
        ...formatActorSummary(a),
        summary: a.summary,
        follower_count: a.followerCount,
      })),
    }),
  );
}

async function searchPosts(c: ToolContext, input: Input) {
  const db = c.get("db");
  const query = requireString(input, "query");
  const limit = toolLimit(input.limit, 20, 50);

  if (!query) return c.json(ok({ posts: [] }));

  const posts = await db
    .select()
    .from(objects)
    .where(
      and(
        sql`${objects.content} LIKE ${`%${escapeLike(query)}%`} ESCAPE '\\'`,
        eq(objects.visibility, "public"),
        NO_AUDIENCE_PREDICATE,
        isNull(objects.deletedAt),
      ),
    )
    .orderBy(desc(objects.published))
    .limit(limit);

  return c.json(
    ok({
      posts: posts.map((p) => ({
        ap_id: p.apId,
        content: p.content,
        published: p.published,
        like_count: p.likeCount,
      })),
    }),
  );
}

async function getTrending(c: ToolContext, input: Input) {
  const db = c.get("db");
  const limit = toolLimit(input.limit, 10, 50);
  const sinceDate = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const posts = await db
    .select({ content: objects.content })
    .from(objects)
    .where(
      and(
        eq(objects.visibility, "public"),
        NO_AUDIENCE_PREDICATE,
        isNull(objects.deletedAt),
        sql`${objects.published} > ${sinceDate}`,
      ),
    )
    .orderBy(desc(objects.published))
    .limit(1000);

  const hashtagCounts: Record<string, number> = {};
  const hashtagRegex =
    /#([a-zA-Z0-9_\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]+)/g;

  for (const post of posts) {
    let match;
    while ((match = hashtagRegex.exec(post.content || "")) !== null) {
      const tagName = match[1].toLowerCase();
      hashtagCounts[tagName] = (hashtagCounts[tagName] || 0) + 1;
    }
  }

  const trending = Object.entries(hashtagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count }));

  return c.json(ok({ trending }));
}

async function getUserProfile(
  c: ToolContext,
  input: Input,
  actor: { ap_id: string } | null,
) {
  const db = c.get("db");
  const username = requireString(input, "username");
  if (!username) return c.json(errRequired("Username"), 400);

  const actorRecord = await db
    .select({
      ...ACTOR_SUMMARY_COLUMNS,
      summary: actors.summary,
      followerCount: actors.followerCount,
      followingCount: actors.followingCount,
      postCount: actors.postCount,
      isPrivate: actors.isPrivate,
    })
    .from(actors)
    .where(eq(actors.preferredUsername, username))
    .get();

  if (!actorRecord) return c.json(errNotFound("User"), 404);

  // Fail-close for private accounts (allow self lookup only).
  if (actorRecord.isPrivate && actor?.ap_id !== actorRecord.apId) {
    return c.json(errNotFound("User"), 404);
  }

  return c.json(
    ok({
      ...formatActorSummary(actorRecord),
      summary: actorRecord.summary,
      follower_count: actorRecord.followerCount,
      following_count: actorRecord.followingCount,
      post_count: actorRecord.postCount,
    }),
  );
}
