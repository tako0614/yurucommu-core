import { Hono } from "hono";
import {
  getDefaultDataFactory,
  makeData,
  setBackendDataFactory,
} from "./data";
import type { DataFactory } from "./data";
import { getPrisma } from "./prisma";
import { notify as notifyBase } from "./lib/notifications";
import {
  ensureDatabase as ensureDatabaseDefault,
  handleIncomingDm,
  handleIncomingChannelMessage,
  getChannelMessages,
  getActorUri,
  requireInstanceDomain,
  releaseStore,
  withStore,
  createUserJWT,
  authenticateJWT,
  resolveDevDataIsolation,
  setDataFactory,
  setPrismaFactory,
  setInstanceConfig,
  ok,
  fail,
  HttpError,
} from "@takos/platform/server";
import { createJwtStoreAdapter } from "./lib/jwt-store";
import type {
  PublicAccountBindings as Bindings,
  Variables,
  PrismaEnv,
  DevDataIsolationResult,
} from "@takos/platform/server";
import {
  authenticateSession,
  createUserSession,
  getSessionCookieName,
  getSessionTtlSeconds,
} from "@takos/platform/server/session";
import { setCookie } from "hono/cookie";
/// <reference types="@cloudflare/workers-types" />

// Import route modules
import usersRoutes from "./routes/users";
import communitiesRoutes from "./routes/communities";
import postsRoutes from "./routes/posts";
import storiesRoutes, { cleanupExpiredStories } from "./routes/stories";
import chatRoutes from "./routes/chat";
import moderationRoutes from "./routes/moderation";
import realtimeRoutes from "./routes/realtime";
import listsRoutes from "./routes/lists";
import postPlansRoutes, { processPostPlanQueue } from "./routes/post-plans";
import exportsRoutes, { processExportQueue } from "./routes/exports";
import pushRoutes from "./routes/push";
import aiConfigRoutes from "./routes/ai-config";
import aiChatRoutes from "./routes/ai-chat";
import aiRoutes from "./routes/ai";
import aiWorkflowsRoutes from "./routes/ai-workflows";
import aiProposalsRoutes from "./routes/ai-proposals";
import activityPubConfigRoutes from "./routes/activitypub-config";
import configRoutes from "./routes/config";
import appPreviewRoutes from "./routes/app-preview";
import appDebugRoutes from "./routes/app-debug";
import appManagerRoutes from "./routes/app-manager";
import appVfsRoutes from "./routes/app-vfs";
import appCompileRoutes from "./routes/app-compile";
import appIdeRoutes from "./routes/app-ide";
import appValidateRoutes from "./routes/app-validate";
import appVersionsRoutes from "./routes/app-versions";
import { appApiRouter } from "./routes/app-api";
import cronHealthRoutes from "./routes/cron-health";
import coreRecoveryRoutes from "./routes/core-recovery";
import appManifestRoutes from "./routes/app-manifest";
import objectsRoutes from "./routes/objects";
import appRpcRoutes from "./routes/app-rpc";
import internalMeteringRoutes from "./routes/internal-metering";
// takos-config.ts is deprecated; config routes are now unified in config.ts per PLAN.md 5.3
import { getTakosConfig } from "./lib/runtime-config";
import {
  isManifestRoutingEnabled,
  matchesManifestRoute,
  resolveManifestRouter,
} from "./lib/manifest-routing";
import { buildAuthContext, resolvePlanFromEnv, type AuthContext } from "./lib/auth-context-model";
import { requireApDeliveryQuota } from "./lib/plan-guard";
import { checkStorageQuota } from "./lib/storage-quota";
import {
  ACTIVE_USER_COOKIE_NAME,
  auth,
  authenticateUser,
} from "./middleware/auth";
import { legacyRedirectMiddleware } from "./middleware/legacy-redirect";
import { logEvent, mapErrorToResponse, requestObservability } from "./lib/observability";
// Handle validation helpers
const HANDLE_REGEX = /^[a-z0-9_]{3,32}$/;
function normalizeHandle(input: string): string {
  return (input || "").trim().toLowerCase();
}
function isValidHandle(handle: string): boolean {
  return HANDLE_REGEX.test(handle);
}
import { buildPushWellKnownPayload } from "./lib/push-check";
import {
  buildTakosAppEnv,
  buildTakosScheduledAppEnv,
  loadStoredAppManifest,
  loadTakosApp,
} from "./lib/app-sdk-loader";
import {
  getCronTasksForSchedule,
  validateCronConfig,
} from "./lib/cron-tasks";
import type { CronTaskDefinition, CronValidationResult } from "./lib/cron-tasks";
import { expireAiProposals } from "./lib/ai-proposals-cron";
import takosProfile from "../../takos-profile.json";
import { validateTakosProfile } from "./lib/profile-validator";
import { ErrorCodes } from "./lib/error-codes";

// Validate takos-profile.json on startup
const profileValidation = validateTakosProfile(takosProfile);
if (!profileValidation.ok) {
  console.error("[profile] validation failed", profileValidation.errors);
} else if (profileValidation.warnings.length > 0) {
  console.warn("[profile] validation warnings", profileValidation.warnings);
}

type EnsureDatabaseFn = (env: Bindings) => Promise<void>;


export type FeatureConfig = {
  envPasswordAuth?: boolean;
  defaultPushFallback?: boolean;
};

type InternalFeatureState = {
  envPasswordAuth: boolean;
  defaultPushFallback: boolean;
};

const defaultFeatureState: InternalFeatureState = {
  envPasswordAuth: true,
  defaultPushFallback: true,
};

let activeFeatures: InternalFeatureState = { ...defaultFeatureState };

function setFeatureConfig(features?: FeatureConfig): void {
  activeFeatures = {
    ...defaultFeatureState,
    ...(features ?? {}),
  } as InternalFeatureState;
}

function featureEnabled(key: keyof InternalFeatureState): boolean {
  return activeFeatures[key];
}

export type CreateTakosRootConfig = {
  makeData?: DataFactory;
  prismaFactory?: (env: PrismaEnv) => unknown;
  ensureDatabase?: EnsureDatabaseFn;
  features?: FeatureConfig;
  instanceDomain?: string;
};

type DefaultConfig = {
  makeData: DataFactory;
  prismaFactory: (env: PrismaEnv) => unknown;
  ensureDatabase: EnsureDatabaseFn;
  instanceDomain: string | undefined;
};

const defaultConfig: DefaultConfig = {
  makeData: getDefaultDataFactory(),
  prismaFactory: (env: PrismaEnv) => getPrisma(env.DB),
  ensureDatabase: (env: Bindings) => ensureDatabaseDefault(env.DB),
  instanceDomain: undefined,
};

let ensureDatabaseFn: EnsureDatabaseFn = defaultConfig.ensureDatabase;

function applyConfig(config: CreateTakosRootConfig = {}): void {
  const next = {
    makeData: config.makeData ?? defaultConfig.makeData,
    prismaFactory: config.prismaFactory ?? defaultConfig.prismaFactory,
    ensureDatabase: config.ensureDatabase ?? defaultConfig.ensureDatabase,
  };

  setBackendDataFactory(next.makeData);
  setDataFactory((env) => next.makeData(env));
  if (next.prismaFactory) {
    setPrismaFactory(next.prismaFactory);
  }
  ensureDatabaseFn = next.ensureDatabase;
  setFeatureConfig(config.features);
  setInstanceConfig({
    instanceDomain: config.instanceDomain,
  });
}

applyConfig();

let cronValidation: CronValidationResult | null = null;
let cronValidationPromise: Promise<CronValidationResult> | null = null;

async function ensureCronValidation(env: Bindings): Promise<CronValidationResult | null> {
  if (cronValidation) return cronValidation;
  if (!cronValidationPromise) {
    cronValidationPromise = Promise.resolve(validateCronConfig(env));
  }
  try {
    cronValidation = await cronValidationPromise;
    cronValidationPromise = null;
    for (const warning of cronValidation.warnings) {
      console.warn(`[cron] ${warning}`);
    }
    for (const error of cronValidation.errors) {
      console.error(`[cron] ${error}`);
    }
  } catch (error) {
    console.error("[cron] validation failed", error);
  }
  return cronValidation;
}

let devIsolationStatus: DevDataIsolationResult | null = null;

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use("*", requestObservability);

app.onError((error, c) => {
  const requestId = (c.get("requestId") as string | undefined) ?? undefined;
  logEvent(c, "error", "request.error", {
    message: error instanceof Error ? error.message : String(error),
  });
  return mapErrorToResponse(error, { requestId, env: c.env });
});

// Simplified CORS middleware that mirrors back the request Origin.
app.use("*", async (c, next) => {
  const requestOrigin = c.req.header("Origin") || "";
  const allowOrigin = requestOrigin || "*";
  const allowHeaders =
    c.req.header("Access-Control-Request-Headers") ||
    "Content-Type, Authorization, Accept, X-Requested-With";
  const allowMethods = "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD";
  const exposeHeaders = "Content-Type, Content-Length, ETag";

  if (c.req.method === "OPTIONS") {
    const headers = new Headers();
    headers.set("Access-Control-Allow-Origin", allowOrigin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Headers", allowHeaders);
    headers.set("Access-Control-Allow-Methods", allowMethods);
    headers.set("Access-Control-Expose-Headers", exposeHeaders);
    headers.set("Access-Control-Max-Age", "86400");
    headers.append("Vary", "Origin");
    headers.append("Vary", "Access-Control-Request-Headers");
    return new Response(null, { status: 204, headers });
  }

  await next();

  const responseHeaders = c.res.headers;
  responseHeaders.set("Access-Control-Allow-Origin", allowOrigin);
  responseHeaders.set("Access-Control-Allow-Credentials", "true");
  responseHeaders.set("Access-Control-Allow-Headers", allowHeaders);
  responseHeaders.set("Access-Control-Allow-Methods", allowMethods);
  responseHeaders.set("Access-Control-Expose-Headers", exposeHeaders);
  responseHeaders.append("Vary", "Origin");
  responseHeaders.append("Vary", "Access-Control-Request-Headers");
});

// Keep backward compatibility for renamed UI routes (docs/plan/12-routing.md).
app.use("*", legacyRedirectMiddleware);

// Validate cron configuration once per worker start
app.use("*", async (c, next) => {
  await ensureCronValidation(c.env as Bindings);
  await next();
});

// Enforce dev/prod data isolation before touching data bindings
app.use("*", async (c, next) => {
  devIsolationStatus = devIsolationStatus ?? resolveDevDataIsolation(c.env as any);
  const status = devIsolationStatus;
  if (status?.required) {
    if (!status.ok) {
      console.error("[dev-data] refusing to start with prod data bindings", {
        errors: status.errors,
      });
      throw new HttpError(503, ErrorCodes.SERVICE_UNAVAILABLE, "Dev data isolation failed", {
        errors: status.errors,
      });
    }
    const env = c.env as any;
    if (status.resolved.db) {
      env.DB = status.resolved.db as any;
    }
    if (status.resolved.media) {
      env.MEDIA = status.resolved.media as any;
    }
    if (status.resolved.kv) {
      env.KV = status.resolved.kv as any;
    }
    if (status.warnings.length) {
      console.warn(`[dev-data] ${status.warnings.join("; ")}`);
    }
  }
  await next();
});

// Ensure the D1 schema exists before any handlers run
app.use("*", async (c, next) => {
  await ensureDatabaseFn(c.env);
  await next();
});

// Load takos-config (stored or runtime) and expose it on context/env
app.use("*", async (c, next) => {
  try {
    const { config, warnings } = await getTakosConfig(c.env as Bindings);
    c.set("takosConfig", config);
    (c.env as any).takosConfig = config;
    if (warnings.length) {
      console.warn(`[config] ${warnings.join("; ")}`);
    }
  } catch (error) {
    console.warn("[config] failed to resolve takos-config", error);
  }
  await next();
});

// Route API requests through manifest-defined handlers when enabled.
app.route("/", appRpcRoutes);
app.route("/", internalMeteringRoutes);

app.use("*", async (c, next) => {
  if (!isManifestRoutingEnabled(c.env as any)) {
    return next();
  }
  const router = await resolveManifestRouter(c.env as Bindings, auth);
  if (!router) {
    return next();
  }

  const pathname = new URL(c.req.url).pathname;
  const method = c.req.method.toUpperCase();
  if (!matchesManifestRoute(router, method, pathname)) {
    return next();
  }

  const response = await router.app.fetch(c.req.raw, c.env, c.executionCtx);
  return response;
});

const proxyDefaultAppStrict = async (c: any, label: string) => {
  try {
    const appId = "default";
    const appModule = await loadTakosApp(appId, c.env as any);
    const manifest = await loadStoredAppManifest(c.env as any, appId);
    const appEnv = buildTakosAppEnv(c, appId, manifest);
    return await appModule.fetch(c.req.raw, appEnv);
  } catch (error) {
    console.error(`[${label}] failed to proxy to default app`, error);
    return fail(c, "Default App unavailable", 503);
  }
};

const shouldProxyToDefaultApp = (pathname: string): boolean => {
  if (!pathname) return false;
  if (pathname === "/.well-known/takos-push.json") return false;
  if (pathname === "/.well-known/webfinger") return true;
  if (pathname === "/.well-known/nodeinfo") return true;
  if (pathname.startsWith("/nodeinfo/")) return true;
  if (pathname.startsWith("/ap/")) return true;
  return false;
};

// Proxy App-owned well-known/AP routes to the Default App.
// Core does not process ActivityPub; it only routes/proxies.
app.use("*", async (c, next) => {
  const pathname = new URL(c.req.url).pathname;
  if (!shouldProxyToDefaultApp(pathname)) {
    return next();
  }
  return proxyDefaultAppStrict(c, "default-app-proxy");
});

app.route("/", coreRecoveryRoutes);

// Mount App Manifest endpoint
app.route("/-/app/manifest", appManifestRoutes);

// Note: takos-config routes (/-/config/export, /-/config/import, /-/config/diff)
// are now handled by configRoutes (unified with /admin/config) per PLAN.md 5.3.

// Mount feature route modules
// IMPORTANT: usersRoutes and communitiesRoutes must be mounted BEFORE postsRoutes
// to prevent catch-all routes in postsRoutes from shadowing specific routes
app.route("/", usersRoutes);
app.route("/", communitiesRoutes);
app.route("/", postsRoutes);
app.route("/", storiesRoutes);
app.route("/", chatRoutes);
app.route("/", objectsRoutes);
app.route("/", moderationRoutes);
app.route("/", listsRoutes);
app.route("/", postPlansRoutes);
app.route("/", exportsRoutes);
app.route("/", pushRoutes);
app.route("/", aiConfigRoutes);
app.route("/", aiChatRoutes);
app.route("/", aiRoutes);
app.route("/ai/workflows", aiWorkflowsRoutes);
app.route("/ai/proposals", aiProposalsRoutes);
app.route("/", activityPubConfigRoutes);
app.route("/", configRoutes);
app.route("/", cronHealthRoutes);
app.route("/", appManagerRoutes);
app.route("/", appVfsRoutes);
app.route("/", appCompileRoutes);
app.route("/", appIdeRoutes);
app.route("/", appValidateRoutes);
app.route("/", appVersionsRoutes);
app.route("/-/apps", appApiRouter);
app.route("/", realtimeRoutes);
app.route("/", appPreviewRoutes);
app.route("/", appDebugRoutes);

// Root endpoint for health/checks and baseline tests
app.get("/", (c) => c.text("Hello World!"));

app.get("/.well-known/takos-push.json", (c) => {
  const wellKnown = buildPushWellKnownPayload(c.env as Bindings);
  if (!wellKnown) {
    throw new HttpError(503, ErrorCodes.SERVICE_UNAVAILABLE, "Push not configured");
  }
  const response = c.json(wellKnown);
  response.headers.set("Cache-Control", "public, max-age=300, immutable");
  return response;
});

// Helpers
const nowISO = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const addHours = (date: Date, h: number) =>
  new Date(date.getTime() + h * 3600 * 1000);

const encoder = new TextEncoder();

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return toHex(new Uint8Array(digest));
}

async function verifyPasswordValue(password: string, stored: string | null) {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 2) return false;
  const [salt, expected] = parts;
  const computed = await sha256Hex(`${salt}:${password}`);
  return subtleTimingSafeEqual(computed, expected);
}

function subtleTimingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function verifyMasterPassword(input: string, expected: string): Promise<boolean> {
  if (!input || !expected) return false;
  if (expected.includes("$")) {
    try {
      if (await verifyPasswordValue(input, expected)) {
        return true;
      }
    } catch {
      // Ignore malformed hash values and fall back to direct comparison.
    }
  }
  return subtleTimingSafeEqual(input, expected);
}

/** Ensure a default user exists for initial login */
async function ensureDefaultUser(store: ReturnType<typeof makeData>, handle: string) {
  const existing = await store.getUser(handle).catch(() => null);
  if (existing) return existing;
  return store.createUser({
    id: handle,
    display_name: handle,
    is_private: 0,
    created_at: nowISO(),
  });
}

const getSessionUser = (c: any) =>
  (c.get("sessionUser") as any) || (c.get("user") as any) || null;

/** Check if user is authenticated (any authenticated user can manage all users) */
const requireAuthenticated = (c: any): { user: any } | null => {
  const sessionUser = getSessionUser(c);
  if (!sessionUser?.id) {
    return null;
  }
  return { user: sessionUser };
};


// Notification helper with instance-level feature gates
async function notify(
  store: ReturnType<typeof makeData>,
  env: Bindings,
  user_id: string,
  type: string,
  actor_id: string,
  ref_type: string,
  ref_id: string,
  message: string,
) {
  await notifyBase(store, env, user_id, type, actor_id, ref_type, ref_id, message, {
    allowDefaultPushFallback: featureEnabled("defaultPushFallback"),
    defaultPushSecret: env.DEFAULT_PUSH_SERVICE_SECRET || "",
  });
}

const sanitizeUser = (user: any) => {
  if (!user) return null;
  const { jwt_secret, tenant_id, ...publicProfile } = user;
  return publicProfile;
};

const formatActiveUserCookieValue = (userId: string) => {
  const trimmedUser = (userId || "").trim();
  if (!trimmedUser) return "";
  return encodeURIComponent(trimmedUser);
};

const setActiveUserCookie = (c: any, userId: string) => {
  const ttlSeconds = getSessionTtlSeconds(c.env as Bindings);
  const requestUrl = new URL(c.req.url);
  setCookie(c, ACTIVE_USER_COOKIE_NAME, formatActiveUserCookieValue(userId), {
    maxAge: ttlSeconds,
    path: "/",
    sameSite: "Lax",
    secure: requestUrl.protocol === "https:",
    httpOnly: true,
  });
};

const clearActiveUserCookie = (c: any) => {
  const requestUrl = new URL(c.req.url);
  setCookie(c, ACTIVE_USER_COOKIE_NAME, "", {
    maxAge: 0,
    path: "/",
    sameSite: "Lax",
    secure: requestUrl.protocol === "https:",
    httpOnly: true,
  });
};


// -------- Media (R2) upload and serve --------
const inferExtFromType = (t: string) => {
  const m = (t || "").toLowerCase();
  if (m.includes("jpeg")) return "jpg";
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("gif")) return "gif";
  if (m.includes("svg")) return "svg";
  if (m.includes("mp4")) return "mp4";
  if (m.includes("webm")) return "webm";
  if (m.includes("quicktime") || m.includes("mov")) return "mov";
  return "";
};

function safeFileExt(name: string, type: string): string {
  const n = (name || "").toLowerCase();
  const dot = n.lastIndexOf(".");
  const extFromName = dot >= 0
    ? n.slice(dot + 1).replace(/[^a-z0-9]/g, "")
    : "";
  const fromType = inferExtFromType(type);
  return (extFromName || fromType || "").slice(0, 8);
}

function datePrefix(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}/${m}/${dd}`;
}

const STORAGE_ROOT = "storage";
const MAX_ALT_LENGTH = 1500;

function normalizePathPrefix(input: string): string {
  const cleaned = (input || "").replace(/\\/g, "/");
  const parts = cleaned
    .split("/")
    .map((p) => p.trim())
    .filter((p) => p && p !== "." && p !== "..");
  return parts.join("/");
}

function userStoragePrefix(userId: string, prefix?: string): string {
  const safeUser = (userId || "anon").replace(/[^a-zA-Z0-9_-]/g, "");
  const safePrefix = normalizePathPrefix(prefix || "");
  const base = `${STORAGE_ROOT}/${safeUser}`;
  return safePrefix ? `${base}/${safePrefix}` : base;
}

function stripUserStoragePrefix(fullKey: string, userId: string): string {
  const base = `${STORAGE_ROOT}/${(userId || "anon").replace(/[^a-zA-Z0-9_-]/g, "")}`;
  if (fullKey === base) return "";
  if (fullKey.startsWith(`${base}/`)) {
    return fullKey.slice(base.length + 1);
  }
  return fullKey;
}

function safeFileName(name: string, fallback: string, ext: string): string {
  const raw = (name || "").split("/").pop() || "";
  const normalized = raw.replace(/[^a-zA-Z0-9._-]/g, "").replace(/^\.*/, "");
  let base = normalized.replace(/\s+/g, "-").slice(0, 64);
  if (!base) base = fallback.slice(0, 32);
  if (ext && !base.toLowerCase().endsWith(`.${ext}`)) {
    base = `${base}.${ext}`;
  }
  return base;
}

app.post("/media/upload", async (c) => {
  const env = c.env as Bindings;
  if (!env.MEDIA) return fail(c, "media storage not configured", 500);
  const store = makeData(c.env as any, c);
  const plan = resolvePlanFromEnv(c.env as any);
  try {
    const authResult = await authenticateUser(c, store).catch(() => null);
    const authContext = buildAuthContext(authResult, plan);
    if (!authContext.isAuthenticated || !authContext.userId) {
      return fail(c, "Authentication required", 401, { code: "UNAUTHORIZED" });
    }
    const userId = authContext.userId;

    const form = await c.req.formData().catch(() => null);
    if (!form) return fail(c, "invalid form data", 400);
    const file = form.get("file") as File | null;
    if (!file) return fail(c, "file required", 400);
    const descriptionRaw = form.get("description") ?? form.get("alt");
    const description = typeof descriptionRaw === "string"
      ? descriptionRaw.slice(0, MAX_ALT_LENGTH).trim()
      : "";
    const ext = safeFileExt((file as any).name || "", file.type);
    const id = crypto.randomUUID().replace(/-/g, "");
    const basePrefix = `user-uploads/${userId}`;
    const quota = await checkStorageQuota(env.MEDIA, basePrefix, authContext, (file as any).size ?? (file as any).length ?? 0);
    if (!quota.ok) {
      return fail(c, quota.guard.message, quota.guard.status, {
        code: quota.guard.code,
        details: quota.guard.details,
      });
    }
    const prefix = `${basePrefix}/${datePrefix()}`;
    const key = `${prefix}/${id}${ext ? "." + ext : ""}`;
    await env.MEDIA.put(key, file, {
      httpMetadata: {
        contentType: file.type || "application/octet-stream",
        cacheControl: "public, max-age=31536000, immutable",
      },
    });
    const url = `/media/${encodeURI(key)}`;
    if (store.upsertMedia) {
      await store.upsertMedia({
        key,
        user_id: userId,
        url,
        description,
        content_type: file.type || "",
      });
    }
    return ok(c, { key, url, description: description || undefined }, 201);
  } finally {
    await releaseStore(store);
  }
});

// Publicly serve media from R2 via Worker
app.get("/media/*", async (c) => {
  const env = c.env as Bindings;
  const path = new URL(c.req.url).pathname;
  if (!env.MEDIA) {
    throw new HttpError(500, ErrorCodes.CONFIGURATION_ERROR, "Media storage not configured");
  }
  let key = "";
  try {
    key = decodeURIComponent(path.replace(/^\/media\//, ""));
  } catch (error) {
    throw new HttpError(400, ErrorCodes.INVALID_INPUT, "Invalid media path encoding", {
      path,
      error: String((error as Error)?.message ?? error),
    });
  }
  if (!key) {
    throw new HttpError(404, ErrorCodes.MEDIA_NOT_FOUND, "Media not found", { path });
  }
  const obj = await env.MEDIA.get(key);
  if (!obj) {
    throw new HttpError(404, ErrorCodes.MEDIA_NOT_FOUND, "Media not found", { key });
  }
  const headers = new Headers();
  const ct = obj.httpMetadata?.contentType || "application/octet-stream";
  headers.set("Content-Type", ct);
  const cc = obj.httpMetadata?.cacheControl ||
    "public, max-age=31536000, immutable";
  headers.set("Cache-Control", cc);
  if (obj.httpEtag) headers.set("ETag", obj.httpEtag);
  return new Response(obj.body, { headers });
});

// -------- User storage (R2) with folder-like prefixes --------
app.get("/storage", auth, async (c) => {
  const env = c.env as Bindings;
  if (!env.MEDIA) return fail(c, "media storage not configured", 500);
  const store = makeData(c.env as any, c);
  const user = c.get("user") as any;
  try {
    const url = new URL(c.req.url);
    const prefixParam = url.searchParams.get("prefix") || "";
    const cursor = url.searchParams.get("cursor") || undefined;
    const basePrefix = userStoragePrefix((user as any)?.id || "anon", prefixParam);
    const listPrefix = basePrefix.endsWith("/") ? basePrefix : `${basePrefix}/`;

    const result = await env.MEDIA.list({
      prefix: listPrefix,
      delimiter: "/",
      cursor,
    });

    const mediaMeta = await store.listMediaByUser?.((user as any)?.id || "");
    const mediaMap = new Map<string, string>(
      (mediaMeta || []).map((m: any) => [m.key, m.description || ""]),
    );

    const objects = (result?.objects || []).map((obj: any) => {
      const relative = stripUserStoragePrefix(obj.key, (user as any)?.id || "anon");
      return {
        key: relative,
        full_key: obj.key,
        size: obj.size,
        uploaded: obj.uploaded,
        etag: obj.httpEtag || null,
        content_type: obj.httpMetadata?.contentType || null,
        cache_control: obj.httpMetadata?.cacheControl || null,
        url: `/media/${encodeURI(obj.key)}`,
        description: mediaMap.get(obj.key) || undefined,
      };
    });

    const folders = (result?.delimitedPrefixes || []).map((p: string) =>
      stripUserStoragePrefix(p.replace(/\/$/, ""), (user as any)?.id || "anon")
    );

    return ok(c, {
      prefix: normalizePathPrefix(prefixParam),
      folders,
      objects,
      truncated: !!result?.truncated,
      cursor: result?.cursor || null,
    });
  } finally {
    await releaseStore(store);
  }
});

app.post("/storage/upload", auth, async (c) => {
  const env = c.env as Bindings;
  if (!env.MEDIA) return fail(c, "media storage not configured", 500);
  const store = makeData(c.env as any, c);
  const authContext = (c.get("authContext") as AuthContext | null) ?? null;
  if (!authContext?.isAuthenticated || !authContext.userId) {
    return fail(c, "Authentication required", 401, { code: "UNAUTHORIZED" });
  }
  try {
    const form = await c.req.formData().catch(() => null);
    if (!form) return fail(c, "invalid form data", 400);
    const file = form.get("file") as File | null;
    if (!file) return fail(c, "file required", 400);
    const descriptionRaw = form.get("description") ?? form.get("alt");
    const description = typeof descriptionRaw === "string"
      ? descriptionRaw.slice(0, MAX_ALT_LENGTH).trim()
      : "";

    const pathInput = form.get("path");
    const basePrefix = userStoragePrefix(
      authContext.userId,
      typeof pathInput === "string" ? pathInput : "",
    );
    const prefixWithSlash = basePrefix.endsWith("/") ? basePrefix : `${basePrefix}/`;

    const quota = await checkStorageQuota(env.MEDIA, userStoragePrefix(authContext.userId), authContext, (file as any).size ?? (file as any).length ?? 0);
    if (!quota.ok) {
      return fail(c, quota.guard.message, quota.guard.status, {
        code: quota.guard.code,
        details: quota.guard.details,
      });
    }

    const id = crypto.randomUUID().replace(/-/g, "");
    const ext = safeFileExt((file as any).name || "", file.type);
    const filename = safeFileName((file as any).name || "", id, ext);
    const key = `${prefixWithSlash}${filename}`;

    await env.MEDIA.put(key, file, {
      httpMetadata: {
        contentType: file.type || "application/octet-stream",
        cacheControl: "public, max-age=31536000, immutable",
      },
    });
    const url = `/media/${encodeURI(key)}`;
    if (store.upsertMedia) {
      await store.upsertMedia({
        key,
        user_id: authContext.userId,
        url,
        description,
        content_type: file.type || "",
      });
    }
    return ok(c, {
      key: stripUserStoragePrefix(key, authContext.userId),
      full_key: key,
      url,
      description: description || undefined,
    }, 201);
  } finally {
    await releaseStore(store);
  }
});

app.delete("/storage", auth, async (c) => {
  const env = c.env as Bindings;
  if (!env.MEDIA) return fail(c, "media storage not configured", 500);
  const store = makeData(c.env as any, c);
  const user = c.get("user") as any;
  try {
    const url = new URL(c.req.url);
    const body = (await c.req.json().catch(() => ({}))) as any;
    const keyInput =
      typeof body.key === "string"
        ? body.key
        : url.searchParams.get("key") || "";
    const normalized = normalizePathPrefix(keyInput);
    if (!normalized) return fail(c, "key required", 400);

    const fullKey = `${userStoragePrefix((user as any)?.id || "anon")}/${normalized}`;
    await env.MEDIA.delete(fullKey);
    return ok(c, { deleted: normalized });
  } finally {
    await releaseStore(store);
  }
});

// Password auth for single-instance setup.
// Canonical login endpoint: POST /auth/login (legacy /auth/password/login remains for compatibility).
// Configure a single master password via AUTH_PASSWORD (plain or salt$hash).
// Default user handle is "user" (configurable via DEFAULT_USER_HANDLE).

const DEFAULT_USER_HANDLE = "user";

function resolveDefaultHandle(env: Bindings): string {
  const configured = typeof (env as any).DEFAULT_USER_HANDLE === "string"
    ? normalizeHandle((env as any).DEFAULT_USER_HANDLE)
    : "";
  return configured && isValidHandle(configured) ? configured : DEFAULT_USER_HANDLE;
}

app.post("/auth/password/register", async (c) => {
  return fail(
    c,
    "password registration is disabled; use authenticated actor creation instead",
    404,
  );
});

async function passwordLogin(c: any) {
  if (!featureEnabled("envPasswordAuth")) {
    return fail(c, "password authentication disabled", 404);
  }
  const body = (await c.req.json().catch(() => ({}))) as Record<string, any>;
  const password = typeof body.password === "string" ? body.password : "";

  const masterPassword =
    typeof c.env.AUTH_PASSWORD === "string" ? c.env.AUTH_PASSWORD.trim() : "";
  if (!password || !masterPassword) {
    return fail(c, "Invalid credentials", 401, { code: "UNAUTHORIZED" });
  }

  const verified = await verifyMasterPassword(password, masterPassword);
  if (!verified) {
    return fail(c, "Invalid credentials", 401, { code: "UNAUTHORIZED" });
  }

  const store = makeData(c.env as any, c);
  try {
    const defaultHandle = resolveDefaultHandle(c.env as Bindings);
    const user: any = await ensureDefaultUser(store, defaultHandle);

    const { id: sessionId, expiresAt } = await createUserSession(store as any, c.env as any, user.id);
    const cookieName = getSessionCookieName(c.env as Bindings);
    const ttlSeconds = getSessionTtlSeconds(c.env as Bindings);
    const requestUrl = new URL(c.req.url);
    setCookie(c, cookieName, encodeURIComponent(sessionId), {
      maxAge: ttlSeconds,
      path: "/",
      sameSite: "Lax",
      secure: requestUrl.protocol === "https:",
      httpOnly: true,
    });

    const { token } = await createUserJWT(c, store as any, user.id);
    // Remove sensitive/internal fields before returning
    const { jwt_secret, tenant_id, ...publicProfile } = user;
    const sessionExpiresAt =
      expiresAt instanceof Date ? expiresAt.toISOString() : null;
    return ok(c, {
      user: publicProfile,
      token,
      session: {
        id: sessionId,
        expires_at: sessionExpiresAt,
      },
    });
  } finally {
    await releaseStore(store);
  }
}

app.post("/auth/login", passwordLogin);

app.post("/auth/password/login", async (c) => {
  const response = await passwordLogin(c);
  response.headers.set("X-Deprecated-Endpoint", "Use POST /auth/login");
  return response;
});

app.post("/auth/session/token", async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const authResult = await authenticateUser(c, store);
    if (!authResult) {
      return fail(c, "Unauthorized", 401, { code: "UNAUTHORIZED" });
    }
    const userId = (authResult.user as any)?.id;
    if (!userId) {
      return fail(c, "Invalid session", 400, { code: "INVALID_INPUT" });
    }
    const { token } = await createUserJWT(c, store, userId);
    // Remove sensitive/internal fields before returning
    const user: any = authResult.user;
    const { jwt_secret, tenant_id, ...publicProfile } = user;
    return ok(c, { token, user: publicProfile });
  } finally {
    await releaseStore(store);
  }
});

// Switch active user - any authenticated user can switch to any existing user
app.post("/auth/active-user", auth, async (c) => {
  const authSession = requireAuthenticated(c);
  if (!authSession) {
    return fail(c, "authentication required", 403);
  }
  const store = makeData(c.env as any, c);
  try {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, any>;
    const requestedId =
      typeof body.user_id === "string"
        ? body.user_id
        : typeof body.active_user_id === "string"
          ? body.active_user_id
          : typeof body.userId === "string"
            ? body.userId
            : "";
    const normalizedHandle = normalizeHandle(requestedId);
    if (!normalizedHandle) {
      return fail(c, "user_id is required", 400, {
        code: "MISSING_REQUIRED_FIELD",
        details: { field: "user_id" },
      });
    }

    if (!isValidHandle(normalizedHandle)) {
      return fail(c, "invalid handle", 400, { code: "INVALID_FORMAT" });
    }

    const user = await store.getUser(normalizedHandle).catch(() => null);
    if (!user) {
      return fail(c, "user not found", 404, {
        code: "USER_NOT_FOUND",
        details: { userId: normalizedHandle },
      });
    }

    setActiveUserCookie(c, user.id);
    c.set("user", user);
    (c as any).set("activeUserId", user.id);
    return ok(c, { active_user_id: user.id, user: sanitizeUser(user) });
  } finally {
    await releaseStore(store);
  }
});

// Create or switch to actor - any authenticated user can manage all actors
app.post("/auth/actors", auth, async (c) => {
  const authSession = requireAuthenticated(c);
  if (!authSession) {
    return fail(c, "authentication required", 403);
  }

  const store = makeData(c.env as any, c);
  try {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, any>;
    const handleRaw =
      typeof body.handle === "string"
        ? body.handle
        : typeof body.user_id === "string"
          ? body.user_id
          : typeof body.userId === "string"
            ? body.userId
            : "";
    const handle = normalizeHandle(handleRaw);
    if (!handle || !isValidHandle(handle)) {
      return fail(c, "invalid handle", 400, { code: "INVALID_FORMAT" });
    }
    const displayName =
      typeof body.display_name === "string" && body.display_name.trim()
        ? body.display_name
        : handleRaw || handle;
    const create =
      body.create === undefined && body.create_if_missing === undefined
        ? true
        : !!(body.create ?? body.create_if_missing);
    const activate =
      body.activate === undefined && body.set_active === undefined
        ? true
        : !!(body.activate ?? body.set_active);
    const issueToken = body.issue_token === true;

    let user = await store.getUser(handle).catch(() => null);
    let created = false;
    if (!user) {
      if (!create) {
        return fail(c, "user not found", 404, {
          code: "USER_NOT_FOUND",
          details: { userId: handle },
        });
      }
      user = await store.createUser({
        id: handle,
        display_name: displayName || handle,
        is_private: 0,
        created_at: nowISO(),
      });
      created = true;
    }

    if (activate) {
      setActiveUserCookie(c, user.id);
      c.set("user", user);
      (c as any).set("activeUserId", user.id);
    }

    const response: Record<string, unknown> = {
      user: sanitizeUser(user),
      active_user_id: activate ? user.id : (c as any).get("activeUserId") ?? null,
      created,
    };

    if (issueToken) {
      const { token } = await createUserJWT(c, store as any, (user as any).id);
      response.token = token;
    }

    return ok(c, response, created ? 201 : 200);
  } finally {
    await releaseStore(store);
  }
});

// Legacy endpoint - redirect to /auth/actors
app.post("/auth/owner/actors", auth, async (c) => {
  // Forward to new endpoint
  const newUrl = new URL(c.req.url);
  newUrl.pathname = "/auth/actors";
  const newReq = new Request(newUrl.toString(), c.req.raw);
  return app.fetch(newReq, c.env, c.executionCtx);
});

app.delete("/auth/active-user", auth, async (c) => {
  clearActiveUserCookie(c);
  const sessionUser = ((c as any).get("sessionUser")) || (c.get("user") as any);
  const fallbackUser = sessionUser ? sanitizeUser(sessionUser) : null;
  return ok(c, { active_user_id: null, user: fallbackUser });
});

// List all actors - returns current active user info
// Note: Full user listing requires DatabaseAPI.listUsers which may not be implemented
app.get("/auth/actors", auth, async (c) => {
  const authSession = requireAuthenticated(c);
  if (!authSession) {
    return fail(c, "authentication required", 403);
  }

  const activeUserId = (c as any).get("activeUserId") ?? null;
  const sessionUser = getSessionUser(c);
  const activeUser = c.get("user") as any;

  // Return available actor info
  const actors: any[] = [];
  if (sessionUser) {
    actors.push(sanitizeUser(sessionUser));
  }
  if (activeUser && activeUser.id !== sessionUser?.id) {
    actors.push(sanitizeUser(activeUser));
  }

  return ok(c, {
    actors,
    active_user_id: activeUserId,
  });
});

// Legacy endpoint - redirect to /auth/actors
app.get("/auth/owner/actors", auth, async (c) => {
  const newUrl = new URL(c.req.url);
  newUrl.pathname = "/auth/actors";
  const newReq = new Request(newUrl.toString(), c.req.raw);
  return app.fetch(newReq, c.env, c.executionCtx);
});

// Delete actor - any authenticated user can delete any actor (except currently active)
app.delete("/auth/actors/:actorId", auth, async (c) => {
  const authSession = requireAuthenticated(c);
  if (!authSession) {
    return fail(c, "authentication required", 403);
  }

  const store = makeData(c.env as any, c);
  try {
    const actorId = c.req.param("actorId");
    const normalizedActorId = normalizeHandle(actorId);

    if (!normalizedActorId) {
      return fail(c, "invalid actor_id", 400, { code: "INVALID_FORMAT" });
    }

    // Cannot delete the session user's actor
    const sessionUserId = normalizeHandle(authSession.user?.id ?? "");
    if (normalizedActorId === sessionUserId) {
      return fail(c, "cannot delete current session actor", 400, { code: "SELF_ACTION_FORBIDDEN" });
    }

    // Check if actor exists
    const actor = await store.getUser(normalizedActorId).catch(() => null);
    if (!actor) {
      return fail(c, "actor not found", 404, {
        code: "ACTOR_NOT_FOUND",
        details: { actorId: normalizedActorId },
      });
    }

    // TODO: Implement user deletion in DatabaseAPI
    // For now, return not implemented
    return fail(c, "actor deletion not yet implemented", 501);
  } finally {
    await releaseStore(store);
  }
});

// Legacy endpoint - redirect to /auth/actors/:actorId
app.delete("/auth/owner/actors/:actorId", auth, async (c) => {
  const actorId = c.req.param("actorId");
  const newUrl = new URL(c.req.url);
  newUrl.pathname = `/auth/actors/${actorId}`;
  const newReq = new Request(newUrl.toString(), c.req.raw);
  return app.fetch(newReq, c.env, c.executionCtx);
});

app.post("/auth/logout", async (c) => {
  // JWT logout: client will clear localStorage, no server-side action needed
  return ok(c, { success: true });
});

async function requireMember(
  store: ReturnType<typeof makeData>,
  communityId: string | null | undefined,
  userId: string,
) {
  if (!communityId) return true;
  return !!(await store.hasMembership(communityId, userId));
}

// If no API route is matched, fall back to serving static assets.
// The 'ASSETS' binding is configured in wrangler.toml to handle SPA routing.
app.notFound((c) => {
  console.log("[backend] notFound", {
    path: new URL(c.req.url).pathname,
    method: c.req.method,
    accept: c.req.header("accept"),
  });
  const requestId = (c.get("requestId") as string | undefined) ?? undefined;
  const path = new URL(c.req.url).pathname;
  if (!c.env.ASSETS) {
    logEvent(c, "warn", "request.not_found", { path });
    return mapErrorToResponse(new HttpError(404, ErrorCodes.NOT_FOUND, "Route not found", { path }), {
      requestId,
      env: c.env,
    });
  }

  const method = (c.req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    logEvent(c, "warn", "request.not_found", { path, method });
    return mapErrorToResponse(new HttpError(404, ErrorCodes.NOT_FOUND, "Route not found", { path, method }), {
      requestId,
      env: c.env,
    });
  }

  try {
    return c.env.ASSETS.fetch(c.req.raw);
  } catch (error) {
    console.error("asset fallback failed", error);
    return mapErrorToResponse(new HttpError(500, ErrorCodes.INTERNAL_ERROR, "Asset fallback failed", { path }), {
      requestId,
      env: c.env,
    });
  }
});

// GET /communities/:id/channels/:channelId/messages - Get channel messages
app.get("/communities/:id/channels/:channelId/messages", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const communityId = c.req.param("id");
    const channelId = c.req.param("channelId");
    const limit = parseInt(c.req.query("limit") || "50", 10);

    // Verify community exists
    const community = await store.getCommunity(communityId);
    if (!community) {
      return fail(c, "Community not found", 404, { code: ErrorCodes.COMMUNITY_NOT_FOUND, details: { communityId } });
    }

    // Verify user is member
    if (!(await requireMember(store, communityId, user.id))) {
      return fail(c, "Insufficient permissions", 403, { code: ErrorCodes.INSUFFICIENT_PERMISSIONS, details: { communityId } });
    }

    // Verify channel exists
    const channel = await store.getChannel?.(communityId, channelId);
    if (!channel) {
      return fail(c, "Not found", 404, { code: ErrorCodes.NOT_FOUND, details: { communityId, channelId } });
    }

    const messages = await getChannelMessages(c.env, communityId, channelId, limit);
    return ok(c, messages);
  } catch (error: unknown) {
    console.error("get channel messages failed", error);
    return fail(c, "Failed to get messages", 500, { code: ErrorCodes.INTERNAL_ERROR });
  } finally {
    await releaseStore(store);
  }
});

// POST /communities/:id/channels/:channelId/messages - Send channel message
app.post("/communities/:id/channels/:channelId/messages", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const communityId = c.req.param("id");
    const channelId = c.req.param("channelId");
    const body = (await c.req.json().catch(() => ({}))) as any;

    // Verify community exists
    const community = await store.getCommunity(communityId);
    if (!community) {
      return fail(c, "Community not found", 404, { code: ErrorCodes.COMMUNITY_NOT_FOUND, details: { communityId } });
    }

    // Verify user is member
    if (!(await requireMember(store, communityId, user.id))) {
      return fail(c, "Insufficient permissions", 403, { code: ErrorCodes.INSUFFICIENT_PERMISSIONS, details: { communityId } });
    }

    // Verify channel exists
    const channel = await store.getChannel?.(communityId, channelId);
    if (!channel) {
      return fail(c, "Not found", 404, { code: ErrorCodes.NOT_FOUND, details: { communityId, channelId } });
    }

    const content = String(body.content || "").trim();
    if (!content) {
      return fail(c, "content is required", 400, { code: ErrorCodes.MISSING_REQUIRED_FIELD, details: { field: "content" } });
    }

    const recipients = Array.isArray(body.recipients) ? body.recipients : [];
    const inReplyTo = body.in_reply_to || body.inReplyTo || undefined;

    const { sendChannelMessage: sendChannel } = await import("@takos/platform/server");
    const { activity } = await sendChannel(
      c.env,
      user.handle || user.id,
      communityId,
      channelId,
      recipients,
      content,
      inReplyTo,
    );

    return ok(c, { activity }, 201);
  } catch (error: unknown) {
    console.error("send channel message failed", error);
    return fail(c, "failed to send message", 500);
  } finally {
    await releaseStore(store);
  }
});

export default app;

export function createTakosRoot(
  config: CreateTakosRootConfig | string = {},
  instanceDomain: string,
): Hono<{ Bindings: Bindings; Variables: Variables }> {
  const resolvedDomain =
    typeof instanceDomain === "string" && instanceDomain.trim()
      ? instanceDomain.trim().toLowerCase()
      : undefined;
  if (!resolvedDomain) {
    throw new Error("createTakosRoot requires an instanceDomain argument");
  }
  const normalizedConfig: CreateTakosRootConfig =
    typeof config === "string" ? {} : { ...config };
  normalizedConfig.instanceDomain = resolvedDomain;
  applyConfig(normalizedConfig);
  return app;
}

type ScheduledTaskRunner = (event: ScheduledEvent, env: any) => Promise<void>;

const scheduledTaskHandlers: Record<string, ScheduledTaskRunner> = {
  "app-workers": async (event, env) => {
    await runDefaultAppScheduled(event, env);
  },
  "scheduled-posts": async (_event, env) => {
    const result = await processPostPlanQueue(env as Bindings, { limit: 25 });
    if (!result.supported) {
      console.warn("[cron] post plan processing skipped: not supported by data store");
      return;
    }
    console.log(`[cron] processed ${result.processed.length} scheduled post(s)`);
  },
  "data-exports": async (_event, env) => {
    const result = await processExportQueue(env as Bindings);
    if (!result.supported) {
      console.warn("[cron] export processing skipped: data export not supported");
      return;
    }
    console.log(`[cron] processed ${result.processed.length} export request(s)`);
  },
  "story-expiration": async (_event, env) => {
    const result = await cleanupExpiredStories(env as Bindings, {
      limit: 100,
      force: true,
      throttleMs: 0,
    });
    if (result.skipped) {
      console.log(`[cron] story cleanup skipped: ${result.reason ?? "throttled"}`);
      return;
    }
    console.log(
      `[cron] story cleanup deleted ${result.deleted} expired stories (checked ${result.checked})`,
    );
  },
  "app-cleanup": async (event, env) => {
    await runDefaultAppScheduled(event, env);
  },
  "ai-proposals-expire": async (_event, env) => {
    const result = await expireAiProposals(env as any);
    console.log(`[cron] proposal expiration expired ${result.expired} proposal(s)`);
  },
};

async function runScheduledTasksForCron(event: ScheduledEvent, env: any): Promise<void> {
  const tasksForSchedule: CronTaskDefinition[] = getCronTasksForSchedule(event.cron || "");
  if (!tasksForSchedule.length) {
    console.warn(`[cron] no registered tasks for schedule "${event.cron}"`);
    return;
  }
  for (const task of tasksForSchedule) {
    const runner = scheduledTaskHandlers[task.id];
    if (!runner) {
      console.warn(`[cron] no runner registered for task "${task.id}"`);
      continue;
    }
    try {
      await runner(event, env);
    } catch (error) {
      console.error(`[cron] task "${task.id}" failed`, error);
    }
  }
}

async function runDefaultAppScheduled(event: ScheduledEvent, env: any): Promise<void> {
  try {
    const appId = "default";
    const appModule = await loadTakosApp(appId, env);
    const scheduled = (appModule as any)?.scheduled;
    if (typeof scheduled !== "function") return;

    const manifest = await loadStoredAppManifest(env, appId);
    const appEnv = buildTakosScheduledAppEnv(env, appId, manifest);
    const ctx = { waitUntil: async (p: Promise<any>) => p } as any;
    await scheduled(event, appEnv, ctx);
  } catch (error) {
    console.error("[cron] default app scheduled failed", error);
  }
}

export async function handleScheduled(event: ScheduledEvent, env: any): Promise<void> {
  console.log("Scheduled event triggered:", event.cron);
  let envWithConfig: any = env;
  try {
    const { config } = await getTakosConfig(env as Bindings);
    envWithConfig = { ...env, takosConfig: config };
  } catch (error) {
    console.warn("[config] failed to resolve takos-config for scheduled worker", error);
  }

  await ensureCronValidation(envWithConfig as Bindings);
  await runScheduledTasksForCron(event, envWithConfig);
}
