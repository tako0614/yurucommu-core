// Timeline routes for Yurucommu backend
import { Hono } from "hono";
import type { Context } from "hono";
import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  ne,
  notInArray,
  or,
} from "drizzle-orm";
import type { Database } from "../../db/index.ts";
import {
  actorCache,
  actors,
  announces,
  blocks,
  bookmarks,
  communities,
  communityMembers,
  follows,
  likes,
  mutes,
  objects,
} from "../../db/index.ts";
import type { Env, Variables } from "../types.ts";
import {
  formatUsername,
  parseLimit,
  parseOffset,
  safeJsonParse,
} from "../federation-helpers.ts";
import { CacheTags, CacheTTL, withCache } from "../middleware/cache.ts";

const timeline = new Hono<{ Bindings: Env; Variables: Variables }>();
const MAX_BLOCK_MUTE_FILTER_ENTRIES = 1000;

// Explicit column projection for timeline feeds. Selecting `*` pulls the large
// `raw_json` blob (plus other unused columns like to_json/cc_json/audience_json/
// conversation/end_time) on every row only for `formatPost` to discard them.
// This list is exactly the set of fields `formatPost` reads — keep them in sync.
const POST_FEED_COLUMNS = {
  apId: objects.apId,
  type: objects.type,
  attributedTo: objects.attributedTo,
  content: objects.content,
  summary: objects.summary,
  attachmentsJson: objects.attachmentsJson,
  inReplyTo: objects.inReplyTo,
  visibility: objects.visibility,
  communityApId: objects.communityApId,
  likeCount: objects.likeCount,
  replyCount: objects.replyCount,
  announceCount: objects.announceCount,
  published: objects.published,
} as const;

type Attachment = {
  type?: string;
  mediaType?: string;
  url?: string;
  [key: string]: unknown;
};

type AuthorInfo = {
  preferredUsername: string | null;
  name: string | null;
  iconUrl: string | null;
};
const NULL_AUTHOR: AuthorInfo = {
  preferredUsername: null,
  name: null,
  iconUrl: null,
};

// Batch helper to get author info from either local actors or actor cache
// This avoids N+1 queries by fetching all authors at once
async function batchGetAuthorInfo(
  db: Database,
  apIds: string[],
): Promise<Map<string, AuthorInfo>> {
  if (apIds.length === 0) return new Map();

  const uniqueApIds = [...new Set(apIds)];

  const [localActors, cachedActors] = await Promise.all([
    db
      .select({
        apId: actors.apId,
        preferredUsername: actors.preferredUsername,
        name: actors.name,
        iconUrl: actors.iconUrl,
      })
      .from(actors)
      .where(inArray(actors.apId, uniqueApIds)),
    db
      .select({
        apId: actorCache.apId,
        preferredUsername: actorCache.preferredUsername,
        name: actorCache.name,
        iconUrl: actorCache.iconUrl,
      })
      .from(actorCache)
      .where(inArray(actorCache.apId, uniqueApIds)),
  ]);

  const result = new Map<string, AuthorInfo>();

  // Cached actors first; local actors override
  for (const a of cachedActors) {
    result.set(a.apId, {
      preferredUsername: a.preferredUsername,
      name: a.name,
      iconUrl: a.iconUrl,
    });
  }
  for (const a of localActors) {
    result.set(a.apId, {
      preferredUsername: a.preferredUsername,
      name: a.name,
      iconUrl: a.iconUrl,
    });
  }

  return result;
}

// Batch helper to check interaction status for multiple objects
// This avoids N+1 queries by fetching all interactions at once
async function batchGetInteractionStatus(
  db: Database,
  viewerApId: string,
  objectApIds: string[],
): Promise<{
  likedSet: Set<string>;
  bookmarkedSet: Set<string>;
  repostedSet: Set<string>;
}> {
  if (!viewerApId || objectApIds.length === 0) {
    return {
      likedSet: new Set(),
      bookmarkedSet: new Set(),
      repostedSet: new Set(),
    };
  }

  const [likeRows, bookmarkRows, announceRows] = await Promise.all([
    db
      .select({ objectApId: likes.objectApId })
      .from(likes)
      .where(
        and(
          eq(likes.actorApId, viewerApId),
          inArray(likes.objectApId, objectApIds),
        ),
      ),
    db
      .select({ objectApId: bookmarks.objectApId })
      .from(bookmarks)
      .where(
        and(
          eq(bookmarks.actorApId, viewerApId),
          inArray(bookmarks.objectApId, objectApIds),
        ),
      ),
    db
      .select({ objectApId: announces.objectApId })
      .from(announces)
      .where(
        and(
          eq(announces.actorApId, viewerApId),
          inArray(announces.objectApId, objectApIds),
        ),
      ),
  ]);

  return {
    likedSet: new Set(likeRows.map((l) => l.objectApId)),
    bookmarkedSet: new Set(bookmarkRows.map((b) => b.objectApId)),
    repostedSet: new Set(announceRows.map((a) => a.objectApId)),
  };
}

// Helper to get blocked and muted users
async function getBlockedAndMutedUsers(
  db: Database,
  viewerApId: string,
): Promise<{ blockedApIds: string[]; mutedApIds: string[] }> {
  if (!viewerApId) {
    return { blockedApIds: [], mutedApIds: [] };
  }

  const [blockRows, muteRows] = await Promise.all([
    db
      .select({ blockedApId: blocks.blockedApId })
      .from(blocks)
      .where(eq(blocks.blockerApId, viewerApId))
      .limit(MAX_BLOCK_MUTE_FILTER_ENTRIES),
    db
      .select({ mutedApId: mutes.mutedApId })
      .from(mutes)
      .where(eq(mutes.muterApId, viewerApId))
      .limit(MAX_BLOCK_MUTE_FILTER_ENTRIES),
  ]);

  return {
    blockedApIds: blockRows.map((b) => b.blockedApId),
    mutedApIds: muteRows.map((m) => m.mutedApId),
  };
}

// Merge blocked + muted AP IDs into a single deduplicated exclusion list
function buildExcludedApIds(
  blockedApIds: string[],
  mutedApIds: string[],
): string[] {
  return Array.from(new Set([...blockedApIds, ...mutedApIds]));
}

// Paginate a fetched-with-extra-1 result set and determine has_more
function paginateResults<T>(
  rows: T[],
  limit: number,
): { results: T[]; has_more: boolean } {
  const has_more = rows.length > limit;
  return { results: has_more ? rows.slice(0, limit) : rows, has_more };
}

// Format a post row and its resolved author/interaction data into the API response shape
function formatPost(
  p: {
    apId: string;
    type: string;
    attributedTo: string;
    content: string;
    summary: string | null;
    attachmentsJson: string | null;
    inReplyTo: string | null;
    visibility: string;
    communityApId: string | null;
    likeCount: number;
    replyCount: number;
    announceCount: number;
    published: string | null;
  },
  authorMap: Map<string, AuthorInfo>,
  interactions: {
    likedSet: Set<string>;
    bookmarkedSet: Set<string>;
    repostedSet: Set<string>;
  },
): Record<string, unknown> {
  const author = authorMap.get(p.attributedTo) || NULL_AUTHOR;
  return {
    ap_id: p.apId,
    type: p.type,
    author: {
      ap_id: p.attributedTo,
      username: formatUsername(p.attributedTo),
      preferred_username: author.preferredUsername,
      name: author.name,
      icon_url: author.iconUrl,
    },
    content: p.content,
    summary: p.summary,
    attachments: safeJsonParse<Attachment[]>(p.attachmentsJson, []),
    in_reply_to: p.inReplyTo,
    visibility: p.visibility,
    community_ap_id: p.communityApId,
    like_count: p.likeCount,
    reply_count: p.replyCount,
    announce_count: p.announceCount,
    published: p.published,
    liked: interactions.likedSet.has(p.apId),
    bookmarked: interactions.bookmarkedSet.has(p.apId),
    reposted: interactions.repostedSet.has(p.apId),
  };
}

// Batch-resolve authors and interactions, then format posts for API response
async function resolveAndFormatPosts(
  db: Database,
  posts: Array<Parameters<typeof formatPost>[0]>,
  viewerApId: string,
): Promise<Record<string, unknown>[]> {
  const authorApIds = posts.map((p) => p.attributedTo);
  const postApIds = posts.map((p) => p.apId);

  const [authorMap, interactions] = await Promise.all([
    batchGetAuthorInfo(db, authorApIds),
    batchGetInteractionStatus(db, viewerApId, postApIds),
  ]);

  return posts.map((p) => formatPost(p, authorMap, interactions));
}

// Resolve a community by its ap_id (or preferred username) and the viewer's
// accepted membership, enforcing read access by community visibility.
//
// Read access policy (mirrors GET /communities/:id/messages):
//   - public community  -> readable by anyone (member or not, authed or not)
//   - non-public        -> requires an accepted membership row
// Returns:
//   - { gate: "not_found" }            community does not exist / soft-deleted
//   - { gate: "forbidden" }            non-public community, viewer not a member
//   - { gate: "ok", community }        viewer may read this community's feed
async function resolveCommunityRead(
  db: Database,
  communityParam: string,
  viewerApId: string,
): Promise<
  | { gate: "not_found" }
  | { gate: "forbidden" }
  | { gate: "ok"; community: { apId: string; visibility: string } }
> {
  const community = await db
    .select({
      apId: communities.apId,
      visibility: communities.visibility,
    })
    .from(communities)
    .where(
      and(
        or(
          eq(communities.apId, communityParam),
          eq(communities.preferredUsername, communityParam),
        ),
        isNull(communities.deletedAt),
      ),
    )
    .get();

  if (!community) return { gate: "not_found" };

  if ((community.visibility || "public") === "public") {
    return { gate: "ok", community };
  }

  // Non-public community: an accepted membership row is required. Anonymous
  // viewers (no ap_id) can never satisfy this, so do not leak the feed.
  if (!viewerApId) return { gate: "forbidden" };

  const membership = await db
    .select({ actorApId: communityMembers.actorApId })
    .from(communityMembers)
    .where(
      and(
        eq(communityMembers.communityApId, community.apId),
        eq(communityMembers.actorApId, viewerApId),
      ),
    )
    .get();

  if (!membership) return { gate: "forbidden" };
  return { gate: "ok", community };
}

// Community-scoped read: returns the community's feed to viewers permitted by
// `resolveCommunityRead`. Unlike the public feed this does NOT filter on
// `visibility = "public"` — members are entitled to see every post in their
// community (public / unlisted / followers), gated only by community access.
async function handleCommunityTimeline(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  communityParam: string,
): Promise<Response> {
  const actor = c.get("actor");
  const db = c.get("db");
  const limit = parseLimit(c.req.query("limit"), 20, 100);
  const offset = parseOffset(c.req.query("offset"), 0, 10000);
  const before = c.req.query("before");
  const viewerApId = actor?.ap_id || "";

  const gate = await resolveCommunityRead(db, communityParam, viewerApId);
  if (gate.gate === "not_found") {
    return c.json({ error: "Community not found" }, 404);
  }
  if (gate.gate === "forbidden") {
    return c.json({ error: "Not a community member" }, 403);
  }

  const { blockedApIds, mutedApIds } = await getBlockedAndMutedUsers(
    db,
    viewerApId,
  );
  const excludedApIds = buildExcludedApIds(blockedApIds, mutedApIds);

  // Filter strictly by communityApId — community posts live outside the public
  // feed (their audienceJson is non-"[]"), so scoping by community is what makes
  // them visible to members here.
  const conditions = [
    eq(objects.type, "Note"),
    eq(objects.communityApId, gate.community.apId),
    isNull(objects.inReplyTo),
    isNull(objects.deletedAt),
  ];
  if (excludedApIds.length > 0) {
    conditions.push(notInArray(objects.attributedTo, excludedApIds));
  }
  if (before) conditions.push(lt(objects.published, before));

  const posts = await db
    .select(POST_FEED_COLUMNS)
    .from(objects)
    .where(and(...conditions))
    .orderBy(desc(objects.published))
    .limit(limit + 1)
    .offset(offset);

  const { results, has_more } = paginateResults(posts, limit);
  const result = await resolveAndFormatPosts(db, results, viewerApId);

  return c.json({ posts: result, limit, offset, has_more });
}

// Get public timeline
// Supports both cursor (before) and offset pagination
// Returns: posts, limit, offset (if used), has_more
// Cached for 2 minutes for unauthenticated users.
//
// `community` is handled by a dedicated, per-viewer code path (membership +
// visibility gate). The withCache wrapper already bypasses the shared cache
// whenever an authenticated actor is present (varyByActor is false), so a
// member's community read is never served from another user's cached copy.
timeline.get(
  "/",
  withCache({
    ttl: CacheTTL.PUBLIC_TIMELINE,
    cacheTag: CacheTags.TIMELINE,
    queryParamsToInclude: ["limit", "offset", "before", "community"],
  }),
  async (c) => {
    const communityParam = c.req.query("community");
    if (communityParam) {
      return handleCommunityTimeline(c, communityParam);
    }

    const actor = c.get("actor");
    const db = c.get("db");
    const limit = parseLimit(c.req.query("limit"), 20, 100);
    const offset = parseOffset(c.req.query("offset"), 0, 10000);
    const before = c.req.query("before");
    const viewerApId = actor?.ap_id || "";

    const { blockedApIds, mutedApIds } = await getBlockedAndMutedUsers(
      db,
      viewerApId,
    );
    const excludedApIds = buildExcludedApIds(blockedApIds, mutedApIds);

    // Public/home feed: only top-level public posts with no extra audience.
    // The audienceJson = "[]" filter is what keeps community / addressed posts
    // out of this feed.
    const conditions = [
      eq(objects.type, "Note"),
      eq(objects.visibility, "public"),
      isNull(objects.inReplyTo),
      eq(objects.audienceJson, "[]"),
      isNull(objects.deletedAt),
    ];
    if (excludedApIds.length > 0) {
      conditions.push(notInArray(objects.attributedTo, excludedApIds));
    }
    if (before) conditions.push(lt(objects.published, before));

    const posts = await db
      .select(POST_FEED_COLUMNS)
      .from(objects)
      .where(and(...conditions))
      .orderBy(desc(objects.published))
      .limit(limit + 1)
      .offset(offset);

    const { results, has_more } = paginateResults(posts, limit);
    const result = await resolveAndFormatPosts(db, results, viewerApId);

    return c.json({ posts: result, limit, offset, has_more });
  },
);

// Get following timeline
// Supports both cursor (before) and offset pagination
// Returns: posts, limit, offset (if used), has_more
timeline.get("/following", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  const db = c.get("db");
  const limit = parseLimit(c.req.query("limit"), 20, 100);
  const offset = parseOffset(c.req.query("offset"), 0, 10000);
  const before = c.req.query("before");
  const viewerApId = actor.ap_id;

  const [{ blockedApIds, mutedApIds }, followRows] = await Promise.all([
    getBlockedAndMutedUsers(db, viewerApId),
    db
      .select({ followingApId: follows.followingApId })
      .from(follows)
      .where(
        and(
          eq(follows.followerApId, viewerApId),
          eq(follows.status, "accepted"),
        ),
      ),
  ]);

  const excludedApIds = buildExcludedApIds(blockedApIds, mutedApIds);
  const followingApIds = followRows.map((f) => f.followingApId);
  const allowedAuthors = [viewerApId, ...followingApIds];

  // Own posts: all visibilities except direct
  // Followed users' posts: public, unlisted, or followers visibility
  const conditions = [
    eq(objects.type, "Note"),
    isNull(objects.inReplyTo),
    eq(objects.audienceJson, "[]"),
    inArray(objects.attributedTo, allowedAuthors),
    isNull(objects.deletedAt),
    or(
      eq(objects.attributedTo, viewerApId),
      and(
        ne(objects.attributedTo, viewerApId),
        inArray(objects.visibility, ["public", "unlisted", "followers"]),
      ),
    ),
  ];
  if (excludedApIds.length > 0) {
    conditions.push(notInArray(objects.attributedTo, excludedApIds));
  }
  if (before) conditions.push(lt(objects.published, before));

  const posts = await db
    .select(POST_FEED_COLUMNS)
    .from(objects)
    .where(and(...conditions))
    .orderBy(desc(objects.published))
    .limit(limit + 1)
    .offset(offset);

  const { results, has_more } = paginateResults(posts, limit);
  const result = await resolveAndFormatPosts(db, results, viewerApId);

  return c.json({ posts: result, limit, offset, has_more });
});

export default timeline;
