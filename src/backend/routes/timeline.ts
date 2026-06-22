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
import type { SQL } from "drizzle-orm";
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
  updated: objects.updated,
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

// Feeds order by `published` desc, but `published` is not unique: several posts
// can share the same millisecond. An exclusive cursor on `published` alone would
// skip the rows on either side of the page boundary that share the cursor's
// millisecond. To avoid that, the cursor is a composite of (published, apId) and
// pagination uses a tuple predicate:
//   published < c.published OR (published = c.published AND apId < c.apId)
// `apId` is unique, so the (published desc, apId desc) ordering is total and the
// boundary is unambiguous. The two parts are encoded into the opaque `before`
// cursor string with a NUL separator (NUL cannot appear in an ISO timestamp or
// an http(s) ap_id URL).
const CURSOR_SEP = "\u0000";

type FeedCursor = { published: string; apId: string };

// Decode a `before` cursor. For backward compatibility a legacy cursor that
// carries only a `published` value (no separator) is still accepted: it falls
// back to a published-only predicate, which is never wider than the composite
// form (it can only skip same-ms rows on re-paginated legacy clients, never
// leak extra rows).
function decodeFeedCursor(before: string): FeedCursor | { published: string } {
  const idx = before.indexOf(CURSOR_SEP);
  if (idx === -1) return { published: before };
  return {
    published: before.slice(0, idx),
    apId: before.slice(idx + 1),
  };
}

// Encode the composite cursor for the last row of a page so the next request
// resumes strictly after it.
function encodeFeedCursor(row: {
  published: string | null;
  apId: string;
}): string | null {
  if (row.published === null) return null;
  return `${row.published}${CURSOR_SEP}${row.apId}`;
}

// Build the exclusive tuple predicate for a decoded cursor. Always returns a
// concrete predicate (its operands are defined), so the result is a non-null
// `SQL` suitable for the feed `conditions` array.
function feedCursorPredicate(cursor: FeedCursor | { published: string }): SQL {
  if (!("apId" in cursor)) {
    // Legacy published-only cursor.
    return lt(objects.published, cursor.published);
  }
  return or(
    lt(objects.published, cursor.published),
    and(eq(objects.published, cursor.published), lt(objects.apId, cursor.apId)),
  )!;
}

// Compute the `next_cursor` for a (possibly paginated) result page: the encoded
// composite cursor of the last returned row, or null when there are no more.
function nextFeedCursor(
  results: Array<{ published: string | null; apId: string }>,
  has_more: boolean,
): string | null {
  if (!has_more || results.length === 0) return null;
  return encodeFeedCursor(results[results.length - 1]);
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
    updated?: string | null;
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
    // `edited_at` is the post's `updated` timestamp, surfaced only when it
    // differs from `published` (create leaves `updated` NULL; an edit sets it).
    // The client renders an "編集済み" marker, matching the `updated` that
    // federation peers already receive on the Update(Note).
    edited_at: p.updated && p.updated !== p.published ? p.updated : null,
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

/**
 * Visibility gate for COMMUNITY-NARROWED posts (objects.communityApId set) in a
 * feed leg. A community post still honors per-post visibility, matching the
 * canonical single-object gate (canViewerReadObjectFull): public/unlisted are
 * readable by anyone with community access; a `followers` post is readable ONLY
 * by the author's accepted followers (and the author); `direct` is excluded at
 * the feed base. Without this, the community-filter leg (and the home community
 * branch) surfaced followers-only community posts to non-followers / anonymous
 * viewers — because for a PUBLIC community "community access" is granted to
 * everyone, so the old "members see every post" assumption leaks.
 */
// Non-correlated subquery of the actors the viewer accepted-follows. Used as
// `inArray(objects.attributedTo, acceptedFollowingSubquery(db, me))` so the
// membership test compiles to `attributed_to IN (SELECT ...)`. This keeps the
// home / following / community feeds LOSSLESS for any follow count AND avoids
// splicing thousands of follow ids into the query as bound parameters (SQLite's
// variable ceiling) — it replaces an earlier defensive row-cap that silently
// dropped authors beyond ~1000 follows.
function acceptedFollowingSubquery(db: Database, viewerApId: string) {
  return db
    .select({ id: follows.followingApId })
    .from(follows)
    .where(
      and(eq(follows.followerApId, viewerApId), eq(follows.status, "accepted")),
    );
}

function communityPostVisibilityGate(
  db: Database,
  viewerApId: string,
): SQL | undefined {
  return or(
    inArray(objects.visibility, ["public", "unlisted"]),
    viewerApId ? eq(objects.attributedTo, viewerApId) : undefined,
    viewerApId
      ? and(
          eq(objects.visibility, "followers"),
          inArray(
            objects.attributedTo,
            acceptedFollowingSubquery(db, viewerApId),
          ),
        )
      : undefined,
  );
}

// Community-scoped read: returns the community's feed to viewers permitted by
// `resolveCommunityRead`. Per-post visibility is still honored via
// `communityPostVisibilityGate` (a followers-only post stays follow-gated even
// inside the community), gated additionally by community access.
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

  // This is the home "narrow to a community" filter: it shows the slice of the
  // viewer's reach that belongs to this community — (1) posts deliberately
  // narrowed to it (communityApId), plus (2) the general public/unlisted posts
  // of its members (a community is a named slice of people, not a content silo).
  // Membership tests as subqueries (IN (SELECT ...)) so a community with many
  // members — or a viewer with many follows — is matched losslessly without a
  // row-cap or thousands of bound parameters.
  const memberSubquery = db
    .select({ id: communityMembers.actorApId })
    .from(communityMembers)
    .where(eq(communityMembers.communityApId, gate.community.apId));

  const conditions = [
    eq(objects.type, "Note"),
    isNull(objects.inReplyTo),
    isNull(objects.deletedAt),
    // A direct post narrowed to this community must never surface here — direct
    // belongs in /dm. The communityApId leg below has no visibility filter, so
    // gate it at the base.
    ne(objects.visibility, "direct"),
  ];
  if (excludedApIds.length > 0) {
    conditions.push(notInArray(objects.attributedTo, excludedApIds));
  }
  if (before) conditions.push(feedCursorPredicate(decodeFeedCursor(before)));

  const memberFeed = and(
    eq(objects.audienceJson, "[]"),
    inArray(objects.attributedTo, memberSubquery),
    inArray(objects.visibility, ["public", "unlisted"]),
  );
  const source = or(
    and(
      eq(objects.communityApId, gate.community.apId),
      communityPostVisibilityGate(db, viewerApId),
    ),
    memberFeed,
  );

  const posts = await db
    .select(POST_FEED_COLUMNS)
    .from(objects)
    .where(and(...conditions, source))
    .orderBy(desc(objects.published), desc(objects.apId))
    .limit(limit + 1)
    .offset(offset);

  const { results, has_more } = paginateResults(posts, limit);
  const result = await resolveAndFormatPosts(db, results, viewerApId);

  return c.json({
    posts: result,
    limit,
    offset,
    has_more,
    next_cursor: nextFeedCursor(results, has_more),
  });
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

    const base = [
      eq(objects.type, "Note"),
      isNull(objects.inReplyTo),
      isNull(objects.deletedAt),
      // Direct posts (DMs) are stored as audienceJson="[]" too, so they would
      // otherwise slip into the ununion — the own-author branch leg has no
      // visibility filter, and the community branch has none either. They belong
      // only in /dm, never in any timeline feed; exclude them at the base.
      ne(objects.visibility, "direct"),
    ];
    if (excludedApIds.length > 0) {
      base.push(notInArray(objects.attributedTo, excludedApIds));
    }
    if (before) base.push(feedCursorPredicate(decodeFeedCursor(before)));

    // The "source" predicate selects WHICH posts belong in this feed.
    let sourcePredicate;
    if (!viewerApId) {
      // Anonymous visitor: the instance's public timeline — top-level public
      // posts with no extra audience (community / addressed posts excluded).
      sourcePredicate = and(
        eq(objects.visibility, "public"),
        eq(objects.audienceJson, "[]"),
      );
    } else {
      // Authenticated home: the unified "everything I can see" feed = my whole
      // reach. A post belongs to ME, not to a single community, so this merges:
      //   A1 self + accepted follows (own = any non-direct; follows = public/
      //      unlisted/followers),
      //   A2 co-members (authors who share a community with me) — their public/
      //      unlisted posts only (followers-only stays follow-gated, no leak),
      //   B  posts deliberately narrowed to a community I belong to.
      // Author fan-in is expressed as `attributed_to IN (SELECT ...)` subqueries
      // (follows / co-members), so the feed stays lossless for any follow or
      // community-member count without splicing thousands of ids into the query
      // as bound parameters (SQLite's variable ceiling). Only the viewer's own
      // community list is materialized — it is naturally small (the communities
      // one has joined).
      const myCommunityRows = await db
        .select({ communityApId: communityMembers.communityApId })
        .from(communityMembers)
        .where(eq(communityMembers.actorApId, viewerApId));
      const myCommunityApIds = myCommunityRows.map((r) => r.communityApId);

      const branches = [
        and(
          eq(objects.audienceJson, "[]"),
          or(
            eq(objects.attributedTo, viewerApId),
            inArray(
              objects.attributedTo,
              acceptedFollowingSubquery(db, viewerApId),
            ),
          ),
          or(
            eq(objects.attributedTo, viewerApId),
            inArray(objects.visibility, ["public", "unlisted", "followers"]),
          ),
        ),
      ];
      if (myCommunityApIds.length > 0) {
        // Co-members = authors who share a community with me. A subquery against
        // my community set (empty → matches nothing, harmless).
        const coMemberSubquery = db
          .select({ id: communityMembers.actorApId })
          .from(communityMembers)
          .where(
            and(
              inArray(communityMembers.communityApId, myCommunityApIds),
              ne(communityMembers.actorApId, viewerApId),
            ),
          );
        branches.push(
          and(
            eq(objects.audienceJson, "[]"),
            inArray(objects.attributedTo, coMemberSubquery),
            inArray(objects.visibility, ["public", "unlisted"]),
          ),
        );
        // Honor per-post visibility on community-narrowed posts too — a
        // followers-only post stays follow-gated even inside a community I'm in
        // (matches the canonical single-object gate; otherwise a co-member who
        // doesn't follow the author would see their followers-only post).
        branches.push(
          and(
            inArray(objects.communityApId, myCommunityApIds),
            communityPostVisibilityGate(db, viewerApId),
          ),
        );
      }
      sourcePredicate = or(...branches);
    }

    const posts = await db
      .select(POST_FEED_COLUMNS)
      .from(objects)
      .where(and(...base, sourcePredicate))
      .orderBy(desc(objects.published), desc(objects.apId))
      .limit(limit + 1)
      .offset(offset);

    const { results, has_more } = paginateResults(posts, limit);
    const result = await resolveAndFormatPosts(db, results, viewerApId);

    return c.json({
      posts: result,
      limit,
      offset,
      has_more,
      next_cursor: nextFeedCursor(results, has_more),
    });
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

  const { blockedApIds, mutedApIds } = await getBlockedAndMutedUsers(
    db,
    viewerApId,
  );

  const excludedApIds = buildExcludedApIds(blockedApIds, mutedApIds);

  // Own posts: all visibilities except direct
  // Followed users' posts: public, unlisted, or followers visibility
  // Membership = me OR accepted-follow (subquery, lossless for any follow count).
  const conditions = [
    eq(objects.type, "Note"),
    isNull(objects.inReplyTo),
    eq(objects.audienceJson, "[]"),
    or(
      eq(objects.attributedTo, viewerApId),
      inArray(objects.attributedTo, acceptedFollowingSubquery(db, viewerApId)),
    ),
    isNull(objects.deletedAt),
    // Exclude directs: the own-author leg below is unconditional, so a DM the
    // viewer sent would otherwise appear in their own following feed.
    ne(objects.visibility, "direct"),
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
  if (before) conditions.push(feedCursorPredicate(decodeFeedCursor(before)));

  const posts = await db
    .select(POST_FEED_COLUMNS)
    .from(objects)
    .where(and(...conditions))
    .orderBy(desc(objects.published), desc(objects.apId))
    .limit(limit + 1)
    .offset(offset);

  const { results, has_more } = paginateResults(posts, limit);
  const result = await resolveAndFormatPosts(db, results, viewerApId);

  return c.json({
    posts: result,
    limit,
    offset,
    has_more,
    next_cursor: nextFeedCursor(results, has_more),
  });
});

export default timeline;
