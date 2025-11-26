// Post-related routes (create, list, reactions, comments)

import { Hono } from "hono";
import type {
  PublicAccountBindings as Bindings,
  Variables,
} from "@takos/platform/server";
import { makeData } from "../data";
import type { PollInput } from "../lib/types";
import {
  ok,
  fail,
  nowISO,
  uuid,
  HttpError,
  releaseStore,
  enqueueDeliveriesToFollowers,
  getActorUri,
  getObjectUri,
  getActivityUri,
  requireInstanceDomain,
  generateNoteObject,
  ACTIVITYSTREAMS_CONTEXT,
} from "@takos/platform/server";
import { auth } from "../middleware/auth";
import { notify } from "../lib/notifications";
import { extractHashtags, extractMentions, normalizeHashtag } from "../lib/text";

const posts = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const MAX_MEDIA_ALT_LENGTH = 1500;
const MAX_PINNED_POSTS = 5;

// Helper: check community membership
async function requireMember(
  store: ReturnType<typeof makeData>,
  communityId: string | null | undefined,
  userId: string,
): Promise<boolean> {
  if (!communityId) return true;
  return await store.hasMembership(communityId, userId);
}

const sanitizeContentWarning = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 500);
};

type MediaPayload = { url: string; description?: string };

const normalizeMediaPayload = (raw: any): MediaPayload[] => {
  if (!Array.isArray(raw)) return [];
  const out: MediaPayload[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const url = item.trim();
      if (url) out.push({ url });
      continue;
    }
    if (item && typeof item === "object" && typeof item.url === "string") {
      const url = item.url.trim();
      if (!url) continue;
      const description =
        typeof item.description === "string"
          ? item.description.slice(0, MAX_MEDIA_ALT_LENGTH).trim()
          : "";
      out.push({
        url,
        description: description || undefined,
      });
    }
  }
  return out;
};

const extractMediaKey = (url: string): string | null => {
  try {
    const parsed = new URL(url, "https://dummy");
    const path = parsed.pathname || "";
    if (path.startsWith("/media/")) {
      return decodeURIComponent(path.slice("/media/".length));
    }
    return null;
  } catch {
    if (url.startsWith("/media/")) return decodeURIComponent(url.slice("/media/".length));
    return null;
  }
};

async function enrichMediaDescriptions(
  store: ReturnType<typeof makeData>,
  media: MediaPayload[],
): Promise<MediaPayload[]> {
  if (!store.getMedia || !media.length) return media;
  const enriched: MediaPayload[] = [];
  for (const item of media) {
    if (item.description) {
      enriched.push(item);
      continue;
    }
    const key = extractMediaKey(item.url);
    if (!key) {
      enriched.push(item);
      continue;
    }
    const meta = await store.getMedia(key).catch(() => null);
    if (meta?.description) {
      enriched.push({
        ...item,
        description: String(meta.description).slice(0, MAX_MEDIA_ALT_LENGTH),
      });
    } else {
      enriched.push(item);
    }
  }
  return enriched;
}

type VisibilityFilters = {
  blocked: Set<string>;
  blocking: Set<string>;
  muted: Set<string>;
};

async function getVisibilityFilters(
  store: ReturnType<typeof makeData>,
  userId: string,
): Promise<VisibilityFilters> {
  const [blocked, blocking, muted] = await Promise.all([
    store.listBlockedUsers?.(userId).catch(() => []) ?? [],
    store.listUsersBlocking?.(userId).catch(() => []) ?? [],
    store.listMutedUsers?.(userId).catch(() => []) ?? [],
  ]);

  const blockedIds = new Set<string>(
    (blocked as any[]).map((b: any) => (b.blocked_id || b.user?.id || "").trim()).filter(Boolean),
  );
  const blockingIds = new Set<string>(
    Array.isArray(blocking) ? (blocking as any[]).map((id: any) => String(id)) : [],
  );
  const mutedIds = new Set<string>(
    (muted as any[]).map((m: any) => (m.muted_id || m.user?.id || "").trim()).filter(Boolean),
  );

  return { blocked: blockedIds, blocking: blockingIds, muted: mutedIds };
}

function isAuthorHidden(authorId: string, filters: VisibilityFilters, viewerId: string): boolean {
  if (!authorId || authorId === viewerId) return false;
  return filters.blocked.has(authorId) || filters.blocking.has(authorId) || filters.muted.has(authorId);
}

function buildApTags(
  instanceDomain: string,
  hashtags: string[],
  mentionUsers: Array<{ id: string }>,
): any[] {
  const tags: any[] = [];
  const base = `https://${instanceDomain}`;
  const uniqueHashtags = Array.from(new Set(hashtags.map((t) => normalizeHashtag(t)).filter(Boolean)));
  for (const tag of uniqueHashtags) {
    tags.push({
      type: "Hashtag",
      href: `${base}/tags/${encodeURIComponent(tag)}`,
      name: `#${tag}`,
    });
  }
  const uniqueMentions = Array.from(new Set((mentionUsers || []).map((u) => u.id)));
  for (const id of uniqueMentions) {
    tags.push({
      type: "Mention",
      href: getActorUri(id, instanceDomain),
      name: `@${id}`,
    });
  }
  return tags;
}

async function resolveMentionUsers(
  store: ReturnType<typeof makeData>,
  handles: string[],
): Promise<any[]> {
  const uniqueHandles = Array.from(new Set(handles.map((h) => h.trim()).filter(Boolean)));
  const users: any[] = [];
  for (const handle of uniqueHandles) {
    const user = await store.getUser(handle).catch(() => null);
    if (user) users.push(user);
  }
  return users;
}

async function filterMentionTargets(
  store: ReturnType<typeof makeData>,
  actorId: string,
  mentionUsers: Array<{ id: string }>,
): Promise<Array<{ id: string }>> {
  const allowed: Array<{ id: string }> = [];
  for (const target of mentionUsers) {
    if (!target?.id || target.id === actorId) continue;
    const blocked = await store.isBlocked?.(actorId, target.id).catch(() => false);
    const blocking = await store.isBlocked?.(target.id, actorId).catch(() => false);
    if (blocked || blocking) continue;
    allowed.push(target);
  }
  return allowed;
}

async function persistPostMetadata(
  store: ReturnType<typeof makeData>,
  postId: string,
  hashtags: string[],
  mentionUsers: Array<{ id: string }>,
): Promise<void> {
  await Promise.all([
    store.setPostHashtags?.(postId, hashtags),
    store.setPostMentions?.(postId, mentionUsers.map((u) => u.id)),
  ]);
}

async function notifyMentions(
  store: ReturnType<typeof makeData>,
  env: Bindings,
  actor: any,
  postId: string,
  mentionUsers: Array<{ id: string }>,
): Promise<void> {
  for (const target of mentionUsers) {
    if (!target?.id || target.id === actor.id) continue;
    const blocked = await store.isBlocked?.(target.id, actor.id).catch(() => false);
    const blocking = await store.isBlocked?.(actor.id, target.id).catch(() => false);
    if (blocked || blocking) continue;
    await notify(
      store as any,
      env,
      target.id,
      "mention",
      actor.id,
      "post",
      postId,
      `${actor.display_name || actor.id} があなたをメンションしました`,
    );
  }
}

// Helper: build post payload
async function buildPostPayload(
  store: ReturnType<typeof makeData>,
  user: any,
  body: any,
  options: {
    communityId: string | null;
    allowBodyCommunityOverride: boolean;
    env: Bindings;
  }
): Promise<any> {
  const { communityId, allowBodyCommunityOverride, env } = options;
  let targetCommunityId = communityId;

  if (allowBodyCommunityOverride && body.community_id) {
    targetCommunityId = String(body.community_id);
  }

  if (targetCommunityId) {
    const community = await store.getCommunity(targetCommunityId);
    if (!community) throw new HttpError(404, "community not found");
    if (!(await requireMember(store, targetCommunityId, user.id))) {
      throw new HttpError(403, "forbidden");
    }
  }

  const type = String(body.type || "text");
  const text = String(body.text || "").trim();
  const media = await enrichMediaDescriptions(
    store,
    normalizeMediaPayload(body.media ?? body.media_urls ?? []),
  );
  const media_urls = media.map((m) => m.url);

  if (!text && media_urls.length === 0) {
    throw new HttpError(400, "text or media is required");
  }

  const audienceInput = String(body.audience || "all");
  const audience =
    audienceInput === "community" && targetCommunityId ? "community" : "all";
  const broadcastAll = audience === "all";
  const visibleToFriends = broadcastAll
    ? body.visible_to_friends === undefined
      ? true
      : !!body.visible_to_friends
    : false;

  const id = uuid();
  const instanceDomain = requireInstanceDomain(env);
  const ap_object_id = getObjectUri(user.id, id, instanceDomain);
  const ap_activity_id = getActivityUri(user.id, `create-${id}`, instanceDomain);
  const content_warning = sanitizeContentWarning(body.content_warning);
  const sensitive = body.sensitive === undefined ? false : !!body.sensitive;

  return {
    id,
    community_id: targetCommunityId,
    author_id: user.id,
    type,
    text,
    content_warning,
    sensitive,
    media,
    media_urls,
    created_at: nowISO(),
    pinned: 0,
    broadcast_all: broadcastAll,
    visible_to_friends: visibleToFriends,
    attributed_community_id: targetCommunityId,
    ap_object_id,
    ap_activity_id,
  };
}

const POLL_MIN_OPTIONS = 2;
const POLL_MAX_OPTIONS = 10;

function isAdminUser(user: any, env: Bindings): boolean {
  return !!env.AUTH_USERNAME && user?.id === env.AUTH_USERNAME;
}

function parsePollPayload(raw: any, postId: string): PollInput | null {
  if (!raw) return null;
  if (typeof raw !== "object") {
    throw new HttpError(400, "invalid poll payload");
  }
  const pollId = uuid();
  const rawOptions = Array.isArray(raw.options) ? raw.options : [];
  const options = rawOptions
    .map((opt: any, index: number) => {
      const text = typeof opt === "string" ? opt : opt?.text;
      const trimmed = String(text || "").trim();
      if (!trimmed) return null;
      return {
        id: uuid(),
        poll_id: pollId,
        text: trimmed,
        order_index: index,
      };
    })
    .filter(Boolean) as PollInput["options"];
  if (options.length < POLL_MIN_OPTIONS) {
    throw new HttpError(400, "poll requires at least two options");
  }
  if (options.length > POLL_MAX_OPTIONS) {
    throw new HttpError(400, `poll supports up to ${POLL_MAX_OPTIONS} options`);
  }
  const expires_at = raw.expires_at ? new Date(raw.expires_at) : null;
  if (raw.expires_at && (!expires_at || Number.isNaN(expires_at.getTime()))) {
    throw new HttpError(400, "invalid poll expiration");
  }
  if (expires_at && expires_at.getTime() <= Date.now()) {
    throw new HttpError(400, "poll expiration must be in the future");
  }
  const allows_multiple =
    raw.allows_multiple === undefined ? false : !!raw.allows_multiple;
  const anonymous = raw.anonymous === undefined ? true : !!raw.anonymous;
  return {
    id: pollId,
    post_id: postId,
    question: String(raw.question ?? "").trim(),
    allows_multiple,
    anonymous,
    expires_at: expires_at ? expires_at.toISOString() : null,
    options,
  };
}

const normalizeDate = (value: any) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

function buildPollSummary(
  poll: any,
  votes: any[],
  userId?: string | null,
): any {
  const counts = new Map<string, number>();
  for (const vote of votes) {
    const optionId = (vote as any).option_id;
    counts.set(optionId, (counts.get(optionId) ?? 0) + 1);
  }
  const userVotes = (userId && votes.filter((v) => (v as any).user_id === userId).map((v) => (v as any).option_id)) || [];
  const expiresAtIso = normalizeDate((poll as any).expires_at);
  const expired = expiresAtIso ? new Date(expiresAtIso).getTime() <= Date.now() : false;
  return {
    id: poll.id,
    post_id: poll.post_id,
    question: poll.question ?? "",
    allows_multiple: !!poll.allows_multiple,
    anonymous: !!poll.anonymous,
    expires_at: expiresAtIso,
    expired,
    options: (poll.options || []).map((opt: any) => ({
      id: opt.id,
      text: opt.text,
      order_index: opt.order_index ?? 0,
      votes: counts.get(opt.id) ?? 0,
    })),
    total_votes: votes.length,
    has_voted: userVotes.length > 0,
    selected_option_ids: userVotes,
  };
}

async function loadPollSummaryForPost(
  store: ReturnType<typeof makeData>,
  postId: string,
  userId?: string,
): Promise<any | null> {
  if (!store.getPollByPost || !store.listPollVotes) return null;
  const poll = await store.getPollByPost(postId);
  if (!poll) return null;
  const votes = await store.listPollVotes(poll.id);
  return buildPollSummary(
    { ...poll, options: poll.options ?? [] },
    votes || [],
    userId,
  );
}

async function attachPollsToPosts(
  store: ReturnType<typeof makeData>,
  posts: any[],
  userId?: string,
): Promise<any[]> {
  if (!store.listPollsByPostIds || !store.listPollVotes) return posts;
  const ids = posts.map((p) => (p as any).id);
  const polls = await store.listPollsByPostIds(ids);
  if (!polls?.length) return posts;
  const pollMap = new Map<string, any>();
  for (const poll of polls) {
    pollMap.set((poll as any).post_id, poll);
  }
  const result: any[] = [];
  for (const post of posts) {
    const poll = pollMap.get((post as any).id);
    if (!poll) {
      result.push(post);
      continue;
    }
    const votes = await store.listPollVotes((poll as any).id);
    const summary = buildPollSummary(
      { ...poll, options: (poll as any).options ?? [] },
      votes || [],
      userId,
    );
    result.push({ ...post, poll: summary });
  }
  return result;
}

async function createPostWithActivity(
  store: ReturnType<typeof makeData>,
  env: Bindings,
  user: { id: string },
  post: Awaited<ReturnType<typeof buildPostPayload>>,
  poll?: PollInput | null,
): Promise<void> {
  if (poll && !store.createPoll) {
    throw new Error("polls not supported by data store");
  }

  if (store.transaction) {
    await store.transaction(async (tx) => {
      await tx.createPost(post);
      if (poll) {
        await tx.createPoll!(poll);
      }
    });
  } else {
    await store.createPost(post);
    if (poll) {
      await store.createPoll!(poll);
    }
  }

  const instanceDomain = requireInstanceDomain(env);
  const protocol = "https";
  const noteObject = generateNoteObject(
    {
      ...post,
      media_json: JSON.stringify(post.media ?? post.media_urls),
      content_warning: post.content_warning,
      sensitive: post.sensitive,
      ap_tags: (post as any).ap_tags,
    },
    { id: user.id },
    instanceDomain,
    protocol,
  );
  const actorUri = getActorUri(user.id, instanceDomain);
  const createActivity = {
    "@context": ACTIVITYSTREAMS_CONTEXT,
    type: "Create",
    id: post.ap_activity_id,
    actor: actorUri,
    object: noteObject,
    published: new Date(post.created_at).toISOString(),
    to: noteObject.to,
    cc: noteObject.cc,
  };

  await store.upsertApOutboxActivity({
    id: crypto.randomUUID(),
    local_user_id: user.id,
    activity_id: post.ap_activity_id!,
    activity_type: "Create",
    activity_json: JSON.stringify(createActivity),
    object_id: post.ap_object_id ?? null,
    object_type: "Note",
    created_at: new Date(),
  });

  await enqueueDeliveriesToFollowers(store, user.id, post.ap_activity_id!);
}

async function annotateBookmarks(
  store: ReturnType<typeof makeData>,
  userId: string,
  items: any[],
) {
  const ids = items.map((p) => (p as any).id).filter(Boolean);
  if (!ids.length) return items;
  const bookmarked = await store.getBookmarkedPostIds(userId, ids);
  return items.map((p: any) => ({
    ...p,
    is_bookmarked: bookmarked.has(p.id),
  }));
}

function escapeHtml(input: string): string {
  return (input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// POST /communities/:id/posts
posts.post("/communities/:id/posts", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const user = c.get("user") as any;
  const community_id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as any;
  try {
    const post = await buildPostPayload(store, user, body, {
      communityId: community_id,
      allowBodyCommunityOverride: false,
      env: c.env,
    });
    const hashtags = extractHashtags(post.text || "");
    const mentionUsers = await resolveMentionUsers(
      store,
      extractMentions(post.text || ""),
    );
    const allowedMentions = await filterMentionTargets(store, user.id, mentionUsers);
    const instanceDomain = requireInstanceDomain(c.env);
    const ap_tags = buildApTags(instanceDomain, hashtags, allowedMentions);
    const pollInput = parsePollPayload((body as any).poll, post.id);
    const postWithTags = { ...post, ap_tags };

    await createPostWithActivity(store, c.env as Bindings, user, postWithTags, pollInput);
    await persistPostMetadata(store, post.id, hashtags, allowedMentions);
    await notifyMentions(store, c.env as Bindings, user, post.id, allowedMentions);

    const poll = pollInput ? await loadPollSummaryForPost(store, post.id, user.id) : null;

    return ok(c, { ...postWithTags, poll }, 201);
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      return fail(c, error.message, error.status);
    }
    console.error("create post failed", error);
    return fail(c, "failed to create post", 500);
  } finally {
    await releaseStore(store);
  }
});

// POST /posts
posts.post("/posts", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const user = c.get("user") as any;
  const body = (await c.req.json().catch(() => ({}))) as any;
  try {
    const post = await buildPostPayload(store, user, body, {
      communityId: null,
      allowBodyCommunityOverride: false,
      env: c.env,
    });
    const hashtags = extractHashtags(post.text || "");
    const mentionUsers = await resolveMentionUsers(
      store,
      extractMentions(post.text || ""),
    );
    const allowedMentions = await filterMentionTargets(store, user.id, mentionUsers);
    const instanceDomain = requireInstanceDomain(c.env);
    const ap_tags = buildApTags(instanceDomain, hashtags, allowedMentions);
    const pollInput = parsePollPayload((body as any).poll, post.id);
    const postWithTags = { ...post, ap_tags };

    await createPostWithActivity(store, c.env as Bindings, user, postWithTags, pollInput);
    await persistPostMetadata(store, post.id, hashtags, allowedMentions);
    await notifyMentions(store, c.env as Bindings, user, post.id, allowedMentions);

    const poll = pollInput ? await loadPollSummaryForPost(store, post.id, user.id) : null;

    return ok(c, { ...postWithTags, poll }, 201);
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      return fail(c, error.message, error.status);
    }
    console.error("create global post failed", error);
    return fail(c, "failed to create post", 500);
  } finally {
    await releaseStore(store);
  }
});

// GET /communities/:id/posts
posts.get("/communities/:id/posts", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const community_id = c.req.param("id");
    if (!(await store.getCommunity(community_id))) {
      return fail(c, "community not found", 404);
    }
    if (!(await requireMember(store, community_id, user.id))) {
      return fail(c, "forbidden", 403);
    }
    const list: any[] = await store.listPostsByCommunity(community_id);
    const filters = await getVisibilityFilters(store, user.id);
    const filtered = list.filter((p: any) =>
      !isAuthorHidden((p as any).author_id, filters, user.id),
    );
    filtered.sort((a, b) =>
      (Number(b.pinned) - Number(a.pinned)) ||
      (a.created_at < b.created_at ? 1 : -1)
    );
    const withPolls = await attachPollsToPosts(store, filtered, user.id);
    const withBookmarks = await annotateBookmarks(store, user.id, withPolls);
    return ok(c, withBookmarks);
  } finally {
    await releaseStore(store);
  }
});

// GET /posts
posts.get("/posts", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const list: any[] = await store.listGlobalPostsForUser(user.id);
    const filters = await getVisibilityFilters(store, user.id);
    const filtered = list.filter((p: any) => !isAuthorHidden((p as any).author_id, filters, user.id));
    filtered.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const withPolls = await attachPollsToPosts(store, filtered, user.id);
    const withBookmarks = await annotateBookmarks(store, user.id, withPolls);
    return ok(c, withBookmarks);
  } finally {
    await releaseStore(store);
  }
});

// GET /posts/search
posts.get("/posts/search", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const url = new URL(c.req.url);
    const q = (url.searchParams.get("q") || "").trim();
    const limit = Math.min(
      50,
      Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10)),
    );
    const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10));
    if (!q) return ok(c, { items: [], next_offset: null });
    const results = await store.searchPublicPosts(q, limit, offset);
    const filters = await getVisibilityFilters(store, user.id);
    const filtered = results.filter((p: any) =>
      !isAuthorHidden((p as any).author_id, filters, user.id),
    );
    const withPolls = await attachPollsToPosts(store, filtered, user.id);
    const withBookmarks = await annotateBookmarks(store, user.id, withPolls);
    const next = results.length === limit ? offset + limit : null;
    return ok(c, { items: withBookmarks, next_offset: next });
  } finally {
    await releaseStore(store);
  }
});

// GET /hashtags/:tag/posts - Posts for a hashtag
posts.get("/hashtags/:tag/posts", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const tagParam = c.req.param("tag") || "";
    const normalized = normalizeHashtag(tagParam);
    if (!normalized) return ok(c, []);

    const postsByTag = await store.listPostsByHashtag(normalized);
    const filters = await getVisibilityFilters(store, user.id);
    const visible = [];
    for (const post of postsByTag as any[]) {
      if (isAuthorHidden((post as any).author_id, filters, user.id)) continue;
      if ((post as any).community_id) {
        if (!(await requireMember(store, (post as any).community_id, user.id))) continue;
      }
      visible.push(post);
    }
    visible.sort((a: any, b: any) => (a.created_at < b.created_at ? 1 : -1));
    const withPolls = await attachPollsToPosts(store, visible, user.id);
    const withBookmarks = await annotateBookmarks(store, user.id, withPolls);
    return ok(c, withBookmarks);
  } finally {
    await releaseStore(store);
  }
});

// GET /hashtags/trending - Trending hashtags within a window
posts.get("/hashtags/trending", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const hours = Math.max(1, parseInt(c.req.query("hours") || "24", 10));
    const limit = Math.max(1, parseInt(c.req.query("limit") || "10", 10));
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const tags = await store.listTrendingHashtags(since, limit);
    return ok(c, tags);
  } finally {
    await releaseStore(store);
  }
});

// GET /posts/:id (single post)
posts.get("/posts/:id", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const post_id = c.req.param("id");
    const post = await store.getPost(post_id);
    if (!post) return fail(c, "post not found", 404);
    const filters = await getVisibilityFilters(store, user.id);
    if (isAuthorHidden((post as any).author_id, filters, user.id)) {
      return fail(c, "forbidden", 403);
    }
    if (!(await requireMember(store, (post as any).community_id, user.id))) {
      return fail(c, "forbidden", 403);
    }
    const result: any = { ...post };
    if ((post as any).community_id) {
      const community = await store.getCommunity((post as any).community_id);
      if (community) {
        result.community_name = (community as any).name;
        result.community_icon_url = (community as any).icon_url;
      }
    }
    const poll = await loadPollSummaryForPost(store, post_id, user.id);
    if (poll) {
      result.poll = poll;
    }
    result.is_bookmarked = await store.isPostBookmarked(post_id, user.id);
    result.repost_count = await store.countRepostsByPost(post_id).catch(() => 0);
    return ok(c, result);
  } finally {
    await releaseStore(store);
  }
});

// GET /posts/:id/history
posts.get("/posts/:id/history", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const post_id = c.req.param("id");
    const post = await store.getPost(post_id);
    if (!post) return fail(c, "post not found", 404);
    if (!(await requireMember(store, (post as any).community_id, user.id))) {
      return fail(c, "forbidden", 403);
    }
    if ((post as any).author_id !== user.id && !isAdminUser(user, c.env as Bindings)) {
      return fail(c, "forbidden", 403);
    }
    if (!store.listPostEditHistory) return ok(c, []);
    const history = await store.listPostEditHistory(post_id, 50, 0);
    return ok(c, history);
  } finally {
    await releaseStore(store);
  }
});

// GET /posts/:id/poll
posts.get("/posts/:id/poll", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const post_id = c.req.param("id");
    const post = await store.getPost(post_id);
    if (!post) return fail(c, "post not found", 404);
    if (!(await requireMember(store, (post as any).community_id, user.id))) {
      return fail(c, "forbidden", 403);
    }
    const poll = await loadPollSummaryForPost(store, post_id, user.id);
    if (!poll) return fail(c, "poll not found", 404);
    return ok(c, poll);
  } finally {
    await releaseStore(store);
  }
});

// POST /posts/:id/reposts (boost / quote)
posts.post("/posts/:id/reposts", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const post_id = c.req.param("id");
    const post = await store.getPost(post_id);
    if (!post) return fail(c, "post not found", 404);
    if ((post as any).community_id || !(post as any).broadcast_all) {
      return fail(c, "only public global posts can be reposted", 400);
    }
    const filters = await getVisibilityFilters(store, user.id);
    if (isAuthorHidden((post as any).author_id, filters, user.id)) {
      return fail(c, "forbidden", 403);
    }
    const body = await c.req.json().catch(() => ({})) as any;
    const comment = typeof body.comment === "string" ? body.comment.trim() : "";
    const already = await store.findRepost(post_id, user.id);
    if (already) return ok(c, { ...already, reposted: true });

    const instanceDomain = requireInstanceDomain(c.env);
    const repostId = uuid();
    const announceId = getActivityUri(user.id, `announce-${repostId}`, instanceDomain);
    const postObjectId = (post as any).ap_object_id ||
      getObjectUri((post as any).author_id, post_id, instanceDomain);
    const actorUri = getActorUri(user.id, instanceDomain);
    const created_at = nowISO();

    const record = await store.addRepost({
      id: repostId,
      post_id,
      user_id: user.id,
      comment,
      created_at,
      ap_activity_id: announceId,
    });

    const announce: any = {
      "@context": ACTIVITYSTREAMS_CONTEXT,
      type: "Announce",
      id: announceId,
      actor: actorUri,
      object: postObjectId,
      published: new Date(created_at).toISOString(),
    };
    if (comment) {
      announce.content = `<p>${escapeHtml(comment)}</p>`;
    }

    await store.upsertApOutboxActivity({
      id: crypto.randomUUID(),
      local_user_id: user.id,
      activity_id: announceId,
      activity_type: "Announce",
      activity_json: JSON.stringify(announce),
      object_id: postObjectId,
      object_type: "Announce",
      created_at: new Date(),
    });

    await store.createApAnnounce({
      activity_id: announceId,
      actor_id: actorUri,
      object_id: postObjectId,
      local_post_id: post_id,
      created_at: created_at,
    });

    if ((post as any).author_id !== user.id) {
      const postAuthorInbox = `https://${instanceDomain}/ap/users/${(post as any).author_id}/inbox`;
      await store.createApDeliveryQueueItem({
        id: crypto.randomUUID(),
        activity_id: announceId,
        target_inbox_url: postAuthorInbox,
        status: "pending",
        created_at: new Date(),
      });
    }

    await enqueueDeliveriesToFollowers(store, user.id, announceId);
    return ok(c, { ...record, reposted: true }, 201);
  } finally {
    await releaseStore(store);
  }
});

// DELETE /posts/:id/reposts
posts.delete("/posts/:id/reposts", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const post_id = c.req.param("id");
    const post = await store.getPost(post_id);
    if (!post) return fail(c, "post not found", 404);
    const existing = await store.findRepost(post_id, user.id);
    if (!existing) return fail(c, "repost not found", 404);

    const instanceDomain = requireInstanceDomain(c.env);
    const actorUri = getActorUri(user.id, instanceDomain);
    const announceId = (existing as any).ap_activity_id ||
      getActivityUri(user.id, `announce-${(existing as any).id}`, instanceDomain);
    const postObjectId = (post as any).ap_object_id ||
      getObjectUri((post as any).author_id, post_id, instanceDomain);

    const undoActivity = {
      "@context": ACTIVITYSTREAMS_CONTEXT,
      type: "Undo",
      id: getActivityUri(user.id, `undo-announce-${(existing as any).id}`, instanceDomain),
      actor: actorUri,
      object: {
        type: "Announce",
        id: announceId,
        actor: actorUri,
        object: postObjectId,
      },
      published: new Date().toISOString(),
    };

    await store.upsertApOutboxActivity({
      id: crypto.randomUUID(),
      local_user_id: user.id,
      activity_id: undoActivity.id,
      activity_type: "Undo",
      activity_json: JSON.stringify(undoActivity),
      object_id: announceId,
      object_type: "Announce",
      created_at: new Date(),
    });

    await enqueueDeliveriesToFollowers(store, user.id, undoActivity.id);
    await store.deleteRepost(post_id, user.id);
    await store.deleteApAnnouncesByActivityId(announceId);
    return ok(c, { deleted: true });
  } finally {
    await releaseStore(store);
  }
});

// GET /posts/:id/reposts
posts.get("/posts/:id/reposts", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const post_id = c.req.param("id");
    const url = new URL(c.req.url);
    const limit = Math.min(
      50,
      Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10)),
    );
    const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10));
    const post = await store.getPost(post_id);
    if (!post) return fail(c, "post not found", 404);
    if (!(await requireMember(store, (post as any).community_id, user.id))) {
      return fail(c, "forbidden", 403);
    }
    const rows = await store.listRepostsByPost(post_id, limit, offset);
    const userIds = Array.from(new Set((rows as any[]).map((r: any) => r.user_id)));
    const users = await Promise.all(userIds.map((id) => store.getUser(id)));
    const userMap = new Map<string, any>();
    for (let i = 0; i < userIds.length; i++) {
      userMap.set(userIds[i], users[i]);
    }
    const items = (rows as any[]).map((r: any) => ({
      id: r.id,
      user: userMap.get(r.user_id) || { id: r.user_id },
      comment: r.comment || "",
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    }));
    const count = await store.countRepostsByPost(post_id);
    const next = rows.length === limit ? offset + limit : null;
    return ok(c, { items, count, next_offset: next });
  } finally {
    await releaseStore(store);
  }
});

// POST /posts/:id/vote
posts.post("/posts/:id/vote", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const post_id = c.req.param("id");
    const post = await store.getPost(post_id);
    if (!post) return fail(c, "post not found", 404);
    if (!(await requireMember(store, (post as any).community_id, user.id))) {
      return fail(c, "forbidden", 403);
    }
    if (!store.getPollByPost || !store.createPollVotes) {
      return fail(c, "polls not available", 500);
    }
    const poll = await store.getPollByPost(post_id);
    if (!poll) return fail(c, "poll not found", 404);
    const expiresAtIso = normalizeDate((poll as any).expires_at);
    if (expiresAtIso && new Date(expiresAtIso).getTime() <= Date.now()) {
      return fail(c, "poll expired", 400);
    }

    const body = (await c.req.json().catch(() => ({}))) as any;
    const optionIds = Array.isArray(body.option_ids)
      ? (body.option_ids as any[]).map((v) => String(v))
      : [];
    if (!optionIds.length) {
      return fail(c, "option_ids required", 400);
    }
    if (!poll.allows_multiple && optionIds.length > 1) {
      return fail(c, "multiple selections not allowed", 400);
    }
    const validOptionIds = new Set(
      (poll.options || []).map((opt: any) => opt.id),
    );
    for (const optionId of optionIds) {
      if (!validOptionIds.has(optionId)) {
        return fail(c, "invalid option", 400);
      }
    }
    const priorVotes =
      store.listPollVotesByUser &&
      (await store.listPollVotesByUser(poll.id, user.id));
    if (priorVotes && priorVotes.length > 0) {
      return fail(c, "already voted", 400);
    }

    try {
      await store.createPollVotes(poll.id, optionIds, user.id);
    } catch (err) {
      const message = (err as Error)?.message || "failed to vote";
      return fail(c, message, 400);
    }

    const summary = await loadPollSummaryForPost(store, post_id, user.id);
    return ok(c, summary || { ok: true });
  } finally {
    await releaseStore(store);
  }
});

// GET /posts/:id/reactions
posts.get("/posts/:id/reactions", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const post_id = c.req.param("id");
    const post = await store.getPost(post_id);
    if (!post) return fail(c, "post not found", 404);
    if (!(await requireMember(store, (post as any).community_id, user.id))) {
      return fail(c, "forbidden", 403);
    }
    const list = await store.listReactionsByPost(post_id);
    return ok(c, list);
  } finally {
    await releaseStore(store);
  }
});

// POST /posts/:id/bookmark
posts.post("/posts/:id/bookmark", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const post_id = c.req.param("id");
    const post = await store.getPost(post_id);
    if (!post) return fail(c, "post not found", 404);
    if (!(await requireMember(store, (post as any).community_id, user.id))) {
      return fail(c, "forbidden", 403);
    }
    await store.addBookmark({
      id: uuid(),
      post_id,
      user_id: user.id,
      created_at: nowISO(),
    });
    return ok(c, { bookmarked: true });
  } finally {
    await releaseStore(store);
  }
});

// DELETE /posts/:id/bookmark
posts.delete("/posts/:id/bookmark", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const post_id = c.req.param("id");
    const post = await store.getPost(post_id);
    if (!post) return fail(c, "post not found", 404);
    if (!(await requireMember(store, (post as any).community_id, user.id))) {
      return fail(c, "forbidden", 403);
    }
    await store.deleteBookmark(post_id, user.id);
    return ok(c, { bookmarked: false });
  } finally {
    await releaseStore(store);
  }
});

// GET /me/bookmarks
posts.get("/me/bookmarks", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const url = new URL(c.req.url);
    const limit = Math.min(
      50,
      Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10)),
    );
    const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10));
    const rows = await store.listBookmarksByUser(user.id, limit, offset);
    const posts: any[] = [];
    for (const row of rows as any[]) {
      const post = await store.getPost((row as any).post_id);
      if (!post) continue;
      if ((post as any).community_id) {
        if (!(await requireMember(store, (post as any).community_id, user.id))) continue;
      }
      posts.push({
        ...post,
        is_bookmarked: true,
        bookmarked_at: (row as any).created_at instanceof Date
          ? (row as any).created_at.toISOString()
          : (row as any).created_at,
      });
    }
    const withPolls = await attachPollsToPosts(store, posts, user.id);
    const next = rows.length === limit ? offset + limit : null;
    return ok(c, { items: withPolls, next_offset: next });
  } finally {
    await releaseStore(store);
  }
});

// GET /posts/:id/comments
posts.get("/posts/:id/comments", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const post_id = c.req.param("id");
    const post = await store.getPost(post_id);
    if (!post) return fail(c, "post not found", 404);
    if (!(await requireMember(store, (post as any).community_id, user.id))) {
      return fail(c, "forbidden", 403);
    }
    const filters = await getVisibilityFilters(store, user.id);
    const list: any[] = await store.listCommentsByPost(post_id);
    const filtered = list.filter((comment: any) =>
      !isAuthorHidden((comment as any).author_id, filters, user.id),
    );
    filtered.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return ok(c, filtered);
  } finally {
    await releaseStore(store);
  }
});

// GET /communities/:id/reactions-summary
posts.get("/communities/:id/reactions-summary", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const community_id = c.req.param("id");
    if (!(await store.getCommunity(community_id))) {
      return fail(c, "community not found", 404);
    }
    if (!(await requireMember(store, community_id, user.id))) {
      return fail(c, "forbidden", 403);
    }
    const communityPosts: any[] = await store.listPostsByCommunity(community_id);
    const allReactions: any[] = [];
    for (const post of communityPosts) {
      const reactions = await store.listReactionsByPost(post.id);
      allReactions.push(...reactions);
    }
    const grouped: Record<string, any[]> = {};
    for (const r of allReactions) {
      const key = (r as any).post_id;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(r);
    }
    return ok(c, grouped);
  } finally {
    await releaseStore(store);
  }
});

// POST /posts/:id/reactions
posts.post("/posts/:id/reactions", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const post_id = c.req.param("id");
    const post = await store.getPost(post_id);
    if (!post) return fail(c, "post not found", 404);
    if (!(await requireMember(store, (post as any).community_id, user.id))) {
      return fail(c, "forbidden", 403);
    }
    const body = await c.req.json().catch(() => ({})) as any;
    const emoji = body.emoji || "👍";

    // Generate ActivityPub URIs
    const instanceDomain = requireInstanceDomain(c.env);
    const reactionId = uuid();
    const ap_activity_id = getActivityUri(
      user.id,
      `like-${reactionId}`,
      instanceDomain,
    );

    const reaction = {
      id: reactionId,
      post_id,
      user_id: user.id,
      emoji,
      created_at: nowISO(),
      ap_activity_id,
    };

    // Generate and save Like Activity
    const postObjectId = (post as any).ap_object_id ||
      getObjectUri((post as any).author_id, post_id, instanceDomain);
    const actorUri = getActorUri(user.id, instanceDomain);
    const likeActivity = {
      "@context": ACTIVITYSTREAMS_CONTEXT,
      type: "Like",
      id: ap_activity_id,
      actor: actorUri,
      object: postObjectId,
      published: new Date(reaction.created_at).toISOString(),
      content: emoji !== "👍" ? emoji : undefined, // For emoji reactions (Misskey compat)
    };

    await store.upsertApOutboxActivity({
      id: crypto.randomUUID(),
      local_user_id: user.id,
      activity_id: ap_activity_id,
      activity_type: "Like",
      activity_json: JSON.stringify(likeActivity),
      object_id: postObjectId,
      object_type: "Note",
      created_at: new Date(),
    });

    // Enqueue delivery to post author (for local inbox processing)
    if ((post as any).author_id !== user.id) {
      const postAuthorInbox = `https://${instanceDomain}/ap/users/${(post as any).author_id}/inbox`;
      await store.createApDeliveryQueueItem({
        id: crypto.randomUUID(),
        activity_id: ap_activity_id,
        target_inbox_url: postAuthorInbox,
        status: "pending",
        created_at: new Date(),
      });
    }

    // Enqueue delivery to followers (optimized)
    await enqueueDeliveriesToFollowers(store, user.id, ap_activity_id);

    // Keep notification for real-time UI updates
    if ((post as any).author_id !== user.id) {
      await notify(
        store,
        c.env as Bindings,
        (post as any).author_id,
        "like",
        user.id,
        "post",
        post_id,
        `${user.display_name} があなたの投稿にリアクションしました`,
      );
    }
    return ok(c, reaction, 201);
  } finally {
    await releaseStore(store);
  }
});

// POST /posts/:id/comments
posts.post("/posts/:id/comments", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const post_id = c.req.param("id");
    const post = await store.getPost(post_id);
    if (!post) return fail(c, "post not found", 404);
    if (!(await requireMember(store, (post as any).community_id, user.id))) {
      return fail(c, "forbidden", 403);
    }
    const body = await c.req.json().catch(() => ({})) as any;
    const text = (body.text || "").trim();
    if (!text) return fail(c, "text is required");

    // Generate ActivityPub URIs
    const instanceDomain = requireInstanceDomain(c.env);
    const commentId = uuid();
    const ap_object_id = getObjectUri(user.id, commentId, instanceDomain);
    const ap_activity_id = getActivityUri(
      user.id,
      `create-comment-${commentId}`,
      instanceDomain,
    );

    const comment = {
      id: commentId,
      post_id,
      author_id: user.id,
      text,
      created_at: nowISO(),
      ap_object_id,
      ap_activity_id,
    };

    // Generate and save Create Activity (Note with inReplyTo)
    const noteObject = {
      "@context": ACTIVITYSTREAMS_CONTEXT,
      type: "Note",
      id: ap_object_id,
      attributedTo: getActorUri(user.id, instanceDomain),
      content: `<p>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`,
      published: new Date(comment.created_at).toISOString(),
      inReplyTo: (post as any).ap_object_id ||
        getObjectUri((post as any).author_id, post_id, instanceDomain),
      to: [
        (post as any).broadcast_all
          ? "https://www.w3.org/ns/activitystreams#Public"
          : getActorUri((post as any).author_id, instanceDomain),
      ],
    };

    const actorUri = getActorUri(user.id, instanceDomain);
    const createActivity = {
      "@context": ACTIVITYSTREAMS_CONTEXT,
      type: "Create",
      id: ap_activity_id,
      actor: actorUri,
      object: noteObject,
      published: noteObject.published,
      to: noteObject.to,
    };

    await store.upsertApOutboxActivity({
      id: crypto.randomUUID(),
      local_user_id: user.id,
      activity_id: ap_activity_id,
      activity_type: "Create",
      activity_json: JSON.stringify(createActivity),
      object_id: ap_object_id,
      object_type: "Note",
      created_at: new Date(),
    });

    // Enqueue delivery to post author (for local inbox processing)
    if ((post as any).author_id !== user.id) {
      const postAuthorInbox = `https://${instanceDomain}/ap/users/${(post as any).author_id}/inbox`;
      await store.createApDeliveryQueueItem({
        id: crypto.randomUUID(),
        activity_id: ap_activity_id,
        target_inbox_url: postAuthorInbox,
        status: "pending",
        created_at: new Date(),
      });
    }

    // Enqueue delivery to followers (optimized)
    await enqueueDeliveriesToFollowers(store, user.id, ap_activity_id);

    // Keep notification for real-time UI updates
    if ((post as any).author_id !== user.id) {
      await notify(
        store,
        c.env as Bindings,
        (post as any).author_id,
        "comment",
        user.id,
        "post",
        post_id,
        `${user.display_name} があなたの投稿にコメントしました`,
      );
    }
    return ok(c, comment, 201);
  } finally {
    await releaseStore(store);
  }
});

// DELETE /posts/:id
posts.delete("/:id", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const post_id = c.req.param("id");
    const post = await store.getPost(post_id);
    if (!post) return fail(c, "post not found", 404);

    // Check ownership
    if ((post as any).author_id !== user.id) {
      return fail(c, "forbidden", 403);
    }

    // Generate Delete Activity
    const instanceDomain = requireInstanceDomain(c.env);
    const deleteActivityId = getActivityUri(user.id, `delete-${post_id}`, instanceDomain);
    const actorUri = getActorUri(user.id, instanceDomain);
    const postObjectId = (post as any).ap_object_id || getObjectUri(user.id, post_id, instanceDomain);

    const deleteActivity = {
      "@context": ACTIVITYSTREAMS_CONTEXT,
      type: "Delete",
      id: deleteActivityId,
      actor: actorUri,
      object: postObjectId,
      published: new Date().toISOString(),
    };

    // Save Delete Activity
    await store.upsertApOutboxActivity({
      id: crypto.randomUUID(),
      local_user_id: user.id,
      activity_id: deleteActivityId,
      activity_type: "Delete",
      activity_json: JSON.stringify(deleteActivity),
      object_id: postObjectId,
      object_type: "Note",
      created_at: new Date(),
    });

    // Enqueue delivery to followers
    await enqueueDeliveriesToFollowers(store, user.id, deleteActivityId);

    // Delete the post from database
    await store.deletePost(post_id);

    return ok(c, { deleted: true });
  } finally {
    await releaseStore(store);
  }
});

// PATCH /posts/:id
posts.patch("/:id", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const post_id = c.req.param("id");
    const post = await store.getPost(post_id);
    if (!post) return fail(c, "post not found", 404);

    // Check ownership
    if ((post as any).author_id !== user.id) {
      return fail(c, "forbidden", 403);
    }

    const body = await c.req.json().catch(() => ({})) as any;
    const updateFields: Record<string, any> = {};

    if (body.text !== undefined) updateFields.text = String(body.text || "").trim();
    if (body.media !== undefined) {
      const media = await enrichMediaDescriptions(
        store,
        normalizeMediaPayload(body.media ?? body.media_urls ?? []),
      );
      updateFields.media = media;
      updateFields.media_urls = media.map((m) => m.url);
    }
    if (body.content_warning !== undefined) {
      updateFields.content_warning = sanitizeContentWarning(body.content_warning);
    }
    if (body.sensitive !== undefined) updateFields.sensitive = !!body.sensitive;
    const previousText = (post as any).text ?? "";
    const previousMedia = (post as any).media_urls ?? [];
    if (body.pinned !== undefined) {
      const wantsPin = !!body.pinned;
      if (wantsPin && !(post as any).pinned) {
        const currentPinned = await store.countPinnedPostsByUser?.(user.id);
        if (currentPinned !== undefined && currentPinned >= MAX_PINNED_POSTS) {
          return fail(c, `pinned posts limit (${MAX_PINNED_POSTS}) reached`, 400);
        }
      }
      updateFields.pinned = wantsPin;
    }

    if (
      updateFields.text === undefined &&
      updateFields.media_urls === undefined &&
      updateFields.media === undefined &&
      updateFields.pinned === undefined &&
      updateFields.content_warning === undefined &&
      updateFields.sensitive === undefined
    ) {
      return fail(c, "no changes provided", 400);
    }

    const nextText =
      updateFields.text !== undefined
        ? String(updateFields.text || "").trim()
        : String((post as any).text || "").trim();
    const nextMedia =
      updateFields.media ??
      (Array.isArray(updateFields.media_urls)
        ? updateFields.media_urls.map((url: string) => ({ url }))
        : (post as any).media || (post as any).media_urls || []);

    if (!nextText && (!Array.isArray(nextMedia) || nextMedia.length === 0)) {
      return fail(c, "text or media is required", 400);
    }

    const diff: Record<string, any> = {};
    if (updateFields.text !== undefined && updateFields.text !== previousText) {
      diff.text = { before: previousText, after: updateFields.text };
    }
    if (
      updateFields.media_urls !== undefined &&
      JSON.stringify(updateFields.media_urls) !== JSON.stringify(previousMedia)
    ) {
      diff.media = { before: previousMedia, after: updateFields.media_urls };
    }
    if (Object.keys(diff).length > 0) {
      updateFields.edit_count = Number((post as any).edit_count ?? 0) + 1;
    }

    // Update post
    const updatedPost = await store.updatePost(post_id, updateFields);
    if (Object.keys(diff).length > 0 && store.createPostEditHistory) {
      await store.createPostEditHistory({
        id: uuid(),
        post_id,
        editor_id: user.id,
        previous_text: previousText,
        previous_media_json: JSON.stringify(previousMedia),
        diff_json: JSON.stringify(diff),
        created_at: nowISO(),
      });
    }
    const hashtags = extractHashtags((updatedPost as any).text || "");
    const mentionUsers = await resolveMentionUsers(
      store,
      extractMentions((updatedPost as any).text || ""),
    );
    const allowedMentions = await filterMentionTargets(store, user.id, mentionUsers);
    await persistPostMetadata(store, post_id, hashtags, allowedMentions);

    // Generate Update Activity
    const instanceDomain = requireInstanceDomain(c.env);
    const ap_tags = buildApTags(instanceDomain, hashtags, allowedMentions);
    const updateActivityId = getActivityUri(user.id, `update-${post_id}`, instanceDomain);
    const actorUri = getActorUri(user.id, instanceDomain);
    const noteObject = generateNoteObject(
      {
        ...updatedPost,
        media_json: JSON.stringify(updatedPost.media || updatedPost.media_urls || []),
        content_warning: (updatedPost as any).content_warning,
        sensitive: (updatedPost as any).sensitive,
        ap_tags,
      },
      { id: user.id },
      instanceDomain,
      "https",
    );

    const updateActivity = {
      "@context": ACTIVITYSTREAMS_CONTEXT,
      type: "Update",
      id: updateActivityId,
      actor: actorUri,
      object: noteObject,
      published: new Date().toISOString(),
    };

    // Save Update Activity
    await store.upsertApOutboxActivity({
      id: crypto.randomUUID(),
      local_user_id: user.id,
      activity_id: updateActivityId,
      activity_type: "Update",
      activity_json: JSON.stringify(updateActivity),
      object_id: (post as any).ap_object_id || getObjectUri(user.id, post_id, instanceDomain),
      object_type: "Note",
      created_at: new Date(),
    });

    // Enqueue delivery to followers
    await enqueueDeliveriesToFollowers(store, user.id, updateActivityId);

    return ok(c, updatedPost);
  } finally {
    await releaseStore(store);
  }
});

posts.post("/:id/pin", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const post_id = c.req.param("id");
    const post = await store.getPost(post_id);
    if (!post) return fail(c, "post not found", 404);
    if ((post as any).author_id !== user.id) return fail(c, "forbidden", 403);
    if ((post as any).pinned) return ok(c, post);
    const count = await store.countPinnedPostsByUser?.(user.id);
    if (count !== undefined && count >= MAX_PINNED_POSTS) {
      return fail(c, `pinned posts limit (${MAX_PINNED_POSTS}) reached`, 400);
    }
    const updated = await store.updatePost(post_id, { pinned: true });
    return ok(c, updated);
  } finally {
    await releaseStore(store);
  }
});

posts.post("/:id/unpin", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const post_id = c.req.param("id");
    const post = await store.getPost(post_id);
    if (!post) return fail(c, "post not found", 404);
    if ((post as any).author_id !== user.id) return fail(c, "forbidden", 403);
    const updated = await store.updatePost(post_id, { pinned: false });
    return ok(c, updated);
  } finally {
    await releaseStore(store);
  }
});

// DELETE /posts/:id/comments/:commentId
posts.delete("/:id/comments/:commentId", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const post_id = c.req.param("id");
    const comment_id = c.req.param("commentId");

    const post = await store.getPost(post_id);
    if (!post) return fail(c, "post not found", 404);

    const comment = await store.getComment(comment_id);
    if (!comment) return fail(c, "comment not found", 404);
    if ((comment as any).post_id !== post_id) return fail(c, "comment does not belong to this post", 400);

    // Check ownership
    if ((comment as any).author_id !== user.id) {
      return fail(c, "forbidden", 403);
    }

    // Generate Delete Activity
    const instanceDomain = requireInstanceDomain(c.env);
    const deleteActivityId = getActivityUri(user.id, `delete-comment-${comment_id}`, instanceDomain);
    const actorUri = getActorUri(user.id, instanceDomain);
    const commentObjectId = (comment as any).ap_object_id || getObjectUri(user.id, comment_id, instanceDomain);

    const deleteActivity = {
      "@context": ACTIVITYSTREAMS_CONTEXT,
      type: "Delete",
      id: deleteActivityId,
      actor: actorUri,
      object: commentObjectId,
      published: new Date().toISOString(),
    };

    // Save Delete Activity
    await store.upsertApOutboxActivity({
      id: crypto.randomUUID(),
      local_user_id: user.id,
      activity_id: deleteActivityId,
      activity_type: "Delete",
      activity_json: JSON.stringify(deleteActivity),
      object_id: commentObjectId,
      object_type: "Note",
      created_at: new Date(),
    });

    // Enqueue delivery to followers
    await enqueueDeliveriesToFollowers(store, user.id, deleteActivityId);

    // Delete the comment from database
    await store.deleteComment(comment_id);

    return ok(c, { deleted: true });
  } finally {
    await releaseStore(store);
  }
});

// DELETE /posts/:id/reactions/:reactionId
posts.delete("/:id/reactions/:reactionId", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const post_id = c.req.param("id");
    const reaction_id = c.req.param("reactionId");

    const post = await store.getPost(post_id);
    if (!post) return fail(c, "post not found", 404);

    const reaction = await store.getReaction(reaction_id);
    if (!reaction) return fail(c, "reaction not found", 404);
    if ((reaction as any).post_id !== post_id) return fail(c, "reaction does not belong to this post", 400);

    // Check ownership
    if ((reaction as any).user_id !== user.id) {
      return fail(c, "forbidden", 403);
    }

    // Generate Undo Activity
    const instanceDomain = requireInstanceDomain(c.env);
    const undoActivityId = getActivityUri(user.id, `undo-like-${reaction_id}`, instanceDomain);
    const actorUri = getActorUri(user.id, instanceDomain);
    const likeActivityId = (reaction as any).ap_activity_id || getActivityUri(user.id, `like-${reaction_id}`, instanceDomain);

    const undoActivity = {
      "@context": ACTIVITYSTREAMS_CONTEXT,
      type: "Undo",
      id: undoActivityId,
      actor: actorUri,
      object: {
        type: "Like",
        id: likeActivityId,
        actor: actorUri,
        object: (post as any).ap_object_id || getObjectUri((post as any).author_id, post_id, instanceDomain),
      },
      published: new Date().toISOString(),
    };

    // Save Undo Activity
    await store.upsertApOutboxActivity({
      id: crypto.randomUUID(),
      local_user_id: user.id,
      activity_id: undoActivityId,
      activity_type: "Undo",
      activity_json: JSON.stringify(undoActivity),
      object_id: likeActivityId,
      object_type: "Like",
      created_at: new Date(),
    });

    // Enqueue delivery to followers
    await enqueueDeliveriesToFollowers(store, user.id, undoActivityId);

    // Delete the reaction from database
    await store.deleteReaction(reaction_id);

    return ok(c, { deleted: true });
  } finally {
    await releaseStore(store);
  }
});

export default posts;
