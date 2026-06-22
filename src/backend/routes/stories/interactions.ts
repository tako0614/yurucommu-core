import { Hono } from "hono";
import { and, eq, gt, sql } from "drizzle-orm";
import type { Env, Variables } from "../../types.ts";
import {
  activities,
  blocks,
  inbox,
  likes,
  objects,
  storyShares,
  storyViews,
  storyVotes,
} from "../../../db/index.ts";
import {
  activityApId,
  generateId,
  isLocal,
  safeJsonParse,
} from "../../federation-helpers.ts";
import {
  canViewerReadStory,
  findStory,
  getVoteCounts,
  resolveStoryApId,
  sumVotes,
} from "./query-helpers.ts";
import { enqueueDeliveryToActor } from "../../lib/delivery/queue.ts";
import { rateLimit, RateLimitConfigs } from "../../middleware/rate-limit.ts";
import { logger } from "../../lib/logger.ts";
import { isUniqueConstraintError } from "../../lib/parse-helpers.ts";

const log = logger.child({ component: "stories.interactions" });

// `.batch` lives only on the concrete D1/libsql subclasses, not the Database
// union; reach it through a narrow structural cast (matching the other routes).
type Batchable = { batch: (stmts: unknown[]) => Promise<unknown> };

const stories = new Hono<{ Bindings: Env; Variables: Variables }>();

// Rate-limit story interaction write paths per-actor (same budget as story
// create), rather than leaving them in the general read bucket. Registered as
// POST middleware ahead of the handlers below. `/:id/votes` and `/:id/shares`
// are reads and are intentionally not limited here.
const storyWriteLimiter = rateLimit(RateLimitConfigs.storyWrite);
stories.post("/view", storyWriteLimiter);
stories.post("/vote", storyWriteLimiter);
stories.post("/:id/like", storyWriteLimiter);
stories.delete("/:id/like", storyWriteLimiter);
stories.post("/:id/share", storyWriteLimiter);

type StoryOverlay = {
  type?: string;
  oneOf?: unknown[];
};

type StoryData = {
  overlays?: StoryOverlay[];
};

// Mark story as viewed
stories.post("/view", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  const db = c.get("db");
  const body = await c.req.json<{ ap_id: string }>();
  if (!body.ap_id) return c.json({ error: "ap_id required" }, 400);
  const apId = body.ap_id;

  const story = await findStory(db, apId);
  if (!story) return c.json({ error: "Story not found" }, 404);

  const now = new Date().toISOString();
  if (story.endTime && story.endTime < now) {
    return c.json({ error: "Story has expired" }, 410);
  }
  // Only someone who can actually see the story may register a view (the author
  // sees who viewed) — a non-follower / non-member must not be able to.
  if (!(await canViewerReadStory(db, story, actor.ap_id))) {
    return c.json({ error: "Story not found" }, 404);
  }

  try {
    // Upsert: check existence then insert if not found
    const existing = await db
      .select()
      .from(storyViews)
      .where(
        and(
          eq(storyViews.actorApId, actor.ap_id),
          eq(storyViews.storyApId, apId),
        ),
      )
      .get();

    if (!existing) {
      await db.insert(storyViews).values({
        actorApId: actor.ap_id,
        storyApId: apId,
        viewedAt: now,
      });
    }
  } catch {
    // Ignore duplicate key errors
  }

  return c.json({ success: true });
});

// Vote on a story poll
stories.post("/vote", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  const db = c.get("db");
  const body = await c.req.json<{ ap_id: string; option_index: number }>();
  if (!body.ap_id) return c.json({ error: "ap_id required" }, 400);
  const apId = body.ap_id;

  if (typeof body.option_index !== "number" || body.option_index < 0) {
    return c.json({ error: "Invalid option_index" }, 400);
  }

  const story = await findStory(db, apId);
  if (!story) return c.json({ error: "Story not found" }, 404);

  if (story.attributedTo === actor.ap_id) {
    return c.json({ error: "Cannot vote on your own story" }, 403);
  }

  const now = new Date().toISOString();
  if (story.endTime && story.endTime < now) {
    return c.json({ error: "Story has expired" }, 410);
  }
  // A non-follower / non-member must not be able to vote on a story they cannot
  // see (the author would otherwise receive poll votes from unentitled actors).
  if (!(await canViewerReadStory(db, story, actor.ap_id))) {
    return c.json({ error: "Story not found" }, 404);
  }

  // Validate option_index against the first Question overlay
  const storyData = safeJsonParse<StoryData>(story.attachmentsJson, {});
  const questionOverlays = (storyData.overlays || []).filter(
    (o) => o.type === "Question",
  );

  if (questionOverlays.length === 0) {
    return c.json({ error: "Story has no poll" }, 400);
  }

  const maxOptionIndex = questionOverlays[0].oneOf?.length || 0;
  if (body.option_index >= maxOptionIndex) {
    return c.json(
      { error: `option_index must be 0-${maxOptionIndex - 1}` },
      400,
    );
  }

  // Upsert vote atomically. A concurrent double-vote previously raced the
  // check-then-insert and 500'd on the (storyApId, actorApId) unique index;
  // letting the DB resolve the conflict makes re-voting idempotent without a
  // pre-read. On conflict we keep the existing row's id and only update the
  // chosen option / timestamp.
  await db
    .insert(storyVotes)
    .values({
      id: generateId(),
      storyApId: apId,
      actorApId: actor.ap_id,
      optionIndex: body.option_index,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [storyVotes.storyApId, storyVotes.actorApId],
      set: { optionIndex: body.option_index, createdAt: now },
    });

  const votes = await getVoteCounts(db, apId);
  return c.json({
    success: true,
    votes,
    total: sumVotes(votes),
    user_vote: body.option_index,
  });
});

// Like a story
stories.post("/:id/like", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  const db = c.get("db");
  const baseUrl = c.env.APP_URL;
  const apId = resolveStoryApId(c.req.param("id"), baseUrl);

  const story = await findStory(db, apId);
  if (!story) return c.json({ error: "Story not found" }, 404);

  // Reject if the story author has blocked the liker, so a blocked actor
  // cannot insert into the author's inbox. Respond with 404 (matching a
  // non-existent story) so the block is not leaked to the liker.
  const blockedBy = await db
    .select({ blockerApId: blocks.blockerApId })
    .from(blocks)
    .where(
      and(
        eq(blocks.blockerApId, story.attributedTo),
        eq(blocks.blockedApId, actor.ap_id),
      ),
    )
    .get();
  if (blockedBy) return c.json({ error: "Story not found" }, 404);

  const nowIso = new Date().toISOString();
  if (story.endTime && story.endTime < nowIso) {
    return c.json({ error: "Story has expired" }, 410);
  }
  // Only someone who can see the story may like it (otherwise a non-follower /
  // non-member notifies the author + bumps the count on a story never shown).
  if (!(await canViewerReadStory(db, story, actor.ap_id))) {
    return c.json({ error: "Story not found" }, 404);
  }

  const existing = await db
    .select()
    .from(likes)
    .where(and(eq(likes.actorApId, actor.ap_id), eq(likes.objectApId, apId)))
    .get();
  if (existing) {
    return c.json({ success: true, liked: true, like_count: story.likeCount });
  }

  const likeId = generateId();
  const likeActivityApId = activityApId(baseUrl, likeId);
  const now = new Date().toISOString();

  // Co-commit the like edge + count bump in one batch so a crash between them
  // can't drift likeCount; the bare insert throws on a concurrent duplicate,
  // rolling back the whole batch (no double-count).
  try {
    await (db as unknown as Batchable).batch([
      db.insert(likes).values({
        actorApId: actor.ap_id,
        objectApId: apId,
        activityApId: likeActivityApId,
        createdAt: now,
      }),
      db
        .update(objects)
        .set({ likeCount: sql`${objects.likeCount} + 1` })
        .where(eq(objects.apId, apId)),
    ]);
  } catch (e) {
    // A concurrent like won the race (TOCTOU past the existing-check); treat as
    // idempotent success instead of surfacing a 500 unique-constraint error. The
    // like now provably exists (the winner committed +1), so echo the
    // incremented count — matching the success path — not the pre-read value.
    if (isUniqueConstraintError(e)) {
      return c.json({
        success: true,
        liked: true,
        like_count: story.likeCount + 1,
      });
    }
    throw e;
  }

  const likeActivityRaw = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: likeActivityApId,
    type: "Like",
    actor: actor.ap_id,
    object: apId,
  };

  await db.insert(activities).values({
    apId: likeActivityApId,
    type: "Like",
    actorApId: actor.ap_id,
    objectApId: apId,
    rawJson: JSON.stringify(likeActivityRaw),
    createdAt: now,
  });

  if (
    story.attributedTo !== actor.ap_id &&
    isLocal(story.attributedTo, baseUrl)
  ) {
    await db.insert(inbox).values({
      actorApId: story.attributedTo,
      activityApId: likeActivityApId,
      read: 0,
      createdAt: now,
    });
  }

  if (!isLocal(apId, baseUrl)) {
    try {
      await enqueueDeliveryToActor(c.env, likeActivityApId, story.attributedTo);
    } catch (e) {
      log.error("Failed to enqueue Like activity for story", {
        event: "stories.like.enqueue_failed",
        storyApId: apId,
        recipient: story.attributedTo,
        error: e,
      });
    }
  }

  return c.json({
    success: true,
    liked: true,
    like_count: story.likeCount + 1,
  });
});

// Unlike a story
stories.delete("/:id/like", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  const db = c.get("db");
  const baseUrl = c.env.APP_URL;
  const apId = resolveStoryApId(c.req.param("id"), baseUrl);

  const story = await findStory(db, apId);
  if (!story) return c.json({ error: "Story not found" }, 404);

  const like = await db
    .select()
    .from(likes)
    .where(and(eq(likes.actorApId, actor.ap_id), eq(likes.objectApId, apId)))
    .get();
  if (!like) return c.json({ error: "Not liked" }, 400);

  // Co-commit the count decrement (guarded gt>0 against underflow) + edge delete
  // in one batch so a crash between them can't leave likeCount drifted.
  await (db as unknown as Batchable).batch([
    db
      .update(objects)
      .set({ likeCount: sql`${objects.likeCount} - 1` })
      .where(and(eq(objects.apId, apId), gt(objects.likeCount, 0))),
    db
      .delete(likes)
      .where(and(eq(likes.actorApId, actor.ap_id), eq(likes.objectApId, apId))),
  ]);

  if (!isLocal(apId, baseUrl)) {
    const undoObject = like.activityApId
      ? like.activityApId
      : { type: "Like", actor: actor.ap_id, object: apId };
    const undoLikeActivity = {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: activityApId(baseUrl, generateId()),
      type: "Undo",
      actor: actor.ap_id,
      object: undoObject,
    };

    // Store activity first (queue consumer loads rawJson by activityId).
    // Upsert: check existence then insert if not found
    const existingActivity = await db
      .select()
      .from(activities)
      .where(eq(activities.apId, undoLikeActivity.id))
      .get();

    if (!existingActivity) {
      await db.insert(activities).values({
        apId: undoLikeActivity.id,
        type: "Undo",
        actorApId: actor.ap_id,
        objectApId: apId,
        rawJson: JSON.stringify(undoLikeActivity),
        direction: "outbound",
      });
    }

    try {
      await enqueueDeliveryToActor(
        c.env,
        undoLikeActivity.id,
        story.attributedTo,
      );
    } catch (e) {
      log.error("Failed to enqueue Undo Like for story", {
        event: "stories.unlike.enqueue_failed",
        storyApId: apId,
        recipient: story.attributedTo,
        error: e,
      });
    }
  }

  return c.json({
    success: true,
    liked: false,
    like_count: Math.max(0, story.likeCount - 1),
  });
});

// Share a story (track that user shared it)
stories.post("/:id/share", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  const db = c.get("db");
  const baseUrl = c.env.APP_URL;
  const apId = resolveStoryApId(c.req.param("id"), baseUrl);

  const story = await findStory(db, apId);
  if (!story) return c.json({ error: "Story not found" }, 404);

  const nowIso = new Date().toISOString();
  if (story.endTime && story.endTime < nowIso) {
    return c.json({ error: "Story has expired" }, 410);
  }
  // Re-sharing is only for a story the actor can see — never a followers-only /
  // community story they were not shown.
  if (!(await canViewerReadStory(db, story, actor.ap_id))) {
    return c.json({ error: "Story not found" }, 404);
  }

  const existing = await db
    .select()
    .from(storyShares)
    .where(
      and(
        eq(storyShares.storyApId, apId),
        eq(storyShares.actorApId, actor.ap_id),
      ),
    )
    .get();
  if (existing) {
    return c.json({
      success: true,
      shared: true,
      share_count: story.shareCount || 0,
    });
  }

  const now = new Date().toISOString();

  // Co-commit the share edge + count bump in one batch (crash-safe; the bare
  // insert rolls the batch back on a duplicate).
  try {
    await (db as unknown as Batchable).batch([
      db.insert(storyShares).values({
        id: generateId(),
        storyApId: apId,
        actorApId: actor.ap_id,
        sharedAt: now,
      }),
      db
        .update(objects)
        .set({ shareCount: sql`${objects.shareCount} + 1` })
        .where(eq(objects.apId, apId)),
    ]);
  } catch (e) {
    // Concurrent share won the race past the existing-check; idempotent success.
    // The share now provably exists, so echo the incremented count (matching the
    // success path) rather than the pre-read value.
    if (isUniqueConstraintError(e)) {
      return c.json({
        success: true,
        shared: true,
        share_count: (story.shareCount || 0) + 1,
      });
    }
    throw e;
  }

  return c.json({
    success: true,
    shared: true,
    share_count: (story.shareCount || 0) + 1,
  });
});

// Get share count for a story
stories.get("/:id/shares", async (c) => {
  const db = c.get("db");
  const actor = c.get("actor");
  const baseUrl = c.env.APP_URL;
  const apId = resolveStoryApId(c.req.param("id"), baseUrl);

  // Full row (not just shareCount) so the visibility gate can read
  // attributedTo / communityApId, mirroring the view/vote/like handlers.
  const story = await findStory(db, apId);
  if (!story) return c.json({ error: "Story not found" }, 404);
  if (!(await canViewerReadStory(db, story, actor?.ap_id))) {
    return c.json({ error: "Story not found" }, 404);
  }

  return c.json({ share_count: story.shareCount || 0 });
});

// Get votes for a story
stories.get("/:id/votes", async (c) => {
  const db = c.get("db");
  const actor = c.get("actor");
  const baseUrl = c.env.APP_URL;
  // Resolve the id the same way every sibling /:id/* route does, so a full
  // story ap_id (the form the like/share routes accept) is matched instead of
  // being double-prefixed into a non-existent objects row.
  const apId = resolveStoryApId(c.req.param("id"), baseUrl);

  const story = await findStory(db, apId);
  if (!story) return c.json({ error: "Story not found" }, 404);
  // Gate the poll tally behind the same visibility rule as the view/vote
  // handlers — a non-follower / non-member (or anonymous) must not read the
  // tally of a followers-only / private-community story. 404 (not 403) so the
  // gate isn't a story-existence oracle.
  if (!(await canViewerReadStory(db, story, actor?.ap_id))) {
    return c.json({ error: "Story not found" }, 404);
  }

  const votes = await getVoteCounts(db, apId);

  let user_vote: number | undefined;
  if (actor) {
    const userVote = await db
      .select({ optionIndex: storyVotes.optionIndex })
      .from(storyVotes)
      .where(
        and(
          eq(storyVotes.storyApId, apId),
          eq(storyVotes.actorApId, actor.ap_id),
        ),
      )
      .get();
    if (userVote) user_vote = userVote.optionIndex;
  }

  return c.json({ votes, total: sumVotes(votes), user_vote });
});

export default stories;
