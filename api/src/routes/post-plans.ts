import { Hono } from "hono";
import type { PublicAccountBindings as Bindings, Variables } from "@takos/platform/server";
import {
  ok,
  fail,
  HttpError,
  nowISO,
  uuid,
  releaseStore,
} from "@takos/platform/server";
import { makeData } from "../data";
import { auth } from "../middleware/auth";
import { ErrorCodes } from "../lib/error-codes";

const postPlans = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const allowedStatuses = new Set(["draft", "scheduled", "published", "failed", "canceled"]);

function parsePlanInput(body: any, defaults: { communityId?: string | null }) {
  const type = String(body.type || "text");
  const text = String(body.text || "").trim();
  const media_urls = Array.isArray(body.media) ? body.media : Array.isArray(body.media_urls) ? body.media_urls : [];
  if (!text && media_urls.length === 0) {
    throw new HttpError(400, ErrorCodes.MISSING_REQUIRED_FIELD, "Text or media is required", {
      fields: ["text", "media"],
    });
  }
  const community_id = defaults.communityId ?? (body.community_id ? String(body.community_id) : null);
  const broadcast_all = body.broadcast_all === undefined ? true : !!body.broadcast_all;
  const visible_to_friends = broadcast_all
    ? (body.visible_to_friends === undefined ? true : !!body.visible_to_friends)
    : false;
  const scheduled_at = body.scheduled_at ? new Date(body.scheduled_at) : null;
  return {
    type,
    text,
    media_urls,
    community_id,
    broadcast_all,
    visible_to_friends,
    scheduled_at,
  };
}

async function publishPlan(
  store: ReturnType<typeof makeData>,
  env: Bindings,
  plan: any,
) {
  const user = await store.getUser(plan.author_id);
  if (!user) {
    throw new HttpError(404, ErrorCodes.USER_NOT_FOUND, "User not found", { userId: plan.author_id });
  }
  if (plan.community_id) {
    const community = await store.getCommunity(plan.community_id);
    if (!community) throw new HttpError(404, ErrorCodes.COMMUNITY_NOT_FOUND, "Community not found", { communityId: plan.community_id });
    const isMember = await store.hasMembership(plan.community_id, plan.author_id);
    if (!isMember) throw new HttpError(403, ErrorCodes.INSUFFICIENT_PERMISSIONS, "Insufficient permissions", {
      communityId: plan.community_id,
      userId: plan.author_id,
    });
  }

  const id = uuid();

  const postPayload = {
    id,
    community_id: plan.community_id,
    author_id: user.id,
    type: plan.type,
    text: plan.text,
    media_urls: plan.media_urls,
    created_at: nowISO(),
    pinned: 0,
    broadcast_all: plan.broadcast_all,
    visible_to_friends: plan.visible_to_friends,
    attributed_community_id: plan.community_id,
  };

  await store.createPost(postPayload);

  return postPayload;
}

export type PostPlanQueueResult = {
  supported: boolean;
  processed: Array<{ id: string; status: string; post_id?: string; error?: string }>;
};

export async function processPostPlanQueue(
  env: Bindings,
  options: { limit?: number } = {},
): Promise<PostPlanQueueResult> {
  const limit = options.limit ?? 10;
  const store = makeData(env as any);
  const results: Array<{ id: string; status: string; post_id?: string; error?: string }> = [];

  try {
    if (!store.listDuePostPlans || !store.updatePostPlan) {
      return { supported: false, processed: results };
    }

    const due = await store.listDuePostPlans(limit);

    for (const plan of due) {
      try {
        const post = await publishPlan(store, env, plan);
        await store.updatePostPlan!(plan.id, {
          status: "published",
          post_id: post.id,
          updated_at: nowISO(),
          last_error: null,
        });
        results.push({ id: plan.id, status: "published", post_id: post.id });
      } catch (err: any) {
        const last_error = String(err?.message || err || "unknown error");
        await store.updatePostPlan!(plan.id, {
          status: "failed",
          last_error,
          updated_at: nowISO(),
        });
        results.push({ id: plan.id, status: "failed", error: last_error });
      }
    }

    return { supported: true, processed: results };
  } finally {
    await releaseStore(store);
  }
}

// POST /post-plans (create draft or scheduled)
postPlans.post("/post-plans", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    if (!store.createPostPlan) {
      return fail(c, "post plans not supported", 501);
    }
    const user = c.get("user") as any;
    const body = (await c.req.json().catch(() => ({}))) as any;
    const parsed = parsePlanInput(body, { communityId: null });
    const status =
      body.status && allowedStatuses.has(String(body.status))
        ? String(body.status)
        : parsed.scheduled_at
          ? "scheduled"
          : "draft";
    if (parsed.community_id) {
      const community = await store.getCommunity(parsed.community_id);
      if (!community) return fail(c, "Community not found", 404, { code: ErrorCodes.COMMUNITY_NOT_FOUND, details: { communityId: parsed.community_id } });
      if (!(await store.hasMembership(parsed.community_id, user.id))) {
        return fail(c, "Insufficient permissions", 403, { code: ErrorCodes.INSUFFICIENT_PERMISSIONS, details: { communityId: parsed.community_id } });
      }
    }
    const plan = await store.createPostPlan({
      id: uuid(),
      author_id: user.id,
      community_id: parsed.community_id,
      type: parsed.type,
      text: parsed.text,
      media_urls: parsed.media_urls,
      broadcast_all: parsed.broadcast_all,
      visible_to_friends: parsed.visible_to_friends,
      attributed_community_id: parsed.community_id,
      scheduled_at: parsed.scheduled_at ? parsed.scheduled_at.toISOString() : null,
      status,
      created_at: nowISO(),
      updated_at: nowISO(),
    });
    return ok(c, plan, 201);
  } catch (error: any) {
    if (error instanceof HttpError) {
      return fail(c, error.message, error.status, { code: error.code, details: error.details, headers: error.headers });
    }
    throw error;
  } finally {
    await releaseStore(store);
  }
});

// GET /post-plans
postPlans.get("/post-plans", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    if (!store.listPostPlansByUser) {
      return fail(c, "post plans not supported", 501);
    }
    const user = c.get("user") as any;
    const status = c.req.query("status");
    const list = await store.listPostPlansByUser(
      user.id,
      status && allowedStatuses.has(status) ? status : null,
    );
    return ok(c, list);
  } finally {
    await releaseStore(store);
  }
});

// GET /post-plans/:id
postPlans.get("/post-plans/:id", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    if (!store.getPostPlan) {
      return fail(c, "post plans not supported", 501);
    }
    const user = c.get("user") as any;
    const planId = c.req.param("id");
    const plan = await store.getPostPlan(planId);
    if (!plan) return fail(c, "Not found", 404, { code: ErrorCodes.NOT_FOUND, details: { planId } });
    if (plan.author_id !== user.id) return fail(c, "Forbidden", 403, { code: ErrorCodes.FORBIDDEN, details: { planId } });
    return ok(c, plan);
  } finally {
    await releaseStore(store);
  }
});

// PATCH /post-plans/:id
postPlans.patch("/post-plans/:id", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    if (!store.getPostPlan || !store.updatePostPlan) {
      return fail(c, "post plans not supported", 501);
    }
    const user = c.get("user") as any;
    const planId = c.req.param("id");
    const plan = await store.getPostPlan(planId);
    if (!plan) return fail(c, "Not found", 404, { code: ErrorCodes.NOT_FOUND, details: { planId } });
    if (plan.author_id !== user.id) return fail(c, "Forbidden", 403, { code: ErrorCodes.FORBIDDEN, details: { planId } });
    const body = (await c.req.json().catch(() => ({}))) as any;
    const fields: any = {};
    if (body.text !== undefined) fields.text = String(body.text || "");
    if (body.media !== undefined) fields.media_urls = Array.isArray(body.media) ? body.media : [];
    if (body.scheduled_at !== undefined) {
      fields.scheduled_at = body.scheduled_at ? new Date(body.scheduled_at).toISOString() : null;
      if (!fields.scheduled_at && plan.status === "scheduled") fields.status = "draft";
    }
    if (body.status && allowedStatuses.has(String(body.status))) {
      fields.status = String(body.status);
    }
    if (body.broadcast_all !== undefined) fields.broadcast_all = !!body.broadcast_all;
    if (body.visible_to_friends !== undefined) fields.visible_to_friends = !!body.visible_to_friends;
    if (body.community_id !== undefined) fields.community_id = body.community_id || null;
    if (body.type !== undefined) fields.type = String(body.type || "text");
    if (!Object.keys(fields).length) return ok(c, plan);
    fields.updated_at = nowISO();
    const updated = await store.updatePostPlan(planId, fields);
    return ok(c, updated);
  } finally {
    await releaseStore(store);
  }
});

// DELETE /post-plans/:id
postPlans.delete("/post-plans/:id", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    if (!store.getPostPlan || !store.deletePostPlan) {
      return fail(c, "post plans not supported", 501);
    }
    const user = c.get("user") as any;
    const planId = c.req.param("id");
    const plan = await store.getPostPlan(planId);
    if (!plan) return fail(c, "Not found", 404, { code: ErrorCodes.NOT_FOUND, details: { planId } });
    if (plan.author_id !== user.id) return fail(c, "Forbidden", 403, { code: ErrorCodes.FORBIDDEN, details: { planId } });
    await store.deletePostPlan(plan.id);
    return ok(c, { deleted: true });
  } finally {
    await releaseStore(store);
  }
});

// POST /post-plans/:id/publish (manual publish)
postPlans.post("/post-plans/:id/publish", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    if (!store.getPostPlan || !store.updatePostPlan) {
      return fail(c, "post plans not supported", 501);
    }
    const user = c.get("user") as any;
    const planId = c.req.param("id");
    const plan = await store.getPostPlan(planId);
    if (!plan) return fail(c, "Not found", 404, { code: ErrorCodes.NOT_FOUND, details: { planId } });
    if (plan.author_id !== user.id) return fail(c, "Forbidden", 403, { code: ErrorCodes.FORBIDDEN, details: { planId } });
    const post = await publishPlan(store, c.env as Bindings, plan);
    await store.updatePostPlan(planId, {
      status: "published",
      post_id: post.id,
      updated_at: nowISO(),
    });
    return ok(c, post);
  } catch (error: any) {
    if (error instanceof HttpError) {
      return fail(c, error.message, error.status, { code: error.code, details: error.details, headers: error.headers });
    }
    throw error;
  } finally {
    await releaseStore(store);
  }
});

// Cron/queue endpoint for scheduled posts
postPlans.post("/internal/tasks/process-post-plans", async (c) => {
  const secret = c.env.CRON_SECRET;
  const headerSecret = c.req.header("Cron-Secret");
  if (secret && secret !== headerSecret) {
    return fail(c as any, "Unauthorized", 401, { code: ErrorCodes.UNAUTHORIZED });
  }
  const result = await processPostPlanQueue(c.env as Bindings, { limit: 10 });
  if (!result.supported) {
    return fail(c as any, "post plans not supported", 501);
  }
  return ok(c as any, result);
});

export default postPlans;
