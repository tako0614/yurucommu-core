import { Hono } from "hono";
import type {
  PublicAccountBindings as Bindings,
  Variables,
} from "@takos/platform/server";
import { fail, ok, releaseStore } from "@takos/platform/server";
import { makeData } from "../data";
import { auth } from "../middleware/auth";
import type {
  ApDeliveryQueueHealth,
  ApInboxQueueHealth,
  ExportQueueHealth,
  PostPlanQueueHealth,
} from "../lib/types";

const adminHealthRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const isAdminUser = (user: any, env: Bindings): boolean =>
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

const EMPTY_DELIVERY_HEALTH: ApDeliveryQueueHealth = {
  pending: 0,
  processing: 0,
  failed: 0,
  delivered: 0,
  oldest_pending_at: null,
  max_delay_ms: null,
  last_failed_at: null,
  last_error: null,
};

const EMPTY_INBOX_HEALTH: ApInboxQueueHealth = {
  pending: 0,
  processing: 0,
  failed: 0,
  processed: 0,
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

adminHealthRoutes.get("/admin/cron/health", auth, async (c) => {
  const user = c.get("user") as any;
  if (!isAdminUser(user, c.env as Bindings)) {
    return fail(c, "forbidden", 403);
  }
  const store = makeData(c.env as any, c);
  try {
    const [postPlans, exports, delivery, inbox] = await Promise.all([
      store.getPostPlanQueueHealth ? store.getPostPlanQueueHealth() : null,
      store.getExportQueueHealth ? store.getExportQueueHealth() : null,
      store.getApDeliveryQueueHealth ? store.getApDeliveryQueueHealth() : null,
      store.getApInboxQueueHealth ? store.getApInboxQueueHealth() : null,
    ]);

    return ok(c, {
      timestamp: new Date().toISOString(),
      post_plans: withSupport(postPlans, EMPTY_POST_PLAN_HEALTH),
      data_exports: withSupport(exports, EMPTY_EXPORT_HEALTH),
      activitypub: {
        delivery: withSupport(delivery, EMPTY_DELIVERY_HEALTH),
        inbox: withSupport(inbox, EMPTY_INBOX_HEALTH),
      },
    });
  } catch (error) {
    console.error("[admin] failed to build cron health summary", error);
    return fail(c, "failed_to_load_health", 500);
  } finally {
    await releaseStore(store);
  }
});

export default adminHealthRoutes;
