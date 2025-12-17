/**
 * App API Route Handler (Workers-style TakosApp loader)
 *
 * PLAN.md 17-app-sdk-implementation.md Phase 2: Core 側 App ローダー
 *
 * /-/apps/:appId/api/* ルートで TakosApp.fetch(request, env) を実行する
 */

import { Hono } from "hono";
import type { PublicAccountBindings as Bindings, Variables } from "@takos/platform/server";
import { HttpError, releaseStore } from "@takos/platform/server";
import type { AppManifest } from "@takos/app-sdk/server";
import type { AuthContext, AuthenticatedUser } from "../lib/auth-context-model";
import { buildAuthContext, resolvePlanFromEnv } from "../lib/auth-context-model";
import { makeData } from "../data";
import { authenticateUser } from "../middleware/auth";
import { buildTakosAppEnv, loadStoredAppManifest, loadTakosApp, resolveAppBucket } from "../lib/app-sdk-loader";
import { ErrorCodes } from "../lib/error-codes";

type AppApiBindings = { Bindings: Bindings; Variables: Variables };
const appApiRouter = new Hono<AppApiBindings>();

async function ensureAppAuthContext(c: any): Promise<AuthContext> {
  const existing = c.get("authContext") as AuthContext | undefined;
  if (existing) return existing;

  const plan = resolvePlanFromEnv(c.env as any);

  const explicitUserId = (c.get("userId") as string | undefined)?.trim() || null;
  const explicitHandle = (c.get("handle") as string | undefined)?.trim() || null;
  if (explicitUserId) {
    const derivedAuthResult: AuthenticatedUser = {
      user: { id: explicitUserId, handle: explicitHandle ?? explicitUserId },
      sessionUser: { id: explicitUserId, handle: explicitHandle ?? explicitUserId },
      activeUserId: explicitUserId,
      sessionId: null,
      token: null,
      source: "jwt",
    };
    const ctx = buildAuthContext(derivedAuthResult, plan);
    c.set("authContext", ctx);
    c.set("activeUserId", ctx.userId);
    return ctx;
  }

  let store: any | null = null;
  try {
    store = makeData(c.env as any, c);
    const authResult = await authenticateUser(c, store);
    const ctx = buildAuthContext(authResult, plan);
    c.set("authContext", ctx);
    c.set("activeUserId", ctx.userId);
    if (authResult) {
      c.set("user", authResult.user);
      c.set("sessionUser", authResult.sessionUser);
    }
    return ctx;
  } catch {
    const ctx = buildAuthContext(null, plan);
    c.set("authContext", ctx);
    c.set("activeUserId", null);
    return ctx;
  } finally {
    if (store) {
      await releaseStore(store);
    }
  }
}

/**
 * GET /-/apps/:appId/manifest.json
 *
 * Returns the app manifest for the specified app.
 * This endpoint is used by app-loader.ts to load app metadata.
 */
appApiRouter.get("/:appId/manifest.json", async (c) => {
  const appId = c.req.param("appId");
  const env = c.env;

  const stored = await loadStoredAppManifest(env, appId);
  if (stored) {
    return c.json(stored);
  }

  // Fallback placeholder manifest (schema v2.0)
  const manifest: AppManifest = {
    schema_version: "2.0",
    id: appId,
    name: appId,
    version: "0.0.0",
    description: `App ${appId}`,
    basedOn: "default@0.0.0",
    modified: false,
    entry: {
      server: "dist/server.js",
      client: "dist/client.js",
      styles: "dist/styles.css",
    },
  };

  return c.json(manifest);
});

/**
 * GET /-/apps/:appId/dist/*
 *
 * Serves app build artifacts (client.bundle.js, etc.)
 * This endpoint is used by app-loader.ts to dynamically import app modules.
 */
appApiRouter.get("/:appId/dist/*", async (c) => {
  const appId = c.req.param("appId");
  const env = c.env;

  // Extract the file path (everything after /dist/)
  const fullPath = c.req.path;
  const distPathMatch = fullPath.match(/\/dist(\/.*)?$/);
  const distPath = distPathMatch?.[1]?.slice(1) || ""; // Remove leading slash

  if (!distPath) {
    throw new HttpError(400, ErrorCodes.INVALID_INPUT, "File path required", { appId });
  }

  // Try to load from R2/VFS storage
  const bucket = resolveAppBucket(env);

  if (!bucket) {
    throw new HttpError(500, ErrorCodes.CONFIGURATION_ERROR, "App storage not configured", { appId });
  }

  const fileKey = `apps/${appId}/dist/${distPath}`;

  let obj: any | null = null;
  try {
    obj = await bucket.get(fileKey);
  } catch (error) {
    console.error(`[app-api] Failed to serve dist file for ${appId}/${distPath}:`, error);
    if (error instanceof Response) throw error;
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, ErrorCodes.INTERNAL_ERROR, "Failed to load file", { appId, path: distPath });
  }

  if (!obj) {
    throw new HttpError(404, ErrorCodes.NOT_FOUND, "File not found", { appId, path: distPath });
  }

  // Determine content type based on file extension
  const ext = distPath.split(".").pop()?.toLowerCase() || "";
  const contentTypes: Record<string, string> = {
    js: "application/javascript",
    mjs: "application/javascript",
    css: "text/css",
    json: "application/json",
    html: "text/html",
    map: "application/json",
  };
  const contentType = contentTypes[ext] || "application/octet-stream";

  // Set appropriate headers
  const headers = new Headers();
  headers.set("Content-Type", contentType);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("Access-Control-Allow-Origin", "*");

  return new Response(obj.body, { headers });
});

// Main handler for all app API routes
appApiRouter.all("/:appId/api/*", async (c) => {
  const appId = c.req.param("appId");
  const env = c.env;

  await ensureAppAuthContext(c);

  const app = await loadTakosApp(appId, env);
  const manifest = await loadStoredAppManifest(env, appId);
  const appEnv = buildTakosAppEnv(c, appId, manifest);

  // Convert /-/apps/:appId/api/* -> /* for the app
  const url = new URL(c.req.url);
  const appPath = url.pathname.replace(`/-/apps/${appId}/api`, "") || "/";
  const appUrl = new URL(appPath + url.search, url.origin);
  const appRequest = new Request(appUrl, c.req.raw);

  try {
    return await app.fetch(appRequest, appEnv);
  } catch (error) {
    console.error(`[app-api] App fetch error for ${appId}:`, error);
    if (error instanceof Response) throw error;
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, ErrorCodes.HANDLER_EXECUTION_ERROR, "App handler execution failed", { appId });
  }
});

export { appApiRouter };
