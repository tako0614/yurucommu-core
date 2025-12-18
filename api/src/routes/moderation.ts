import { Hono } from "hono";
import type {
  PublicAccountBindings as Bindings,
  Variables,
} from "@takos/platform/server";
import {
  ok,
  fail,
  nowISO,
  uuid,
  releaseStore,
} from "@takos/platform/server";
import { makeData } from "../data";
import { auth } from "../middleware/auth";
import { ErrorCodes } from "../lib/error-codes";

const moderation = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const REPORT_STATUSES = new Set(["pending", "reviewed", "resolved", "dismissed"]);
const REPORT_CATEGORIES = new Set([
  "spam",
  "harassment",
  "abuse",
  "policy",
  "copyright",
  "other",
]);

function isAdminUser(user: any, env: Bindings): boolean {
  return !!env.AUTH_USERNAME && user?.id === env.AUTH_USERNAME;
}

moderation.post("/reports", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    if (!store.createReport) return fail(c, "reports not available", 500);
    const user = c.get("user") as any;
    const body = (await c.req.json().catch(() => ({}))) as any;
    const targetType = String(body.target_type || "").toLowerCase();
    const targetId = String(body.target_id || "").trim();
    if (!targetType || !targetId) return fail(c, "target_type and target_id are required", 400);
    const categoryRaw = typeof body.category === "string" ? body.category.toLowerCase().trim() : "";
    const category = REPORT_CATEGORIES.has(categoryRaw) ? categoryRaw : "other";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";

    let targetActorId: string | null = null;
    let targetObjectId: string | null = null;

    if (targetType === "user") {
      const targetUser = await store.getUser(targetId);
      if (!targetUser) return fail(c, "target not found", 404);
      targetActorId = targetUser.id;
    } else if (targetType === "post") {
      const post = await store.getPost(targetId);
      if (!post) return fail(c, "target not found", 404);
      targetActorId = (post as any).author_id;
      targetObjectId = (post as any).id;
    } else if (targetType === "comment") {
      const comment = await store.getComment(targetId);
      if (!comment) return fail(c, "target not found", 404);
      targetActorId = (comment as any).author_id;
      targetObjectId = (comment as any).id;
    } else {
      return fail(c, "invalid target_type", 400);
    }

    const created = await store.createReport({
      id: uuid(),
      reporter_actor_id: user.id,
      target_actor_id: targetActorId!,
      target_object_id: targetObjectId,
      category,
      reason,
      status: "pending",
      created_at: nowISO(),
      updated_at: nowISO(),
    });

    return ok(c, created, 201);
  } finally {
    await releaseStore(store);
  }
});

// GET /reports - User's own reports
moderation.get("/reports", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    if (!store.listReportsByUser) return fail(c, "reports not available", 500);
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "20", 10)));
    const offset = Math.max(0, parseInt(c.req.query("offset") || "0", 10));
    const reports = await store.listReportsByUser(user.id, limit, offset);
    return ok(c, reports);
  } finally {
    await releaseStore(store);
  }
});

moderation.get("/admin/reports", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    if (!isAdminUser(user, c.env as Bindings)) return fail(c, "Forbidden", 403, { code: ErrorCodes.FORBIDDEN });
    if (!store.listReports) return fail(c, "reports not available", 500);
    const status = c.req.query("status") || undefined;
    if (status && !REPORT_STATUSES.has(status)) {
      return fail(c, "invalid status", 400);
    }
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "20", 10)));
    const offset = Math.max(0, parseInt(c.req.query("offset") || "0", 10));
    const reports = await store.listReports(status, limit, offset);
    return ok(c, reports);
  } finally {
    await releaseStore(store);
  }
});

moderation.patch("/admin/reports/:id", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    if (!isAdminUser(user, c.env as Bindings)) return fail(c, "Forbidden", 403, { code: ErrorCodes.FORBIDDEN });
    if (!store.updateReportStatus) return fail(c, "reports not available", 500);
    const reportId = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as any;
    const status = typeof body.status === "string" ? body.status.trim() : "";
    if (!REPORT_STATUSES.has(status)) {
      return fail(c, "invalid status", 400);
    }
    await store.updateReportStatus(reportId, status);
    return ok(c, { id: reportId, status });
  } finally {
    await releaseStore(store);
  }
});

export default moderation;
