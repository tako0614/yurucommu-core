/**
 * App Manifest API
 *
 * PLAN.md 5.4 に基づく App Manifest の配信エンドポイント
 */

import { Hono } from "hono";
import type { PublicAccountBindings as Bindings } from "@takos/platform/server";
import { fail } from "@takos/platform/server";
import { loadActiveAppManifest } from "../lib/manifest-routing";
import { optionalAuth } from "../middleware/auth";

const app = new Hono<{ Bindings: Bindings }>();

/**
 * App Manifest の取得
 *
 * GET /-/app/manifest
 *
 * takos-app.json と app/ 以下の *.json をマージして返す
 */
app.get("/", optionalAuth, async (c) => {
  try {
    const result = await loadActiveAppManifest(c.env as Bindings, {
      loadScript: true,
      validateHandlers: true,
    });

    if (!result.snapshot) {
      return fail(c as any, "active app revision not found", 404);
    }

    const hasErrors = result.issues.some((issue) => issue.severity === "error");
    const status = hasErrors ? 503 : 200;
    return c.json(
      {
        ok: !hasErrors,
        revision_id: result.snapshot.revisionId,
        script_ref: result.snapshot.scriptRef ?? null,
        manifest: result.snapshot.manifest,
        source: result.snapshot.source,
        issues: result.issues ?? [],
        handlers: result.registry?.list?.() ?? [],
      },
      status,
    );
  } catch (err) {
    console.error("Failed to load app manifest:", err);
    return fail(c, "Failed to load app manifest", 500);
  }
});

export default app;
