/**
 * Takos Tools - Timeline & notification handlers
 *
 * Handles: yurucommu_get_timeline, yurucommu_get_notifications
 */

import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { actors, inbox, objects } from "../../../db/index.ts";
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

  const whereConditions = [eq(objects.visibility, "public")];
  if (before) {
    whereConditions.push(lt(objects.published, before));
  }

  const posts = await db
    .select()
    .from(objects)
    .where(and(...whereConditions))
    .orderBy(desc(objects.published))
    .limit(limit);

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
      next_cursor: posts.length > 0 ? posts[posts.length - 1].published : null,
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
