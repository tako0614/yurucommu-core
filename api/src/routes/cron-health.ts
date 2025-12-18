import { Hono } from "hono";
import type {
  PublicAccountBindings as Bindings,
  Variables,
} from "@takos/platform/server";
import { fail, ok, releaseStore } from "@takos/platform/server";
import { makeData } from "../data";
import { auth } from "../middleware/auth";
import { ErrorCodes } from "../lib/error-codes";
import type {
  ExportQueueHealth,
  PostPlanQueueHealth,
} from "../lib/types";

const cronHealthRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const isAuthenticated = (user: any, env: Bindings): boolean =>
  !!env.AUTH_USERNAME && user?.id === env.AUTH_USERNAME;

const EMPTY_POST_PLAN_HEALTH: PostPlanQueueHealth = {
  scheduled: 0,
  due: 0,
  failed: 0,
  oldest_due_at: null,
  max_delay_ms: null,
  last_failed_at: null,
  last_error: null,
};

const EMPTY_EXPORT_HEALTH: ExportQueueHealth = {
  pending: 0,
  processing: 0,
  failed: 0,
  completed: 0,
  oldest_pending_at: null,
  max_delay_ms: null,
  last_failed_at: null,
  last_error: null,
};

const withSupport = <T>(
  data: T | null | undefined,
  fallback: T,
): T & { supported: boolean } => ({
  supported: !!data,
  ...(data ?? fallback),
});

cronHealthRoutes.get("/api/cron/health", auth, async (c) => {
  const user = c.get("user") as any;
  if (!isAuthenticated(user, c.env as Bindings)) {
    return fail(c, "Forbidden", 403, { code: ErrorCodes.FORBIDDEN });
  }
  const store = makeData(c.env as any, c);
  try {
    const [postPlans, exports] = await Promise.all([
      store.getPostPlanQueueHealth ? store.getPostPlanQueueHealth() : null,
      store.getExportQueueHealth ? store.getExportQueueHealth() : null,
    ]);

    return ok(c, {
      timestamp: new Date().toISOString(),
      post_plans: withSupport(postPlans, EMPTY_POST_PLAN_HEALTH),
      data_exports: withSupport(exports, EMPTY_EXPORT_HEALTH),
    });
  } catch (error) {
    console.error("[owner] failed to build cron health summary", error);
    return fail(c, "failed_to_load_health", 500);
  } finally {
    await releaseStore(store);
  }
});

export default cronHealthRoutes;
