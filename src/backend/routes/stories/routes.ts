// Story routes for Yurucommu backend
// v2: 1 Story = 1 Media (Instagram style)
import { Hono } from "hono";
import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import type { D1Statement, Database } from "../../../db/index.ts";
import {
  activities,
  actors,
  communityMembers,
  follows,
  likes,
  objects,
  runBatch,
  storyViews,
} from "../../../db/index.ts";
import {
  deleteObjectCascade,
  purgeMediaBlobs,
} from "../posts/delete-cascade.ts";
import type { Env, Variables } from "../../types.ts";
import type { IObjectStorage } from "../../runtime/types.ts";
import {
  activityApId,
  actorApId,
  generateId,
  objectApId,
} from "../../federation-helpers.ts";
import { storyToActivityPub } from "../../lib/activitypub-helpers.ts";
import { excludeModeratedActors } from "../../lib/feed-exclude.ts";
import { maybeReapDrainedTombstones } from "../actors.ts";
import { checkCommunityPostPermission } from "../posts/post-helpers.ts";
import { rateLimit, RateLimitConfigs } from "../../middleware/rate-limit.ts";
import {
  buildAuthor,
  cleanupExpiredStories,
  fetchActorCache,
  fetchBatchVotes,
  type StoryAuthor,
  sumVotes,
  transformStoryData,
  validateOverlays,
} from "./query-helpers.ts";
import {
  enqueueFanoutToCommunity,
  enqueueFanoutToFollowers,
} from "../../lib/delivery/queue.ts";
import { logger } from "../../lib/logger.ts";
import { personalActorIsSuppressedBy } from "../../lib/personal-actor-moderation.ts";
import { prepareDeliveryFanoutJob } from "../../lib/delivery/fanout-outbox.ts";

const log = logger.child({ component: "stories.routes" });

const stories = new Hono<{ Bindings: Env; Variables: Variables }>();

// Best-effort, opportunistic retention of expired stories.
//
// The public Worker also exposes a scheduled retention handler. Keep this
// probabilistic read-path pass as a self-hosting fallback for runtimes that do
// not configure a cron trigger. Expired stories are already excluded from every
// read query, so a missed sweep affects storage only. The guard below ensures
// at most one fallback pass runs at a time per isolate.
let expiredStoryCleanupInFlight = false;

function maybeCleanupExpiredStories(
  db: Database,
  media?: IObjectStorage,
): void {
  if (expiredStoryCleanupInFlight) return;
  if (Math.random() >= 0.01) return; // ~1% of feed requests per isolate

  expiredStoryCleanupInFlight = true;
  // Pass the MEDIA binding so expired-story cleanup also purges the R2 blobs,
  // not just the media_uploads DB rows (otherwise expired-story media leaks).
  cleanupExpiredStories(db, media)
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

type StoryResponse = {
  ap_id: string;
  author: StoryAuthor;
  attachment: ReturnType<typeof transformStoryData>["attachment"];
  caption?: string;
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
  // Optional caption/text shown over the story.
  caption?: string;
  overlays?: unknown[];
  // Optional community scope. When set, the story is scoped to this community
  // (members-only visibility) instead of the author's personal story feed.
  community_ap_id?: string;
};

// Caption is user-authored free text; cap it so a malformed/huge body can't
// bloat the stored attachments JSON.
const MAX_STORY_CAPTION_LENGTH = 500;
// Hard ceiling on a story-feed query. Stories are a non-paginated "bar", and
// inbound Create(Story) has no per-author cap, so a hostile followed host could
// accumulate tens of thousands of live (24h) Story rows and make this
// authenticated read path (hit on every app open) load an unbounded set into
// Worker memory. Bound it like every other feed query.
//
// Capped at 90 (not 500): the returned story ids are re-queried via
// `inArray(storyApIds)` for view/like/author enrichment, and Cloudflare D1
// allows at most 100 bound parameters per query — a 500-item feed would throw
// "too many SQL variables" on production D1 (libsql, which the tests run on,
// allows ~32k and hides this). 90 active stories is ample for a single-user
// feed page; a busy instance simply shows the 90 most recent.
const MAX_STORY_FEED_ITEMS = 90;

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
    caption: storyData.caption,
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

/** Create an outbound activity record and enqueue fanout to followers. */
async function createAndFanoutActivity(
  db: Database,
  env: Env,
  actorApIdStr: string,
  objectApIdStr: string,
  activity: Record<string, unknown>,
  communityApId: string | null | undefined,
  localStatements: readonly [D1Statement, ...D1Statement[]],
): Promise<void> {
  const id = activity.id as string;
  const preparedFanout = await prepareDeliveryFanoutJob(
    db,
    communityApId
      ? {
          kind: "community",
          activityId: id,
          targetApId: communityApId,
        }
      : {
          kind: "followers",
          activityId: id,
          targetApId: actorApIdStr,
        },
  );
  await runBatch(db, [
    ...localStatements,
    db.insert(activities).values({
      apId: id,
      type: activity.type as string,
      actorApId: actorApIdStr,
      objectApId: objectApIdStr,
      rawJson: JSON.stringify(activity),
      direction: "outbound",
    }) as D1Statement,
    preparedFanout.statement,
  ]);
  await publishDurableStoryFanoutWakeup(env, id, actorApIdStr, communityApId);
}

async function publishDurableStoryFanoutWakeup(
  env: Env,
  activityId: string,
  actorApId: string,
  communityApId?: string | null,
): Promise<void> {
  // A community-scoped story has reach == community: fan its activity out to the
  // community's members/followers (the same audience posts use), NOT the
  // author's personal follower graph. A personal story keeps author-follower
  // reach.
  try {
    if (communityApId) {
      await enqueueFanoutToCommunity(env, activityId, communityApId);
    } else {
      await enqueueFanoutToFollowers(env, activityId, actorApId);
    }
  } catch (error) {
    // Activity and semantic fanout intent were committed atomically above. The
    // Queue RPC is only a wakeup; keep the route moving so Create returns the
    // committed story and Delete completes its local cascade while scheduled
    // recovery republishes the pending row.
    log.error("Failed to publish durable story fanout wakeup", {
      event: "stories.fanout_wakeup_failed",
      activityId,
      actor: actorApId,
      communityApId: communityApId ?? null,
      error,
    });
  }
}

/**
 * Resolve the scope of a stories read request.
 *
 * - No `community` query param -> personal scope (self + followed, and any
 *   community-scoped story is excluded so it never leaks into the personal feed).
 * - `community=<apId>` -> community scope; the viewer must be an accepted member
 *   of that community, otherwise the scope resolves to "denied" and no stories
 *   are returned.
 */
async function resolveStoryScope(
  db: Database,
  viewerApId: string,
  communityParam: string | undefined,
): Promise<
  | { kind: "personal" }
  | { kind: "community"; communityApId: string }
  | { kind: "denied" }
> {
  if (!communityParam) return { kind: "personal" };

  const member = await db
    .select({ actorApId: communityMembers.actorApId })
    .from(communityMembers)
    .where(
      and(
        eq(communityMembers.communityApId, communityParam),
        eq(communityMembers.actorApId, viewerApId),
      ),
    )
    .get();

  if (!member) return { kind: "denied" };
  return { kind: "community", communityApId: communityParam };
}

// Get active stories from followed users and self (grouped by author)
stories.get("/", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  const db = c.get("db");
  const now = new Date().toISOString();

  // Resolve the requested scope. `?community=<apId>` switches to community scope
  // (members only); absence keeps the personal self+followed feed.
  const communityParam = c.req.query("community") || undefined;
  const scope = await resolveStoryScope(db, actor.ap_id, communityParam);
  if (scope.kind === "denied") {
    return c.json({ actor_stories: [] });
  }

  // Opportunistic, best-effort expiry cleanup (see maybeCleanupExpiredStories).
  maybeCleanupExpiredStories(db, c.env.MEDIA);
  // Opportunistically reap drained account tombstones on this hot read path
  // (the Worker has no scheduled handler; see maybeReapDrainedTombstones).
  maybeReapDrainedTombstones(db);

  // Personal scope shows self + accepted-follows. Express the follow set as a
  // subquery (`attributed_to IN (SELECT ...)`) so the feed stays lossless for
  // any follow count without splicing every followed id into the query as a
  // bound parameter — Cloudflare D1 caps a query at 100, so the old
  // `inArray(followedIds)` 500'd the story feed for anyone following >~100
  // accounts (libsql, which the tests run on, allows ~32k and hid this).
  const followingSubquery = db
    .select({ id: follows.followingApId })
    .from(follows)
    .where(
      and(
        eq(follows.followerApId, actor.ap_id),
        eq(follows.status, "accepted"),
      ),
    );

  // Scope filter:
  //  - community scope: stories whose communityApId = the target community.
  //    Author membership in the personal follow graph is irrelevant here; the
  //    viewer's accepted membership (verified above) is what grants visibility.
  //  - personal scope: self + followed authors, and NO community-scoped story
  //    (communityApId IS NULL) so community stories never leak into the feed.
  let storiesWhere =
    scope.kind === "community"
      ? and(
          eq(objects.type, "Story"),
          gt(objects.endTime, now),
          eq(objects.communityApId, scope.communityApId),
        )
      : and(
          eq(objects.type, "Story"),
          gt(objects.endTime, now),
          isNull(objects.communityApId),
          or(
            eq(objects.attributedTo, actor.ap_id),
            inArray(objects.attributedTo, followingSubquery),
          ),
        );

  const excludeAuthors = excludeModeratedActors(actor.ap_id);
  if (excludeAuthors) {
    storiesWhere = and(storiesWhere, excludeAuthors);
  }

  const storiesData = await db
    .select()
    .from(objects)
    .where(storiesWhere!)
    .orderBy(desc(objects.endTime))
    .limit(MAX_STORY_FEED_ITEMS);

  // Batch fetch views and likes for the current user
  const storyApIds = storiesData.map((s) => s.apId);

  const [viewedRows, likedRows] = await Promise.all([
    storyApIds.length > 0
      ? db
          .select({ storyApId: storyViews.storyApId })
          .from(storyViews)
          .where(
            and(
              eq(storyViews.actorApId, actor.ap_id),
              inArray(storyViews.storyApId, storyApIds),
            ),
          )
      : [],
    storyApIds.length > 0
      ? db
          .select({ objectApId: likes.objectApId })
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
  const localAuthors =
    authorApIds.length > 0
      ? await db
          .select({
            apId: actors.apId,
            preferredUsername: actors.preferredUsername,
            name: actors.name,
            iconUrl: actors.iconUrl,
          })
          .from(actors)
          .where(inArray(actors.apId, authorApIds))
      : [];

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

  // Resolve scope. Community scope requires an authenticated, accepted member.
  const communityParam = c.req.query("community") || undefined;
  if (communityParam) {
    if (!actor) return c.json({ stories: [] });
    const scope = await resolveStoryScope(db, actor.ap_id, communityParam);
    if (scope.kind === "denied") return c.json({ stories: [] });
  }

  // Check blocked/muted (if authenticated)
  if (
    actor &&
    (await personalActorIsSuppressedBy(db, actor.ap_id, targetApId))
  ) {
    return c.json({ stories: [] });
  }

  // Personal stories are follower-scoped: the home feed (`GET /`) only surfaces
  // self + accepted-follows, and the federated Create addresses them to the
  // author's /followers — so a personal-scope read of another actor's stories is
  // gated to the target or an accepted follower (and never anonymous). Community
  // scope is already gated above by `resolveStoryScope`.
  if (!communityParam) {
    if (!actor) return c.json({ stories: [] });
    if (actor.ap_id !== targetApId) {
      const follow = await db
        .select({ followerApId: follows.followerApId })
        .from(follows)
        .where(
          and(
            eq(follows.followerApId, actor.ap_id),
            eq(follows.followingApId, targetApId),
            eq(follows.status, "accepted"),
          ),
        )
        .get();
      if (!follow) return c.json({ stories: [] });
    }
  }

  // Get stories for the target user, filtered by scope:
  //  - community scope: only that community's stories,
  //  - personal scope: only NON-community (personal) stories.
  const scopeCondition = communityParam
    ? eq(objects.communityApId, communityParam)
    : isNull(objects.communityApId);

  const userStories = await db
    .select()
    .from(objects)
    .where(
      and(
        eq(objects.type, "Story"),
        eq(objects.attributedTo, targetApId),
        gt(objects.endTime, now),
        scopeCondition,
        excludeModeratedActors(actor?.ap_id ?? ""),
      ),
    )
    .orderBy(desc(objects.published))
    .limit(MAX_STORY_FEED_ITEMS);

  const storyApIds = userStories.map((s) => s.apId);

  // Batch fetch views and likes for current user
  const [viewedRows, likedRows] = await Promise.all([
    actor && storyApIds.length > 0
      ? db
          .select({ storyApId: storyViews.storyApId })
          .from(storyViews)
          .where(
            and(
              eq(storyViews.actorApId, actor.ap_id),
              inArray(storyViews.storyApId, storyApIds),
            ),
          )
      : [],
    actor && storyApIds.length > 0
      ? db
          .select({ objectApId: likes.objectApId })
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
  const localAuthors =
    authorApIds.length > 0
      ? await db
          .select({
            apId: actors.apId,
            preferredUsername: actors.preferredUsername,
            name: actors.name,
            iconUrl: actors.iconUrl,
          })
          .from(actors)
          .where(inArray(actors.apId, authorApIds))
      : [];

  const authorLocalMap = new Map(localAuthors.map((a) => [a.apId, a]));
  const missingIds = authorApIds.filter((id) => !authorLocalMap.has(id));
  const actorCacheMap = await fetchActorCache(db, missingIds);

  const [{ allVotes, userVotes }] = await Promise.all([
    fetchBatchVotes(db, storyApIds, actor?.ap_id),
  ]);

  const result = userStories.map((s) => {
    const authorData =
      authorLocalMap.get(s.attributedTo) || actorCacheMap[s.attributedTo];
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

  // Normalize the optional caption: trim, drop when empty, and reject overlong
  // input rather than silently truncating.
  let caption: string | undefined;
  if (typeof body.caption === "string") {
    const trimmed = body.caption.trim();
    if (trimmed.length > MAX_STORY_CAPTION_LENGTH) {
      return c.json(
        {
          error: `caption must be at most ${MAX_STORY_CAPTION_LENGTH} characters`,
        },
        400,
      );
    }
    if (trimmed.length > 0) caption = trimmed;
  }

  // Optional community scope. Reuse the same post-permission policy as posts so
  // story scope and post scope stay consistent (membership + postPolicy). A
  // personal story leaves communityApId NULL.
  const communityCheck = await checkCommunityPostPermission(
    db,
    actor.ap_id,
    body.community_ap_id,
  );
  if (!communityCheck.allowed) {
    return c.json({ error: communityCheck.error }, communityCheck.status);
  }
  const communityApIdValue = communityCheck.communityId;
  const communityFollowersUrl = communityCheck.community?.followersUrl ?? null;

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
    caption,
    overlays: body.overlays || undefined,
  };
  const attachmentsJson = JSON.stringify(storyData);

  const storyInsert = db.insert(objects).values({
    apId,
    type: "Story",
    attributedTo: actor.ap_id,
    content: "",
    attachmentsJson,
    communityApId: communityApIdValue,
    endTime,
    published: now,
    isLocal: 1,
  }) as D1Statement;

  const postCountBump = db
    .update(actors)
    .set({ postCount: sql`${actors.postCount} + 1` })
    .where(eq(actors.apId, actor.ap_id)) as D1Statement;

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
    caption: responseData.caption,
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
      caption: responseData.caption,
      overlays: responseData.overlays,
      endTime,
      published: now,
    },
    actor,
    baseUrl,
  );
  // Address a community-scoped story to the community's followers collection;
  // a personal story stays addressed to the author's own followers.
  const storyTo =
    communityApIdValue && communityFollowersUrl
      ? [communityFollowersUrl]
      : [`${actor.ap_id}/followers`];
  await createAndFanoutActivity(
    db,
    c.env,
    actor.ap_id,
    apId,
    {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: activityApId(baseUrl, generateId()),
      type: "Create",
      actor: actor.ap_id,
      published: now,
      to: storyTo,
      object: storyObject,
    },
    communityApIdValue,
    [storyInsert, postCountBump],
  );

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
  const story = await db
    .select()
    .from(objects)
    .where(eq(objects.apId, apId))
    .get();
  if (!story) return c.json({ error: "Story not found" }, 404);
  if (story.attributedTo !== actor.ap_id) {
    return c.json({ error: "Forbidden" }, 403);
  }

  // A community-scoped story tombstone is addressed to and fanned out to the
  // community (reach == community), mirroring its Create; a personal story
  // keeps author-follower reach.
  const baseUrl = c.env.APP_URL;
  const deleteTo = story.communityApId
    ? [`${story.communityApId}/followers`]
    : ["https://www.w3.org/ns/activitystreams#Public"];
  const deleteActivity = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: activityApId(baseUrl, generateId()),
    type: "Delete",
    actor: actor.ap_id,
    to: deleteTo,
    object: apId,
  };
  const preparedFanout = await prepareDeliveryFanoutJob(
    db,
    story.communityApId
      ? {
          kind: "community",
          activityId: deleteActivity.id,
          targetApId: story.communityApId,
        }
      : {
          kind: "followers",
          activityId: deleteActivity.id,
          targetApId: actor.ap_id,
        },
  );

  // Reap every projection of the OLD Create/Update activities while the story
  // row still exists. The outbound Delete is deliberately inserted only in the
  // final batch below; inserting it first made this cascade erase its own
  // pending fanout before a Queue consumer could resolve the Activity.
  const mediaKeys = await deleteObjectCascade(db, apId, c.env.MEDIA);
  const storyExists = sql`EXISTS (SELECT 1 FROM ${objects} WHERE ${objects.apId} = ${apId})`;
  await runBatch(db, [
    db
      .update(actors)
      .set({ postCount: sql`${actors.postCount} - 1` })
      .where(
        and(eq(actors.apId, actor.ap_id), gt(actors.postCount, 0), storyExists),
      ) as D1Statement,
    db.delete(objects).where(eq(objects.apId, apId)) as D1Statement,
    db.insert(activities).values({
      apId: deleteActivity.id,
      type: deleteActivity.type,
      actorApId: actor.ap_id,
      objectApId: apId,
      rawJson: JSON.stringify(deleteActivity),
      direction: "outbound",
    }) as D1Statement,
    preparedFanout.statement,
  ]);

  // Irreversible R2 purge only after the story row is gone and its durable
  // federation intent exists.
  await purgeMediaBlobs(c.env.MEDIA, mediaKeys);
  await publishDurableStoryFanoutWakeup(
    c.env,
    deleteActivity.id,
    actor.ap_id,
    story.communityApId,
  );

  return c.json({ success: true });
});

export default stories;
