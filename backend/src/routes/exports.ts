import { Hono } from "hono";
import type { PublicAccountBindings as Bindings, Variables } from "@takos/platform/server";
import { ok, fail, uuid, nowISO, releaseStore } from "@takos/platform/server";
import { makeData } from "../data";
import { auth } from "../middleware/auth";

const exportsRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// POST /exports - enqueue data export
exportsRoute.post("/exports", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    if (!store.createExportRequest) {
      return fail(c, "data export not supported", 501);
    }
    const user = c.get("user") as any;
    const body = (await c.req.json().catch(() => ({}))) as any;
    const format = body.format === "activitypub" ? "activitypub" : "json";
    const request = await store.createExportRequest({
      id: uuid(),
      user_id: user.id,
      format,
      status: "pending",
      requested_at: nowISO(),
    });
    return ok(c, request, 202);
  } finally {
    await releaseStore(store);
  }
});

// GET /exports - list requests for user
exportsRoute.get("/exports", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    if (!store.listExportRequestsByUser) {
      return fail(c, "data export not supported", 501);
    }
    const user = c.get("user") as any;
    const list = await store.listExportRequestsByUser(user.id);
    return ok(c, list);
  } finally {
    await releaseStore(store);
  }
});

// GET /exports/:id
exportsRoute.get("/exports/:id", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    if (!store.getExportRequest) {
      return fail(c, "data export not supported", 501);
    }
    const user = c.get("user") as any;
    const request = await store.getExportRequest(c.req.param("id"));
    if (!request) return fail(c, "export not found", 404);
    if (request.user_id !== user.id) return fail(c, "forbidden", 403);
    return ok(c, request);
  } finally {
    await releaseStore(store);
  }
});

async function buildExportPayload(
  store: ReturnType<typeof makeData>,
  userId: string,
) {
  const profile = await store.getUser(userId);
  const posts = await store.listPostsByAuthors([userId], true);
  const friendships = await store.listFriends(userId);
  const reactions = store.listReactionsByUser
    ? await store.listReactionsByUser(userId)
    : [];
  const bookmarks = store.listBookmarksByUser
    ? await store.listBookmarksByUser(userId)
    : [];
  return {
    generated_at: nowISO(),
    profile,
    posts,
    friendships,
    reactions,
    bookmarks,
  };
}

// Cron/queue endpoint for export processing
exportsRoute.post("/internal/tasks/process-exports", async (c) => {
  const secret = c.env.CRON_SECRET;
  const headerSecret = c.req.header("Cron-Secret");
  if (secret && secret !== headerSecret) {
    return fail(c as any, "unauthorized", 401);
  }
  const store = makeData(c.env as any, c);
  try {
    if (!store.listPendingExportRequests || !store.updateExportRequest) {
      return fail(c as any, "data export not supported", 501);
    }
    const pending = await store.listPendingExportRequests(5);
    const results = [];
    for (const request of pending) {
      try {
        await store.updateExportRequest!(request.id, { status: "processing" });
        const payload = await buildExportPayload(store, request.user_id);
        await store.updateExportRequest!(request.id, {
          status: "completed",
          processed_at: nowISO(),
          result_json: JSON.stringify(payload),
        });
        results.push({ id: request.id, status: "completed" });
      } catch (err: any) {
        await store.updateExportRequest!(request.id, {
          status: "failed",
          error_message: String(err?.message || err || "unknown error"),
          processed_at: nowISO(),
        });
        results.push({ id: request.id, status: "failed" });
      }
    }
    return ok(c as any, { processed: results });
  } finally {
    await releaseStore(store);
  }
});

export default exportsRoute;
