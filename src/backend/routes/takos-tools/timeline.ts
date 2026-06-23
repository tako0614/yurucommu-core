/**
 * Takos Tools - Timeline & notification handlers
 *
 * Handles: yurucommu_get_timeline, yurucommu_get_notifications
 */

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { actors, inbox, objects } from "../../../db/index.ts";
import { NO_AUDIENCE_PREDICATE } from "../../lib/community-visibility.ts";
import { encodeFeedCursor, feedCursorWhere } from "../../lib/feed-cursor.ts";
import {
  ACTOR_SUMMARY_COLUMNS,
  errAuth,
  formatActorSummary,
  ok,
  toolLimit,
} from "../takos-tools-response.ts";
import type { Input, ToolContext } from "./types.ts";

export async function handleGetTimeline(
  c: ToolContext,
  input: Input,
  _actor: { ap_id: string } | null,
) {
  const db = c.get("db");
  const limit = toolLimit(input.limit, 20, 50);
  const before = input.before ? String(input.before) : null;

  const whereConditions = [
    eq(objects.visibility, "public"),
    NO_AUDIENCE_PREDICATE,
    isNull(objects.deletedAt),
  ];
  // Composite (published, apId) cursor so agent pagination doesn't skip posts
  // sharing a published millisecond (see lib/feed-cursor.ts).
  const toolCursor = feedCursorWhere(objects.published, objects.apId, before);
  if (toolCursor) whereConditions.push(toolCursor);

  // Fetch one extra row as a has-more probe so the final/full page does NOT
  // advertise a next_cursor (the bare `.limit(limit)` returned a cursor on every
  // non-empty page, forcing the agent into one extra empty fetch and never a
  // clean end-of-feed). Mirrors the client feed/notifications limit+1 pattern.
  const scanned = await db
    .select()
    .from(objects)
    .where(and(...whereConditions))
    .orderBy(desc(objects.published), desc(objects.apId))
    .limit(limit + 1);
  const hasMore = scanned.length > limit;
  const posts = hasMore ? scanned.slice(0, limit) : scanned;

  const authorIds = [...new Set(posts.map((p) => p.attributedTo))];
  const authorRows =
    authorIds.length > 0
      ? await db
          .select(ACTOR_SUMMARY_COLUMNS)
          .from(actors)
          .where(inArray(actors.apId, authorIds))
      : [];

  const authorMap = new Map(authorRows.map((a) => [a.apId, a]));

  return c.json(
    ok({
      posts: posts.map((p) => {
        const author = authorMap.get(p.attributedTo);
        return {
          ap_id: p.apId,
          content: p.content,
          published: p.published,
          like_count: p.likeCount,
          author: author ? formatActorSummary(author) : null,
        };
      }),
      has_more: hasMore,
      next_cursor:
        hasMore && posts.length > 0
          ? encodeFeedCursor(
              posts[posts.length - 1].published,
              posts[posts.length - 1].apId,
            )
          : null,
    }),
  );
}

export async function handleGetNotifications(
  c: ToolContext,
  input: Input,
  actor: { ap_id: string } | null,
) {
  if (!actor) return c.json(errAuth(), 401);

  const db = c.get("db");
  const limit = toolLimit(input.limit, 20, 50);
  const unreadOnly = Boolean(input.unread_only);

  // Use query API with relations for inbox + activity join
  const inboxEntries = await db.query.inbox.findMany({
    where: and(
      eq(inbox.actorApId, actor.ap_id),
      ...(unreadOnly ? [eq(inbox.read, 0)] : []),
    ),
    with: {
      activity: true,
    },
    orderBy: desc(inbox.createdAt),
    limit,
  });

  // Filter: activity must not be from self and must be one of the expected types
  const allowedTypes = new Set(["Follow", "Like", "Announce", "Create"]);
  const filtered = inboxEntries.filter(
    (entry) =>
      entry.activity &&
      entry.activity.actorApId !== actor.ap_id &&
      allowedTypes.has(entry.activity.type),
  );

  return c.json(
    ok({
      notifications: filtered.map((entry) => ({
        id: entry.activityApId,
        type: entry.activity.type.toLowerCase(),
        from_actor: entry.activity.actorApId,
        object: entry.activity.objectApId,
        read: !!entry.read,
        created_at: entry.createdAt,
      })),
    }),
  );
}
