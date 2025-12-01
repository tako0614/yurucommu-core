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
import { requireInstanceDomain, getActorUri } from "@takos/platform/server";
import { auth } from "../middleware/auth";

const stories = new Hono<{ Bindings: Bindings; Variables: Variables }>();

let lastStoryCleanupRunMs = 0;

// Helper: check community membership
async function requireMember(
  store: ReturnType<typeof makeData>,
  communityId: string | null | undefined,
  userId: string,
  env: any,
): Promise<boolean> {
  if (!communityId) return true;
  const localMember = await store.hasMembership(communityId, userId);
  if (localMember) return true;
  const instanceDomain = requireInstanceDomain(env as any);
  const actorUri = getActorUri(userId, instanceDomain);
  const follower = await store.findApFollower?.(`group:${communityId}`, actorUri).catch(() => null);
  return follower?.status === "accepted";
}

// Helper: check role
async function requireRole(
  store: ReturnType<typeof makeData>,
  communityId: string,
  userId: string,
  roles: string[],
  env: any,
): Promise<boolean> {
  const list = await store.listMembershipsByCommunity(communityId);
  const m = (list as any[]).find((x) => (x as any).user_id === userId);
  if (m) return roles.includes((m as any).role);
  const isMember = await requireMember(store, communityId, userId, env);
  if (!isMember) return false;
  return roles.includes("Member") || roles.includes("member");
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
    env: Bindings;
  },
): Promise<StoryInput> {
  const { communityId, allowBodyCommunityOverride, env } = options;
  let targetCommunityId = communityId ?? null;

  if (allowBodyCommunityOverride && body.community_id) {
    targetCommunityId = String(body.community_id);
  }

  if (targetCommunityId) {
    const community = await store.getCommunity(targetCommunityId);
    if (!community) throw new HttpError(404, "community not found");
    if (!(await requireMember(store, targetCommunityId, user.id, env))) {
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

export type StoryCleanupResult = {
  deleted: number;
  checked: number;
  ranAt: string;
  skipped?: boolean;
  reason?: string;
  lastRun?: string | null;
};

export async function cleanupExpiredStories(
  env: Bindings,
  options: { limit?: number; force?: boolean; throttleMs?: number; publishDeletes?: boolean } = {},
): Promise<StoryCleanupResult> {
  const limit = options.limit ?? 50;
  const throttleMs = options.throttleMs ?? 15 * 60 * 1000;
  const now = Date.now();
  const lastRun = lastStoryCleanupRunMs ? new Date(lastStoryCleanupRunMs).toISOString() : null;

  if (!options.force && throttleMs > 0 && now - lastStoryCleanupRunMs < throttleMs) {
    return {
      deleted: 0,
      checked: 0,
      ranAt: new Date(now).toISOString(),
      skipped: true,
      reason: "throttled",
      lastRun,
    };
  }

  const store = makeData(env as any);
  try {
    if (!store.queryRaw || !store.getStory || !store.deleteStory) {
      return {
        deleted: 0,
        checked: 0,
        ranAt: new Date(now).toISOString(),
        skipped: true,
        reason: "stories not supported",
        lastRun,
      };
    }

    const cutoff = new Date().toISOString();
    const expired = await store.queryRaw<{ id: string }>(
      `SELECT id FROM stories WHERE expires_at <= ? ORDER BY expires_at ASC LIMIT ?`,
      cutoff,
      limit,
    );

    let deleted = 0;
    for (const storyRow of expired) {
      const story = await store.getStory(storyRow.id);
      if (!story) continue;
      if (options.publishDeletes !== false) {
        try {
          await publishStoryDelete(env, story);
        } catch (error) {
          console.warn("failed to publish story delete for expired story", {
            id: storyRow.id,
            error,
          });
        }
      }
      await store.deleteStory(storyRow.id);
      deleted += 1;
    }

    lastStoryCleanupRunMs = now;

    return {
      deleted,
      checked: expired.length,
      ranAt: new Date(now).toISOString(),
      lastRun,
    };
  } finally {
    await releaseStore(store);
  }
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
      env: c.env,
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
stories.post("/stories", auth, async (c) => {
  const store = makeData(c.env, c);
  try {
    const user = c.get("user") as any;
    const body = await c.req.json().catch(() => ({})) as any;
    const story = await buildStoryPayload(store, user, body, { env: c.env });
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
stories.get("/stories", auth, async (c) => {
  const store = makeData(c.env, c);
  try {
    const user = c.get("user") as any;
    void cleanupExpiredStories(c.env as Bindings, {
      publishDeletes: false,
      throttleMs: 10 * 60 * 1000,
    });
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
    if (!(await requireMember(store, community_id, user.id, c.env))) {
      return fail(c, "forbidden", 403);
    }
    void cleanupExpiredStories(c.env as Bindings, {
      publishDeletes: false,
      throttleMs: 10 * 60 * 1000,
    });
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
stories.get("/stories/:id", auth, async (c) => {
  const store = makeData(c.env, c);
  try {
    const user = c.get("user") as any;
    const id = c.req.param("id");
    const story = (await store.getStory(id)) as Story | null;
    if (!story) return fail(c, "story not found", 404);
    if (story.community_id) {
      if (!(await requireMember(store, story.community_id, user.id, c.env))) {
        return fail(c, "forbidden", 403);
      }
    } else if (story.author_id !== user.id) {
      const visibleToFriends = (story as any).visible_to_friends ?? true;
      if (!visibleToFriends) {
        return fail(c, "forbidden", 403);
      }
      const areFriends = await store
        .areFriends(user.id, story.author_id)
        .catch(() => false);
      if (!areFriends) {
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
stories.patch("/stories/:id", auth, async (c) => {
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
          ], c.env)
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
stories.delete("/stories/:id", auth, async (c) => {
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
          ], c.env)
        : false);
    if (!privileged) return fail(c, "forbidden", 403);
    await store.deleteStory(id);
    await publishStoryDelete(c.env, story);
    return ok(c, { id, deleted: true });
  } finally {
    await releaseStore(store);
  }
});

stories.post("/internal/tasks/cleanup-stories", async (c) => {
  const secret = c.env.CRON_SECRET;
  const headerSecret = c.req.header("Cron-Secret");
  if (secret && secret !== headerSecret) {
    return fail(c as any, "unauthorized", 401);
  }
  const result = await cleanupExpiredStories(c.env as Bindings, {
    limit: 100,
    force: true,
  });
  if (result.skipped) {
    return fail(c as any, result.reason || "cleanup skipped", 503);
  }
  return ok(c as any, result);
});

export default stories;
