import { Hono } from "hono";
import { and, desc, eq, gt, inArray, like, or } from "drizzle-orm";
import type { Env, Variables } from "../types.ts";
import {
  fetchWithTimeout,
  formatUsername,
  isSafeRemoteUrl,
  normalizeRemoteDomain,
  parseLimit,
  parseOffset,
} from "../federation-helpers.ts";
import type { Database } from "../../db/index.ts";
import {
  actorCache,
  actors,
  likes,
  notDeleted,
  objects,
} from "../../db/index.ts";
import {
  parseWebFinger,
  tryParseRemoteActor,
} from "../lib/activitypub-validators.ts";
import { logger } from "../lib/logger.ts";
import { withCache } from "../middleware/cache.ts";

const log = logger.child({ component: "search" });

// Trending hashtags are derived purely from public posts and carry no
// per-viewer data, so the response is identical for every caller. Cache it
// for 10 minutes to avoid re-scanning recent posts on every request.
const TRENDING_HASHTAGS_TTL = 600;
// Ceiling on the trending post scan. Hashtags are extracted from post CONTENT
// in JS (D1/SQLite has no REGEXP, and tags_json is only populated by local
// posts — federated inbound posts would be missed by a tags_json aggregation),
// so this bounds memory on a cache miss. It is a memory bound, NOT a silent
// window truncation: if a scan returns exactly this many rows we log that older
// in-window posts went uncounted. The scalable fix (an FTS / normalized-tags
// index aggregated in SQL) is tracked as deferred search work.
const TRENDING_SCAN_LIMIT = 2000;

const search = new Hono<{ Bindings: Env; Variables: Variables }>();
const REMOTE_FETCH_TIMEOUT_MS = 10000;

// ---------------------------------------------------------------------------
// Sort validation
// ---------------------------------------------------------------------------

const ALLOWED_ACTOR_SORTS = ["relevance", "followers", "recent"] as const;
type ActorSort = (typeof ALLOWED_ACTOR_SORTS)[number];

const ALLOWED_POST_SORTS = ["recent", "popular"] as const;
type PostSort = (typeof ALLOWED_POST_SORTS)[number];

function validateSort<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (value && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

type ActorInfo = {
  apId: string;
  preferredUsername: string | null;
  name: string | null;
  iconUrl: string | null;
};

// ---------------------------------------------------------------------------
// Shared helpers (file-local, not exported)
// ---------------------------------------------------------------------------

/**
 * Public-searchability guard shared by every anonymous-reachable post search
 * (/posts, /hashtag, /hashtags/trending).
 *
 * Community-scoped Notes are persisted as visibility="public" but carry a
 * non-"[]" audienceJson (the community read-gate). Filtering on visibility
 * alone would leak private-community post content (and, via trending, tag
 * names/counts) to anonymous or non-member callers. Both guards MUST be
 * applied together; centralizing them here prevents the two conditions from
 * drifting apart across the three search routes.
 *
 * Pass content/recency predicates as extra args; they are AND-ed with the
 * public-scope guard.
 */
function publicSearchableWhere(...extra: Parameters<typeof and>) {
  return and(
    eq(objects.visibility, "public"),
    eq(objects.audienceJson, "[]"),
    ...extra,
  );
}

/** Build orderBy for post queries. */
function postOrderByDrizzle(sort: PostSort) {
  if (sort === "popular") {
    return [desc(objects.likeCount), desc(objects.published)];
  }
  return [desc(objects.published)];
}

// Canonical hashtag tokenizer. Shared by trending and hashtag search so the two
// agree on what is a WHOLE hashtag token — a content `LIKE '%#tag%'` alone treats
// "#go" as matching "#golang" (a substring), which is wrong for both surfaces.
// The character class mirrors the client-side hashtag linkifier (ASCII word chars
// + Hiragana/Katakana/CJK) so search matches exactly what is rendered as a link.
const HASHTAG_TOKEN_REGEX = /#([a-zA-Z0-9_぀-ゟ゠-ヿ一-鿿]+)/g;

/** Extract the lowercased hashtag tokens (without the leading '#') from content. */
function extractHashtags(content: string): string[] {
  const tags: string[] = [];
  HASHTAG_TOKEN_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HASHTAG_TOKEN_REGEX.exec(content)) !== null) {
    tags.push(match[1].toLowerCase());
  }
  return tags;
}

// Ceiling on the hashtag-search candidate scan. The `LIKE '%#tag%'` prefilter
// returns a superset (substring matches); the exact whole-token filter then runs
// in JS (SQLite has no REGEXP). This bounds memory; if a scan hits the ceiling we
// log so deep results on a busy instance aren't silently dropped.
const HASHTAG_SEARCH_SCAN_CAP = 1000;

/** Build a merged author lookup map (local actors take priority over cached). */
async function buildAuthorMap(
  db: Database,
  apIds: string[],
): Promise<Map<string, ActorInfo>> {
  const [localAuthors, cachedAuthors] = await Promise.all([
    db
      .select({
        apId: actors.apId,
        preferredUsername: actors.preferredUsername,
        name: actors.name,
        iconUrl: actors.iconUrl,
      })
      .from(actors)
      .where(inArray(actors.apId, apIds)),
    db
      .select({
        apId: actorCache.apId,
        preferredUsername: actorCache.preferredUsername,
        name: actorCache.name,
        iconUrl: actorCache.iconUrl,
      })
      .from(actorCache)
      .where(inArray(actorCache.apId, apIds)),
  ]);

  const map = new Map<string, ActorInfo>();
  // Insert cached first so local actors override them
  for (const a of cachedAuthors) map.set(a.apId, a);
  for (const a of localAuthors) map.set(a.apId, a);
  return map;
}

/** Load the set of post AP IDs that a given actor has liked. */
async function loadLikedPostIds(
  db: Database,
  actorApId: string | undefined,
  postApIds: string[],
): Promise<Set<string>> {
  if (!actorApId || postApIds.length === 0) return new Set();

  const likeRows = await db
    .select({ objectApId: likes.objectApId })
    .from(likes)
    .where(
      and(eq(likes.actorApId, actorApId), inArray(likes.objectApId, postApIds)),
    );
  return new Set(likeRows.map((l) => l.objectApId));
}

type PostRow = {
  apId: string;
  attributedTo: string;
  content: string;
  published: string | null;
  likeCount: number;
};

/** Map a raw post + author map + liked set into the API response shape. */
function formatPost(
  post: PostRow,
  authorMap: Map<string, ActorInfo>,
  likedPostIds: Set<string>,
): {
  ap_id: string;
  author: {
    ap_id: string;
    username: string;
    preferred_username: string | null;
    name: string | null;
    icon_url: string | null;
  };
  content: string;
  published: string | null;
  like_count: number;
  liked: boolean;
} {
  const author = authorMap.get(post.attributedTo);
  return {
    ap_id: post.apId,
    author: {
      ap_id: post.attributedTo,
      username: formatUsername(post.attributedTo),
      preferred_username: author?.preferredUsername ?? null,
      name: author?.name ?? null,
      icon_url: author?.iconUrl ?? null,
    },
    content: post.content,
    published: post.published,
    like_count: post.likeCount,
    liked: likedPostIds.has(post.apId),
  };
}

/** Enrich posts with author info and like status, returning formatted API results. */
async function enrichPosts(
  db: Database,
  posts: PostRow[],
  actorApId: string | undefined,
): Promise<ReturnType<typeof formatPost>[]> {
  if (posts.length === 0) return [];

  const authorApIds = [...new Set(posts.map((p) => p.attributedTo))];
  const [authorMap, likedPostIds] = await Promise.all([
    buildAuthorMap(db, authorApIds),
    loadLikedPostIds(
      db,
      actorApId,
      posts.map((p) => p.apId),
    ),
  ]);

  return posts.map((p) => formatPost(p, authorMap, likedPostIds));
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * Search local actors by username or name
 * GET /api/search/actors?q=query&sort=relevance|followers|recent
 */
search.get("/actors", async (c) => {
  const query = c.req.query("q")?.trim();
  if (!query) return c.json({ actors: [] });

  const db = c.get("db");
  const sort = validateSort(
    c.req.query("sort"),
    ALLOWED_ACTOR_SORTS,
    "relevance",
  );
  const lowerQuery = query.toLowerCase();

  const orderByClause =
    sort === "recent" ? [desc(actors.createdAt)] : [desc(actors.followerCount)];

  const [localRows, cachedRows] = await Promise.all([
    db
      .select({
        apId: actors.apId,
        preferredUsername: actors.preferredUsername,
        name: actors.name,
        iconUrl: actors.iconUrl,
        summary: actors.summary,
        followerCount: actors.followerCount,
        createdAt: actors.createdAt,
      })
      .from(actors)
      .where(
        and(
          notDeleted(actors),
          or(
            like(actors.preferredUsername, "%" + query + "%"),
            like(actors.name, "%" + query + "%"),
          ),
        ),
      )
      .orderBy(...orderByClause)
      .limit(20),
    // Previously-discovered remote actors live in actorCache (populated by the
    // /remote webfinger lookup). Consult it here so an account someone already
    // found stays re-findable by name/username without re-typing the full
    // handle. Cached actors have no local follower/created metadata.
    db
      .select({
        apId: actorCache.apId,
        preferredUsername: actorCache.preferredUsername,
        name: actorCache.name,
        iconUrl: actorCache.iconUrl,
        summary: actorCache.summary,
      })
      .from(actorCache)
      .where(
        or(
          like(actorCache.preferredUsername, "%" + query + "%"),
          like(actorCache.name, "%" + query + "%"),
        ),
      )
      .limit(20),
  ]);

  // UNION local + cached, with local taking priority on apId collision.
  const seen = new Set(localRows.map((a) => a.apId));
  const actorRows: {
    apId: string;
    preferredUsername: string | null;
    name: string | null;
    iconUrl: string | null;
    summary: string | null;
    followerCount: number;
    createdAt: string | null;
  }[] = [
    ...localRows,
    ...cachedRows
      .filter((a) => !seen.has(a.apId))
      .map((a) => ({
        apId: a.apId,
        preferredUsername: a.preferredUsername,
        name: a.name,
        iconUrl: a.iconUrl,
        summary: a.summary,
        followerCount: 0,
        createdAt: null,
      })),
  ];

  if (sort === "relevance") {
    actorRows.sort((a, b) => {
      const aUsername = (a.preferredUsername ?? "").toLowerCase();
      const bUsername = (b.preferredUsername ?? "").toLowerCase();

      const aExact = aUsername === lowerQuery ? 0 : 1;
      const bExact = bUsername === lowerQuery ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;

      const aPrefix = aUsername.startsWith(lowerQuery) ? 0 : 1;
      const bPrefix = bUsername.startsWith(lowerQuery) ? 0 : 1;
      if (aPrefix !== bPrefix) return aPrefix - bPrefix;

      return b.followerCount - a.followerCount;
    });
  }

  const result = actorRows.map((a) => ({
    ap_id: a.apId,
    preferred_username: a.preferredUsername,
    name: a.name,
    icon_url: a.iconUrl,
    summary: a.summary,
    follower_count: a.followerCount,
    created_at: a.createdAt,
    username: formatUsername(a.apId),
  }));

  return c.json({ actors: result });
});

/**
 * Search posts by content
 * GET /api/search/posts?q=query&sort=recent|popular
 */
search.get("/posts", async (c) => {
  const query = c.req.query("q")?.trim();
  if (!query) return c.json({ posts: [] });

  const actor = c.get("actor");
  const db = c.get("db");
  const sort = validateSort(c.req.query("sort"), ALLOWED_POST_SORTS, "recent");

  const posts = await db
    .select({
      apId: objects.apId,
      attributedTo: objects.attributedTo,
      content: objects.content,
      published: objects.published,
      likeCount: objects.likeCount,
    })
    .from(objects)
    .where(publicSearchableWhere(like(objects.content, "%" + query + "%")))
    .orderBy(...postOrderByDrizzle(sort))
    .limit(50);

  return c.json({ posts: await enrichPosts(db, posts, actor?.ap_id) });
});

/**
 * Search remote actors via WebFinger
 * GET /api/search/remote?q=@user@domain
 */
search.get("/remote", async (c) => {
  const query = c.req.query("q")?.trim();
  if (!query) return c.json({ actors: [] });

  const match = query.match(/^@?([^@]+)@([^@]+)$/);
  if (!match) return c.json({ actors: [] });

  const [, username, domain] = match;
  const safeDomain = normalizeRemoteDomain(domain);
  if (!safeDomain) return c.json({ actors: [] });

  try {
    // WebFinger lookup
    const webfingerUrl = `https://${safeDomain}/.well-known/webfinger?resource=acct:${username}@${safeDomain}`;
    const wfRes = await fetchWithTimeout(webfingerUrl, {
      headers: { Accept: "application/jrd+json" },
      timeout: REMOTE_FETCH_TIMEOUT_MS,
    });
    if (!wfRes.ok) return c.json({ actors: [] });

    const wfRaw: unknown = await wfRes.json();
    let wfData;
    try {
      wfData = parseWebFinger(wfRaw);
    } catch {
      return c.json({ actors: [] });
    }
    const actorLink = wfData.links?.find(
      (l) => l.rel === "self" && l.type === "application/activity+json",
    );
    if (!actorLink?.href || !isSafeRemoteUrl(actorLink.href)) {
      return c.json({ actors: [] });
    }

    // Fetch actor profile
    const actorRes = await fetchWithTimeout(actorLink.href, {
      headers: { Accept: "application/activity+json, application/ld+json" },
      timeout: REMOTE_FETCH_TIMEOUT_MS,
    });
    if (!actorRes.ok) return c.json({ actors: [] });

    const actorRaw: unknown = await actorRes.json();
    const actorData = tryParseRemoteActor(actorRaw);
    if (!actorData) return c.json({ actors: [] });

    if (actorData.id !== actorLink.href || !isSafeRemoteUrl(actorData.id)) {
      return c.json({ actors: [] });
    }

    // Cache the actor (upsert: check if exists, then insert or update)
    const db = c.get("db");
    const cacheFields = {
      type: actorData.type || "Person",
      preferredUsername: actorData.preferredUsername || null,
      name: actorData.name || null,
      summary: actorData.summary || null,
      iconUrl: actorData.icon?.url || null,
      inbox: actorData.inbox || "",
      outbox: actorData.outbox || null,
      publicKeyId: actorData.publicKey?.id || null,
      publicKeyPem: actorData.publicKey?.publicKeyPem || null,
      rawJson: JSON.stringify(actorRaw),
    };

    const existing = await db
      .select({ apId: actorCache.apId })
      .from(actorCache)
      .where(eq(actorCache.apId, actorData.id))
      .get();

    if (existing) {
      await db
        .update(actorCache)
        .set(cacheFields)
        .where(eq(actorCache.apId, actorData.id));
    } else {
      await db.insert(actorCache).values({
        apId: actorData.id,
        ...cacheFields,
      });
    }

    return c.json({
      actors: [
        {
          ap_id: actorData.id,
          username: `${actorData.preferredUsername}@${safeDomain}`,
          preferred_username: actorData.preferredUsername,
          name: actorData.name,
          summary: actorData.summary,
          icon_url: actorData.icon?.url,
        },
      ],
    });
  } catch (e) {
    log.error("Remote search failed", {
      event: "search.remote.failed",
      error: e,
    });
    return c.json({ actors: [] });
  }
});

/**
 * Search posts by hashtag
 * GET /api/search/hashtag/:tag?sort=recent|popular
 */
search.get("/hashtag/:tag", async (c) => {
  const tag = c.req.param("tag")?.trim().replace(/^#/, "");
  if (!tag) return c.json({ posts: [], total: 0 });

  const actor = c.get("actor");
  const db = c.get("db");
  const sort = validateSort(c.req.query("sort"), ALLOWED_POST_SORTS, "recent");
  const limit = parseLimit(c.req.query("limit"), 50, 100);
  const offset = parseOffset(c.req.query("offset"), 0, 10000);
  const hashtagPattern = `#${tag}`;
  const tagLower = tag.toLowerCase();

  const postWhere = publicSearchableWhere(
    like(objects.content, "%" + hashtagPattern + "%"),
  );

  // `LIKE '%#tag%'` is a SUPERSET prefilter: it also matches longer tags that
  // share the prefix (searching "#deploy" would otherwise return "#deployed").
  // SQLite has no REGEXP, so fetch the ordered candidates and keep only those
  // whose content carries the tag as a WHOLE token (matching trending + the
  // client linkifier). Filtering after the DB sort preserves recent/popular
  // order; pagination + total are computed on the exact-matched set so they stay
  // consistent. Content-based, so federated posts (no tags_json) are covered.
  const candidates = await db
    .select({
      apId: objects.apId,
      attributedTo: objects.attributedTo,
      content: objects.content,
      published: objects.published,
      likeCount: objects.likeCount,
    })
    .from(objects)
    .where(postWhere)
    .orderBy(...postOrderByDrizzle(sort))
    .limit(HASHTAG_SEARCH_SCAN_CAP);

  if (candidates.length === HASHTAG_SEARCH_SCAN_CAP) {
    log.warn("hashtag search hit candidate ceiling; deep results may be cut", {
      event: "search.hashtag.truncated",
      tag: tagLower,
    });
  }

  const matched = candidates.filter((p) =>
    extractHashtags(p.content || "").includes(tagLower),
  );

  const total = matched.length;
  const pagePosts = matched.slice(offset, offset + limit);
  const resultPosts = await enrichPosts(db, pagePosts, actor?.ap_id);

  return c.json({
    posts: resultPosts,
    total,
    limit,
    offset,
    has_more: offset + resultPosts.length < total,
  });
});

/**
 * Get trending hashtags
 * GET /api/search/hashtags/trending?limit=10&days=7
 */
search.get(
  "/hashtags/trending",
  withCache({
    ttl: TRENDING_HASHTAGS_TTL,
    queryParamsToInclude: ["limit", "days"],
  }),
  async (c) => {
    const limit = parseLimit(c.req.query("limit"), 10, 50);
    const days = parseLimit(c.req.query("days"), 7, 30);
    const sinceDate = new Date(
      Date.now() - days * 24 * 60 * 60 * 1000,
    ).toISOString();

    const db = c.get("db");

    const posts = await db
      .select({ content: objects.content })
      .from(objects)
      .where(publicSearchableWhere(gt(objects.published, sinceDate)))
      .orderBy(desc(objects.published))
      .limit(TRENDING_SCAN_LIMIT);

    if (posts.length === TRENDING_SCAN_LIMIT) {
      // No silent truncation: the requested `days` window held more public posts
      // than the scan ceiling, so older in-window posts were not counted toward
      // the trend. Surface it for operators on busy instances.
      log.warn("trending scan hit ceiling; older in-window posts uncounted", {
        event: "search.trending.truncated",
        scanned: posts.length,
        days,
      });
    }

    // Extract and count hashtags (shared whole-token tokenizer keeps trending
    // and hashtag search consistent on what counts as a tag).
    const hashtagCounts: Record<string, number> = {};
    for (const post of posts) {
      for (const tagName of extractHashtags(post.content || "")) {
        hashtagCounts[tagName] = (hashtagCounts[tagName] || 0) + 1;
      }
    }

    const trending = Object.entries(hashtagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([tagName, count]) => ({ tag: tagName, count }));

    return c.json({ trending });
  },
);

export default search;
