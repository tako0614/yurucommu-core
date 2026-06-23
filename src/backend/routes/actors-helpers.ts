import type { Context } from "hono";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../../db/index.ts";
import {
  actorCache,
  actors,
  announces,
  blocks,
  bookmarks,
  follows,
  likes,
  mutes,
} from "../../db/index.ts";
import { chunkForInClause } from "../lib/chunk.ts";
import type { Actor, Env, Variables } from "../types.ts";
import {
  actorApId,
  formatUsername,
  getDomain,
  parseLimit,
  parseOffset,
} from "../federation-helpers.ts";

// Hono context with our app's bindings and variables
export type AppContext = Context<
  { Bindings: Env; Variables: Variables },
  string
>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Capped at 90 (not 100): a profile page's post ids are re-queried via
// `inArray(col, postApIds)` for like/bookmark/announce enrichment, and
// Cloudflare D1 allows at most 100 bound parameters per query. (libsql, which
// the tests run on, allows ~32k and hides this.)
export const MAX_ACTOR_POSTS_LIMIT = 90;
export const MAX_PROFILE_NAME_LENGTH = 50;
export const MAX_PROFILE_SUMMARY_LENGTH = 500;
export const MAX_PROFILE_URL_LENGTH = 2000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActorInfo = {
  apId: string;
  preferredUsername: string | null;
  name: string | null;
  iconUrl: string | null;
  summary?: string | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Validate a profile image URL (icon / header). Accepts either an app-relative
 * upload path (`/media/<hash>.<ext>` produced by POST /api/media/upload) or an
 * absolute http(s) URL. Relative upload paths are stored verbatim and
 * absolutized against APP_URL only when serialized for federation, mirroring
 * how community icons and story attachments are handled.
 */
export function isValidProfileImageUrl(value: string): boolean {
  if (value.startsWith("/media/")) return true;
  return isValidHttpUrl(value);
}

/**
 * Batch-load actor info from both local and cached tables, returning a
 * single lookup map keyed by apId.  Local actors take precedence.
 */
export async function loadActorInfoMap(
  db: Database,
  apIds: string[],
  mode: "full" | "author" = "full",
): Promise<Map<string, ActorInfo>> {
  if (apIds.length === 0) return new Map();

  const selectFull = {
    apId: actors.apId,
    preferredUsername: actors.preferredUsername,
    name: actors.name,
    iconUrl: actors.iconUrl,
    summary: actors.summary,
  };
  const selectAuthor = {
    apId: actors.apId,
    preferredUsername: actors.preferredUsername,
    name: actors.name,
    iconUrl: actors.iconUrl,
  };
  const selectCacheFull = {
    apId: actorCache.apId,
    preferredUsername: actorCache.preferredUsername,
    name: actorCache.name,
    iconUrl: actorCache.iconUrl,
    summary: actorCache.summary,
  };
  const selectCacheAuthor = {
    apId: actorCache.apId,
    preferredUsername: actorCache.preferredUsername,
    name: actorCache.name,
    iconUrl: actorCache.iconUrl,
  };

  const localSelect = mode === "full" ? selectFull : selectAuthor;
  const cacheSelect = mode === "full" ? selectCacheFull : selectCacheAuthor;

  // Chunk the IN(...) lookups: callers may pass a whole page of author ids
  // (up to ~90) and D1 caps a query at 100 bound parameters. Chunks are
  // disjoint id slices, so merging their maps is collision-free; cached-then-
  // local ordering still gives local-wins within each chunk.
  const map = new Map<string, ActorInfo>();
  for (const ids of chunkForInClause(apIds)) {
    const [local, cached] = await Promise.all([
      db.select(localSelect).from(actors).where(inArray(actors.apId, ids)),
      db
        .select(cacheSelect)
        .from(actorCache)
        .where(inArray(actorCache.apId, ids)),
    ]);
    for (const a of cached) map.set(a.apId, a);
    for (const a of local) map.set(a.apId, a); // local wins
  }
  return map;
}

/**
 * Format a looked-up actor into the common JSON shape used by blocked/muted/followers/following lists.
 */
export function formatActorSummary(
  apId: string,
  info: ActorInfo | undefined,
): {
  ap_id: string;
  username: string;
  preferred_username: string | null;
  name: string | null;
  icon_url: string | null;
  summary: string | null;
} {
  return {
    ap_id: apId,
    username: formatUsername(apId),
    preferred_username: info?.preferredUsername || null,
    name: info?.name || null,
    icon_url: info?.iconUrl || null,
    summary: info?.summary ?? null,
  };
}

/**
 * Resolve an identifier (AP ID, @user@domain, or bare username) to an AP ID string.
 * Returns null when the identifier cannot be resolved.
 */
export async function resolveActorApId(
  db: Database,
  baseUrl: string,
  identifier: string,
): Promise<string | null> {
  if (identifier.startsWith("http")) return identifier;

  if (!identifier.includes("@")) return actorApId(baseUrl, identifier);

  const stripped = identifier.replace(/^@/, "");
  const parts = stripped.split("@");
  const username = parts[0];
  if (!username) return null;

  if (parts.length === 1) return actorApId(baseUrl, username);

  const domain = parts.slice(1).join("@");
  if (!domain) return null;
  if (domain === getDomain(baseUrl)) return actorApId(baseUrl, username);

  const cached = await db
    .select({ apId: actorCache.apId })
    .from(actorCache)
    .where(
      and(
        eq(actorCache.preferredUsername, username),
        // Match the domain as a LITERAL substring of the AP-ID via instr() — NOT
        // `LIKE '%' || domain || '%'`. The domain comes from a federated handle
        // (`@user@domain`) and is caller-influenceable: an unescaped LIKE would
        // (a) treat a `%`/`_` in `domain` as a wildcard — `@alice@%` would match
        // ANY cached `alice` regardless of domain (wrong-actor resolution), and
        // (b) trip D1's LIKE pattern-complexity limit (SQLITE_ERROR 7500) for a
        // long domain. instr() is literal (no wildcards, no escaping) and has no
        // length limit, so `@alice@%` correctly resolves to null. Both sides are
        // lowercased to preserve LIKE's ASCII case-insensitivity: a handle typed
        // with a non-canonical host case (`@alice@Mastodon.Social`) — which
        // webfinger treats as equivalent — still matches the lowercase cached host.
        sql`instr(lower(${actorCache.apId}), lower(${domain})) > 0`,
      ),
    )
    .get();
  return cached?.apId || null;
}

/**
 * Check that an actor exists in either the local or cached table.
 */
export async function actorExists(
  db: Database,
  apId: string,
): Promise<boolean> {
  const [local, cached] = await Promise.all([
    db
      .select({ apId: actors.apId })
      .from(actors)
      .where(and(eq(actors.apId, apId), sql`${actors.deletedAt} IS NULL`))
      .get(),
    db
      .select({ apId: actorCache.apId })
      .from(actorCache)
      .where(eq(actorCache.apId, apId))
      .get(),
  ]);
  return !!(local || cached);
}

/**
 * Require the current actor from context.  Returns the actor or a 401 Response.
 */
export function requireActor(c: AppContext): Actor | Response {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  return actor;
}

/**
 * Batch-load interaction status (liked, bookmarked, reposted) for the given
 * post AP IDs.  Returns empty sets when the actor is not logged in.
 */
export async function loadPostInteractions(
  db: Database,
  actorApIdVal: string | null,
  postApIds: string[],
): Promise<{
  likedIds: Set<string>;
  bookmarkedIds: Set<string>;
  repostedIds: Set<string>;
}> {
  if (!actorApIdVal || postApIds.length === 0) {
    return {
      likedIds: new Set(),
      bookmarkedIds: new Set(),
      repostedIds: new Set(),
    };
  }

  const [likeRows, bookmarkRows, announceRows] = await Promise.all([
    db
      .select({ objectApId: likes.objectApId })
      .from(likes)
      .where(
        and(
          eq(likes.actorApId, actorApIdVal),
          inArray(likes.objectApId, postApIds),
        ),
      ),
    db
      .select({ objectApId: bookmarks.objectApId })
      .from(bookmarks)
      .where(
        and(
          eq(bookmarks.actorApId, actorApIdVal),
          inArray(bookmarks.objectApId, postApIds),
        ),
      ),
    db
      .select({ objectApId: announces.objectApId })
      .from(announces)
      .where(
        and(
          eq(announces.actorApId, actorApIdVal),
          inArray(announces.objectApId, postApIds),
        ),
      ),
  ]);

  return {
    likedIds: new Set(likeRows.map((l) => l.objectApId)),
    bookmarkedIds: new Set(bookmarkRows.map((b) => b.objectApId)),
    repostedIds: new Set(announceRows.map((a) => a.objectApId)),
  };
}

/**
 * Generic list handler for relation lists (blocked, muted).
 * Fetches paginated relations, batch-loads actor info, and returns formatted summaries.
 */
export async function listRelation<
  T extends { [K in ApIdKey]: string },
  ApIdKey extends string,
>(
  c: AppContext,
  findMany: (
    db: Database,
    actorApIdVal: string,
    limit: number,
    offset: number,
  ) => Promise<T[]>,
  apIdKey: ApIdKey,
  responseKey: string,
): Promise<Response> {
  const result = requireActor(c);
  if (result instanceof Response) return result;
  const actor = result;

  const db = c.get("db");
  const limit = parseLimit(c.req.query("limit"), 100, 500);
  const offset = parseOffset(c.req.query("offset"), 0, 10000);

  const rows = await findMany(db, actor.ap_id, limit, offset);
  const targetApIds = rows.map((r) => r[apIdKey]);
  const infoMap = await loadActorInfoMap(db, targetApIds);

  return c.json({
    [responseKey]: rows.map((r) =>
      formatActorSummary(r[apIdKey], infoMap.get(r[apIdKey])),
    ),
  });
}

// Per-actor cap on block / mute rows. The target ap_id is an arbitrary string
// (no FK, no existence check — a remote actor need not be resolvable), so
// without a cap one account could loop POST with distinct synthetic ids and grow
// the blocks/mutes table without bound. 5000 is far above any real user's set.
export const MAX_RELATIONS_PER_ACTOR = 5000;

/**
 * Generic create handler for relation upserts (block, mute).
 */
export async function createRelation(
  c: AppContext,
  verb: string,
  upsert: (
    db: Database,
    actorApIdVal: string,
    targetApId: string,
  ) => Promise<unknown>,
  countExisting: (db: Database, actorApIdVal: string) => Promise<number>,
): Promise<Response> {
  const result = requireActor(c);
  if (result instanceof Response) return result;
  const actor = result;

  const body = await c.req.json<{ ap_id: string }>();
  if (!body.ap_id) return c.json({ error: "ap_id required" }, 400);
  if (body.ap_id === actor.ap_id) {
    return c.json({ error: `Cannot ${verb} yourself` }, 400);
  }

  const db = c.get("db");
  // Bound the per-actor relation set (soft cap; a small concurrent overshoot is
  // harmless). onConflictDoNothing means re-blocking an existing target is a
  // no-op, so this only rejects genuinely-new rows past the limit.
  if ((await countExisting(db, actor.ap_id)) >= MAX_RELATIONS_PER_ACTOR) {
    return c.json({ error: `${verb} limit reached` }, 429);
  }
  await upsert(db, actor.ap_id, body.ap_id);

  return c.json({ success: true });
}

/**
 * Generic delete handler for relation removals (unblock, unmute).
 */
export async function deleteRelation(
  c: AppContext,
  label: string,
  remove: (
    db: Database,
    actorApIdVal: string,
    targetApId: string,
  ) => Promise<unknown>,
): Promise<Response> {
  const result = requireActor(c);
  if (result instanceof Response) return result;
  const actor = result;

  const body = await c.req.json<{ ap_id: string }>();
  if (!body.ap_id) return c.json({ error: "ap_id required" }, 400);

  const db = c.get("db");
  await remove(db, actor.ap_id, body.ap_id);

  return c.json({ success: true });
}

/**
 * Shared handler for followers / following lists.
 */
export async function listFollowRelation(
  c: AppContext,
  direction: "followers" | "following",
): Promise<Response> {
  const identifier = c.req.param("identifier");
  if (!identifier) return c.json({ error: "Actor not found" }, 404);
  const apId = await resolveActorApId(c.get("db"), c.env.APP_URL, identifier);
  if (!apId) return c.json({ error: "Actor not found" }, 404);

  const limit = parseLimit(c.req.query("limit"), 50, 100);
  const offset = parseOffset(c.req.query("offset"), 0, 10000);
  const db = c.get("db");

  const isFollowers = direction === "followers";
  const whereCondition = isFollowers
    ? and(eq(follows.followingApId, apId), eq(follows.status, "accepted"))
    : and(eq(follows.followerApId, apId), eq(follows.status, "accepted"));

  // A private (locked) account's follower/following LIST is owner-only — mirror
  // the ActivityPub collection gate (canViewPrivateActorCollections), which this
  // API path was missing, so a locked account's social graph (who follows it /
  // who it follows) is not exposed to non-owners. The count stays (it is shown on
  // the profile); only the member list (the sensitive WHO) is withheld.
  const viewer = c.get("actor");
  const targetRow = await db
    .select({ isPrivate: actors.isPrivate })
    .from(actors)
    .where(eq(actors.apId, apId))
    .get();
  if (targetRow?.isPrivate && viewer?.ap_id !== apId) {
    const total =
      (
        await db
          .select({ count: count() })
          .from(follows)
          .where(whereCondition)
          .get()
      )?.count ?? 0;
    return c.json({ [direction]: [], total, limit, offset, has_more: false });
  }

  const [followRows, totalResult] = await Promise.all([
    db
      .select()
      .from(follows)
      .where(whereCondition)
      .orderBy(desc(follows.createdAt))
      .offset(offset)
      .limit(limit),
    db.select({ count: count() }).from(follows).where(whereCondition).get(),
  ]);

  const total = totalResult?.count ?? 0;

  const extractApId = isFollowers
    ? (f: { followerApId: string }) => f.followerApId
    : (f: { followingApId: string }) => f.followingApId;
  const targetApIds = followRows.map(extractApId);
  const infoMap = await loadActorInfoMap(db, targetApIds);
  const items = followRows.map((f) => {
    const id = extractApId(f);
    return formatActorSummary(id, infoMap.get(id));
  });

  return c.json({
    [direction]: items,
    total,
    limit,
    offset,
    has_more: offset + items.length < total,
  });
}
