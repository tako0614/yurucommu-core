// Story-related routes

import { Hono } from "hono";
import type { Story, StoryItem } from "@takos/platform";
import {
  DEFAULT_IMAGE_DURATION_MS,
  DEFAULT_TEXT_DURATION_MS,
  DEFAULT_VIDEO_DURATION_MS,
  normalizeStoryItems,
} from "@takos/platform";
import type { StoryInput } from "../lib/types";
import type {
  PublicAccountBindings as Bindings,
  Variables,
} from "@takos/platform/server";
import { makeData } from "../data";
import { 
  ok, 
  fail, 
  nowISO, 
  uuid, 
  addHours, 
  HttpError, 
  releaseStore,
  publishStoryCreate,
  publishStoryDelete
} from "@takos/platform/server";
import { auth } from "../middleware/auth";

const stories = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Helper: check community membership
async function requireMember(
  store: ReturnType<typeof makeData>,
  communityId: string | null | undefined,
  userId: string,
): Promise<boolean> {
  if (!communityId) return true;
  return await store.hasMembership(communityId, userId);
}

// Helper: check role
async function requireRole(
  store: ReturnType<typeof makeData>,
  communityId: string,
  userId: string,
  roles: string[],
): Promise<boolean> {
  const list = await store.listMembershipsByCommunity(communityId);
  const m = (list as any[]).find((x) => (x as any).user_id === userId);
  if (!m) return false;
  return roles.includes((m as any).role);
}

const defaultDurationForItem = (item: StoryItem) => {
  switch (item.type) {
    case "video":
      return DEFAULT_VIDEO_DURATION_MS;
    case "text":
      return DEFAULT_TEXT_DURATION_MS;
    default:
      return DEFAULT_IMAGE_DURATION_MS;
  }
};

const sanitizeStoryItems = (rawItems: unknown): StoryItem[] => {
  const normalized = normalizeStoryItems(rawItems);
  if (!normalized.length) {
    throw new HttpError(400, "items is required");
  }
  return normalized.map((item, index) => ({
    ...item,
    id: item.id || crypto.randomUUID(),
    durationMs: item.durationMs ?? defaultDurationForItem(item),
    order: typeof item.order === "number" ? item.order : index,
  }));
};

// Helper: build story payload
async function buildStoryPayload(
  store: ReturnType<typeof makeData>,
  user: any,
  body: any,
  options: {
    communityId?: string | null;
    allowBodyCommunityOverride?: boolean;
  } = {}
): Promise<StoryInput> {
  const { communityId, allowBodyCommunityOverride } = options;
  let targetCommunityId = communityId ?? null;

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

  const items = sanitizeStoryItems(body.items);

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
  const created_at = nowISO();
  const expires_at = addHours(new Date(), 24).toISOString();

  return {
    id,
    community_id: targetCommunityId ?? null,
    author_id: user.id,
    created_at,
    expires_at,
    items,
    broadcast_all: broadcastAll,
    visible_to_friends: visibleToFriends,
    attributed_community_id: targetCommunityId ?? null,
  };
}

function cleanupExpiredStories() {
  /* read-time filter only */
}

// POST /communities/:id/stories
stories.post("/communities/:id/stories", auth, async (c) => {
  const store = makeData(c.env, c);
  try {
    const user = c.get("user") as any;
    const community_id = c.req.param("id");
    const body = await c.req.json().catch(() => ({})) as any;
    const story = await buildStoryPayload(store, user, body, {
      communityId: community_id,
      allowBodyCommunityOverride: false,
    });
    await store.createStory(story);
    await publishStoryCreate(c.env, story);
    return ok(c, story, 201);
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      return fail(c, error.message, error.status);
    }
    console.error("create story failed", error);
    return fail(c, "failed to create story", 500);
  } finally {
    await releaseStore(store);
  }
});

// POST /stories
stories.post("/", auth, async (c) => {
  const store = makeData(c.env, c);
  try {
    const user = c.get("user") as any;
    const body = await c.req.json().catch(() => ({})) as any;
    const story = await buildStoryPayload(store, user, body);
    await store.createStory(story);
    await publishStoryCreate(c.env, story);
    return ok(c, story, 201);
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      return fail(c, error.message, error.status);
    }
    console.error("create story failed", error);
    return fail(c, "failed to create story", 500);
  } finally {
    await releaseStore(store);
  }
});

// GET /stories
stories.get("/", auth, async (c) => {
  const store = makeData(c.env, c);
  try {
    const user = c.get("user") as any;
    cleanupExpiredStories();
    let list: any[] = await store.listGlobalStoriesForUser(user.id);
    const now = Date.now();
    list = list.filter((s) => Date.parse((s as any).expires_at) > now);
    list.sort((a, b) => ((a as any).created_at < (b as any).created_at ? 1 : -1));
    return ok(c, list);
  } finally {
    await releaseStore(store);
  }
});

// GET /communities/:id/stories
stories.get("/communities/:id/stories", auth, async (c) => {
  const store = makeData(c.env, c);
  try {
    const user = c.get("user") as any;
    const community_id = c.req.param("id");
    const community = await store.getCommunity(community_id);
    if (!community) return fail(c, "community not found", 404);
    if (!(await requireMember(store, community_id, user.id))) {
      return fail(c, "forbidden", 403);
    }
    cleanupExpiredStories();
    let list: any[] = await store.listStoriesByCommunity(community_id);
    const now = Date.now();
    list = list.filter((s) => Date.parse((s as any).expires_at) > now);
    list.sort((a, b) => ((a as any).created_at < (b as any).created_at ? 1 : -1));
    return ok(c, list);
  } finally {
    await releaseStore(store);
  }
});

// GET /stories/:id
stories.get("/:id", auth, async (c) => {
  const store = makeData(c.env, c);
  try {
    const user = c.get("user") as any;
    const id = c.req.param("id");
    const story = (await store.getStory(id)) as Story | null;
    if (!story) return fail(c, "story not found", 404);
    if (story.community_id) {
      if (!(await requireMember(store, story.community_id, user.id))) {
        return fail(c, "forbidden", 403);
      }
    } else if (story.author_id !== user.id) {
      const visibleToFriends = (story as any).visible_to_friends ?? true;
      if (!visibleToFriends) {
        return fail(c, "forbidden", 403);
      }
      const relation = await store
        .getFriendshipBetween(user.id, story.author_id)
        .catch(() => null);
      if (!relation || relation.status !== "accepted") {
        return fail(c, "forbidden", 403);
      }
    }
    const expiry = story.expires_at instanceof Date
      ? story.expires_at
      : new Date(story.expires_at);
    if (expiry.getTime() <= Date.now()) {
      return fail(c, "expired", 404);
    }
    return ok(c, story);
  } finally {
    await releaseStore(store);
  }
});

// PATCH /stories/:id
stories.patch("/:id", auth, async (c) => {
  const store = makeData(c.env, c);
  try {
    const user = c.get("user") as any;
    const id = c.req.param("id");
    const story = (await store.getStory(id)) as Story | null;
    if (!story) return fail(c, "story not found", 404);
    const privileged =
      story.author_id === user.id ||
      (story.community_id
        ? await requireRole(store, story.community_id, user.id, [
            "Owner",
            "Moderator",
          ])
        : false);
    if (!privileged) return fail(c, "forbidden", 403);
    const body = await c.req.json().catch(() => ({})) as any;
    let newItems: StoryItem[] | null = null;
    if (Array.isArray(body.items)) {
      newItems = sanitizeStoryItems(body.items);
    }
    const updates: Record<string, any> = {};
    if (newItems) updates.items = newItems;
    if (body.extendHours && Number(body.extendHours) > 0) {
      const newExp = addHours(new Date(), Number(body.extendHours));
      updates.expires_at = newExp.toISOString();
    }
    if (body.audience !== undefined) {
      const nextAudience =
        String(body.audience) === "community" ? "community" : "all";
      const nextBroadcastAll = nextAudience === "all";
      updates.broadcast_all = nextBroadcastAll;
      updates.visible_to_friends = nextBroadcastAll
        ? (body.visible_to_friends === undefined
            ? true
            : !!body.visible_to_friends)
        : false;
    } else if (body.visible_to_friends !== undefined) {
      const currentBroadcastAll = !!(story as any).broadcast_all;
      updates.visible_to_friends = currentBroadcastAll
        ? !!body.visible_to_friends
        : false;
    }
    const updated = Object.keys(updates).length
      ? await store.updateStory(id, updates)
      : story;
    await publishStoryCreate(c.env, updated);
    return ok(c, updated);
  } finally {
    await releaseStore(store);
  }
});

// DELETE /stories/:id
stories.delete("/:id", auth, async (c) => {
  const store = makeData(c.env, c);
  try {
    const user = c.get("user") as any;
    const id = c.req.param("id");
    const story = (await store.getStory(id)) as Story | null;
    if (!story) return fail(c, "story not found", 404);
    const privileged =
      story.author_id === user.id ||
      (story.community_id
        ? await requireRole(store, story.community_id, user.id, [
            "Owner",
            "Moderator",
          ])
        : false);
    if (!privileged) return fail(c, "forbidden", 403);
    await store.deleteStory(id);
    await publishStoryDelete(c.env, story);
    return ok(c, { id, deleted: true });
  } finally {
    await releaseStore(store);
  }
});

export default stories;
