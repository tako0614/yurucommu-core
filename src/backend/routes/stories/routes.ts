// Story routes for Yurucommu backend
// v2: 1 Story = 1 Media (Instagram style)
import { Hono } from "hono";
import { and, desc, eq, gt, inArray, notInArray, sql } from "drizzle-orm";
import type { Database } from "../../../db/index.ts";
import {
  activities,
  actors,
  follows,
  likes,
  objects,
  storyShares,
  storyViews,
  storyVotes,
} from "../../../db/index.ts";
import type { Env, Variables } from "../../types.ts";
import {
  activityApId,
  actorApId,
  formatUsername,
  generateId,
  objectApId,
} from "../../federation-helpers.ts";
import { storyToActivityPub } from "../../lib/activitypub-helpers.ts";
import { rateLimit, RateLimitConfigs } from "../../middleware/rate-limit.ts";
import {
  cleanupExpiredStories,
  fetchActorCache,
  fetchBatchVotes,
  fetchBlockedAndMutedIds,
  sumVotes,
  transformStoryData,
  validateOverlays,
} from "./query-helpers.ts";
import { enqueueFanoutToFollowers } from "../../lib/delivery/queue.ts";
import { logger } from "../../lib/logger.ts";

const log = logger.child({ component: "stories.routes" });

const stories = new Hono<{ Bindings: Env; Variables: Variables }>();

// Best-effort, opportunistic retention of expired stories.
//
// This is NOT a substitute for a scheduled job: this Worker has no `scheduled`
// handler / cron trigger, so expiry cleanup is triggered probabilistically on
// the read path. Expired stories are already excluded from every read query
// (the feed/single-story handlers filter on `endTime`), so the only impact of
// a missed sweep is storage growth, not stale data leaking to users. The guard
// below ensures at most one sweep runs at a time per isolate, so a burst of
// feed requests cannot kick off several concurrent full-table delete sweeps.
let expiredStoryCleanupInFlight = false;

function maybeCleanupExpiredStories(db: Database): void {
  if (expiredStoryCleanupInFlight) return;
  if (Math.random() >= 0.01) return; // ~1% of feed requests per isolate

  expiredStoryCleanupInFlight = true;
  cleanupExpiredStories(db)
    .catch((err) => {
      log.warn("Failed to cleanup expired stories", {
        event: "stories.cleanup.failed",
        error: err,
      });
    })
    .finally(() => {
      expiredStoryCleanupInFlight = false;
    });
}

// Rate-limit story write paths (publish-like / fanout) per-actor, instead of
// letting them share the generous general read bucket. Registered as POST
// middleware ahead of the handlers below so it runs before each write.
const storyWriteLimiter = rateLimit(RateLimitConfigs.storyWrite);
stories.post("/", storyWriteLimiter);
stories.post("/delete", storyWriteLimiter);

type VoteResults = Record<number, number>;

type StoryAuthor = {
  ap_id: string;
  username: string;
  preferred_username: string | null;
  name: string | null;
  icon_url: string | null;
};

type StoryResponse = {
  ap_id: string;
  author: StoryAuthor;
  attachment: ReturnType<typeof transformStoryData>["attachment"];
  displayDuration: string;
  overlays?: ReturnType<typeof transformStoryData>["overlays"];
  end_time: string;
  published: string;
  viewed: boolean;
  like_count: number;
  share_count: number;
  liked: boolean;
  votes?: VoteResults;
  votes_total?: number;
  user_vote?: number;
};

type StoryCreateBody = {
  attachment: {
    r2_key: string;
    content_type: string;
    width?: number;
    height?: number;
  };
  displayDuration: string;
  overlays?: unknown[];
};

/** Build a StoryAuthor from available data sources. */
function buildAuthor(
  apId: string,
  data:
    | {
      preferredUsername?: string | null;
      name?: string | null;
      iconUrl?: string | null;
    }
    | null
    | undefined,
): StoryAuthor {
  return {
    ap_id: apId,
    username: formatUsername(apId),
    preferred_username: data?.preferredUsername || null,
    name: data?.name || null,
    icon_url: data?.iconUrl || null,
  };
}

/** Build a StoryResponse from a story object row and pre-fetched data. */
function buildStoryResponse(
  s: {
    apId: string;
    attributedTo: string;
    attachmentsJson: string;
    endTime: string | null;
    published: string;
    likeCount: number;
    shareCount: number | null;
    viewedByUser?: boolean;
    likedByUser?: boolean;
  },
  author: StoryAuthor,
  allVotes: Record<string, VoteResults>,
  userVotes: Record<string, number>,
): StoryResponse {
  const storyData = transformStoryData(s.attachmentsJson);
  const storyVotesData = allVotes[s.apId] || {};

  return {
    ap_id: s.apId,
    author,
    attachment: storyData.attachment,
    displayDuration: storyData.displayDuration,
    overlays: storyData.overlays,
    end_time: s.endTime || "",
    published: s.published,
    viewed: s.viewedByUser ?? false,
    like_count: s.likeCount,
    share_count: s.shareCount || 0,
    liked: s.likedByUser ?? false,
    votes: storyVotesData,
    votes_total: sumVotes(storyVotesData),
    user_vote: userVotes[s.apId],
  };
}

/** Resolve remote author info for stories missing a joined author relation. */
async function resolveRemoteAuthors(
  db: Database,
  storiesData: Array<{ author?: unknown; attributedTo: string }>,
): Promise<
  Record<
    string,
    {
      preferredUsername: string | null;
      name: string | null;
      iconUrl: string | null;
    }
  >
> {
  const remoteIds = [
    ...new Set(storiesData.filter((s) => !s.author).map((s) => s.attributedTo)),
  ];
  return fetchActorCache(db, remoteIds);
}

/** Create an outbound activity record and enqueue fanout to followers. */
async function createAndFanoutActivity(
  db: Database,
  env: Env,
  actorApIdStr: string,
  objectApIdStr: string,
  activity: Record<string, unknown>,
): Promise<void> {
  const id = activity.id as string;
  await db.insert(activities).values({
    apId: id,
    type: activity.type as string,
    actorApId: actorApIdStr,
    objectApId: objectApIdStr,
    rawJson: JSON.stringify(activity),
    direction: "outbound",
  });
  await enqueueFanoutToFollowers(env, id, actorApIdStr);
}

/** Delete all related data for a story, then the story object itself. */
async function deleteStoryAndRelatedData(
  db: Database,
  apId: string,
): Promise<void> {
  await Promise.all([
    db.delete(storyVotes).where(eq(storyVotes.storyApId, apId)),
    db.delete(likes).where(eq(likes.objectApId, apId)),
    db.delete(storyViews).where(eq(storyViews.storyApId, apId)),
    db.delete(storyShares).where(eq(storyShares.storyApId, apId)),
  ]);
  await db.delete(objects).where(eq(objects.apId, apId));
}

// Get active stories from followed users and self (grouped by author)
stories.get("/", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  const db = c.get("db");
  const now = new Date().toISOString();

  // Opportunistic, best-effort expiry cleanup (see maybeCleanupExpiredStories).
  maybeCleanupExpiredStories(db);

  // Get followed user IDs
  const followRows = await db.select({ followingApId: follows.followingApId })
    .from(follows)
    .where(
      and(
        eq(follows.followerApId, actor.ap_id),
        eq(follows.status, "accepted"),
      ),
    );
  const followedIds = followRows.map((f) => f.followingApId);
  followedIds.push(actor.ap_id); // Include self

  const { blockedIds, mutedIds } = await fetchBlockedAndMutedIds(
    db,
    actor.ap_id,
  );
  const excludeIds = [...blockedIds, ...mutedIds];

  // Get stories from followed users (excluding blocked/muted)
  let storiesWhere = and(
    eq(objects.type, "Story"),
    gt(objects.endTime, now),
    inArray(objects.attributedTo, followedIds),
  );

  if (excludeIds.length > 0) {
    storiesWhere = and(
      storiesWhere,
      notInArray(objects.attributedTo, excludeIds),
    );
  }

  const storiesData = await db.select()
    .from(objects)
    .where(storiesWhere!)
    .orderBy(desc(objects.endTime));

  // Batch fetch views and likes for the current user
  const storyApIds = storiesData.map((s) => s.apId);

  const [viewedRows, likedRows] = await Promise.all([
    storyApIds.length > 0
      ? db.select({ storyApId: storyViews.storyApId })
        .from(storyViews)
        .where(
          and(
            eq(storyViews.actorApId, actor.ap_id),
            inArray(storyViews.storyApId, storyApIds),
          ),
        )
      : [],
    storyApIds.length > 0
      ? db.select({ objectApId: likes.objectApId })
        .from(likes)
        .where(
          and(
            eq(likes.actorApId, actor.ap_id),
            inArray(likes.objectApId, storyApIds),
          ),
        )
      : [],
  ]);

  const viewedSet = new Set(viewedRows.map((v) => v.storyApId));
  const likedSet = new Set(likedRows.map((l) => l.objectApId));

  // Batch fetch author info
  const authorApIds = [...new Set(storiesData.map((s) => s.attributedTo))];
  const [localAuthors, remoteAuthorCache] = await Promise.all([
    authorApIds.length > 0
      ? db.select({
        apId: actors.apId,
        preferredUsername: actors.preferredUsername,
        name: actors.name,
        iconUrl: actors.iconUrl,
      }).from(actors).where(inArray(actors.apId, authorApIds))
      : [],
    Promise.resolve().then(async () => {
      // We'll resolve after we know which are remote
      return {} as Record<
        string,
        {
          preferredUsername: string | null;
          name: string | null;
          iconUrl: string | null;
        }
      >;
    }),
  ]);

  const authorMap = new Map(localAuthors.map((a) => [a.apId, a]));
  const missingAuthorIds = authorApIds.filter((id) => !authorMap.has(id));
  const actorCacheMap = await fetchActorCache(db, missingAuthorIds);

  const [{ allVotes, userVotes }] = await Promise.all([
    fetchBatchVotes(db, storyApIds, actor.ap_id),
  ]);

  // Group by author
  const grouped: Record<
    string,
    { actor: StoryAuthor; stories: StoryResponse[]; has_unviewed: boolean }
  > = {};
  const authorOrder: string[] = [];

  for (const s of storiesData) {
    const authorApId = s.attributedTo;
    const authorData = authorMap.get(authorApId) || actorCacheMap[authorApId];
    const authorInfo = buildAuthor(authorApId, authorData);

    if (!grouped[authorApId]) {
      grouped[authorApId] = {
        actor: authorInfo,
        stories: [],
        has_unviewed: false,
      };
      if (authorApId === actor.ap_id) {
        authorOrder.unshift(authorApId);
      } else {
        authorOrder.push(authorApId);
      }
    }

    const response = buildStoryResponse(
      {
        ...s,
        viewedByUser: viewedSet.has(s.apId),
        likedByUser: likedSet.has(s.apId),
      },
      authorInfo,
      allVotes,
      userVotes,
    );
    if (!response.viewed) grouped[authorApId].has_unviewed = true;
    grouped[authorApId].stories.push(response);
  }

  // Sort stories within each group: unviewed first, then by end_time desc
  for (const group of Object.values(grouped)) {
    group.stories.sort((a, b) => {
      if (!a.viewed && b.viewed) return -1;
      if (a.viewed && !b.viewed) return 1;
      return b.end_time.localeCompare(a.end_time);
    });
  }

  // Sort author groups: self first, then those with unviewed stories
  authorOrder.sort((a, b) => {
    if (a === actor.ap_id) return -1;
    if (b === actor.ap_id) return 1;
    if (grouped[a].has_unviewed && !grouped[b].has_unviewed) return -1;
    if (!grouped[a].has_unviewed && grouped[b].has_unviewed) return 1;
    return 0;
  });

  return c.json({ actor_stories: authorOrder.map((apId) => grouped[apId]) });
});

// Get stories for a specific user
stories.get("/:actorId", async (c) => {
  const targetActorId = c.req.param("actorId");
  const actor = c.get("actor");
  const db = c.get("db");
  const baseUrl = c.env.APP_URL;
  const now = new Date().toISOString();

  // Find the actor by username or full ap_id
  const targetApId = targetActorId.startsWith("http")
    ? targetActorId
    : actorApId(baseUrl, targetActorId);

  // Check blocked/muted (if authenticated)
  if (actor) {
    const { blockedIds, mutedIds } = await fetchBlockedAndMutedIds(
      db,
      actor.ap_id,
    );
    if (blockedIds.includes(targetApId) || mutedIds.includes(targetApId)) {
      return c.json({ stories: [] });
    }
  }

  // Get stories for the target user
  const userStories = await db.select()
    .from(objects)
    .where(
      and(
        eq(objects.type, "Story"),
        eq(objects.attributedTo, targetApId),
        gt(objects.endTime, now),
      ),
    )
    .orderBy(desc(objects.published));

  const storyApIds = userStories.map((s) => s.apId);

  // Batch fetch views and likes for current user
  const [viewedRows, likedRows] = await Promise.all([
    actor && storyApIds.length > 0
      ? db.select({ storyApId: storyViews.storyApId })
        .from(storyViews)
        .where(
          and(
            eq(storyViews.actorApId, actor.ap_id),
            inArray(storyViews.storyApId, storyApIds),
          ),
        )
      : [],
    actor && storyApIds.length > 0
      ? db.select({ objectApId: likes.objectApId })
        .from(likes)
        .where(
          and(
            eq(likes.actorApId, actor.ap_id),
            inArray(likes.objectApId, storyApIds),
          ),
        )
      : [],
  ]);

  const viewedSet = new Set((viewedRows || []).map((v) => v.storyApId));
  const likedSet = new Set((likedRows || []).map((l) => l.objectApId));

  // Batch fetch author info
  const authorApIds = [...new Set(userStories.map((s) => s.attributedTo))];
  const localAuthors = authorApIds.length > 0
    ? await db.select({
      apId: actors.apId,
      preferredUsername: actors.preferredUsername,
      name: actors.name,
      iconUrl: actors.iconUrl,
    }).from(actors).where(inArray(actors.apId, authorApIds))
    : [];

  const authorLocalMap = new Map(localAuthors.map((a) => [a.apId, a]));
  const missingIds = authorApIds.filter((id) => !authorLocalMap.has(id));
  const actorCacheMap = await fetchActorCache(db, missingIds);

  const [{ allVotes, userVotes }] = await Promise.all([
    fetchBatchVotes(db, storyApIds, actor?.ap_id),
  ]);

  const result = userStories.map((s) => {
    const authorData = authorLocalMap.get(s.attributedTo) ||
      actorCacheMap[s.attributedTo];
    const author = buildAuthor(s.attributedTo, authorData);

    return buildStoryResponse(
      {
        ...s,
        viewedByUser: viewedSet.has(s.apId),
        likedByUser: likedSet.has(s.apId),
      },
      author,
      allVotes,
      userVotes,
    );
  });

  return c.json({ stories: result });
});

// Create story (v2: single attachment format)
stories.post("/", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  const db = c.get("db");
  const body = await c.req.json<StoryCreateBody>();

  if (!body.attachment || !body.attachment.r2_key) {
    return c.json({ error: "attachment with r2_key required" }, 400);
  }

  if (body.overlays && body.overlays.length > 0) {
    const validation = validateOverlays(body.overlays);
    if (!validation.valid) {
      return c.json({ error: validation.error }, 400);
    }
  }

  const baseUrl = c.env.APP_URL;
  const apId = objectApId(baseUrl, generateId());
  const now = new Date().toISOString();
  const endTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const storyData = {
    attachment: {
      ...body.attachment,
      width: body.attachment.width || 1080,
      height: body.attachment.height || 1920,
    },
    displayDuration: body.displayDuration || "PT5S",
    overlays: body.overlays || undefined,
  };
  const attachmentsJson = JSON.stringify(storyData);

  await db.insert(objects).values({
    apId,
    type: "Story",
    attributedTo: actor.ap_id,
    content: "",
    attachmentsJson,
    endTime,
    published: now,
    isLocal: 1,
  });

  await db.update(actors)
    .set({ postCount: sql`${actors.postCount} + 1` })
    .where(eq(actors.apId, actor.ap_id));

  const responseData = transformStoryData(attachmentsJson);
  const authorInfo = buildAuthor(actor.ap_id, {
    preferredUsername: actor.preferred_username,
    name: actor.name,
    iconUrl: actor.icon_url,
  });

  const story = {
    ap_id: apId,
    author: authorInfo,
    attachment: responseData.attachment,
    displayDuration: responseData.displayDuration,
    overlays: responseData.overlays,
    end_time: endTime,
    published: now,
    viewed: false,
    like_count: 0,
    liked: false,
  };

  // Send Create(Story) activity to followers
  const storyObject = storyToActivityPub(
    {
      apId,
      attributedTo: actor.ap_id,
      attachment: responseData.attachment,
      displayDuration: responseData.displayDuration,
      overlays: responseData.overlays,
      endTime,
      published: now,
    },
    actor,
    baseUrl,
  );
  await createAndFanoutActivity(db, c.env, actor.ap_id, apId, {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: activityApId(baseUrl, generateId()),
    type: "Create",
    actor: actor.ap_id,
    published: now,
    to: [`${actor.ap_id}/followers`],
    object: storyObject,
  });

  return c.json({ story }, 201);
});

// Delete story
stories.post("/delete", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  const db = c.get("db");
  const body = await c.req.json<{ ap_id: string }>();
  if (!body.ap_id) return c.json({ error: "ap_id required" }, 400);
  const apId = body.ap_id;

  // Verify ownership
  const story = await db.select().from(objects).where(eq(objects.apId, apId))
    .get();
  if (!story) return c.json({ error: "Story not found" }, 404);
  if (story.attributedTo !== actor.ap_id) {
    return c.json({ error: "Forbidden" }, 403);
  }

  // Enqueue Delete(Story) activity to followers before deleting.
  // Outbound delivery MUST NOT run in request path; enqueue is the sync boundary.
  const baseUrl = c.env.APP_URL;
  await createAndFanoutActivity(db, c.env, actor.ap_id, apId, {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: activityApId(baseUrl, generateId()),
    type: "Delete",
    actor: actor.ap_id,
    to: ["https://www.w3.org/ns/activitystreams#Public"],
    object: apId,
  });

  await deleteStoryAndRelatedData(db, apId);

  await db.update(actors)
    .set({ postCount: sql`${actors.postCount} - 1` })
    .where(eq(actors.apId, actor.ap_id));

  return c.json({ success: true });
});

export default stories;
