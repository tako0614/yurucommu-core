import { Hono } from "hono";
import type { Story, StoryItem } from "@takos/platform";
import {
  DEFAULT_IMAGE_DURATION_MS,
  DEFAULT_TEXT_DURATION_MS,
  DEFAULT_VIDEO_DURATION_MS,
  normalizeStoryItems,
} from "@takos/platform";
import type { StoryInput } from "./lib/types";
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
  ensureUserKeyPair,
  publishStoryCreate,
  publishStoryDelete,
  handleIncomingDm,
  handleIncomingChannelMessage,
  getDmThreadMessages,
  getChannelMessages,
  getActorUri,
  getObjectUri,
  getActivityUri,
  requireInstanceDomain,
  generateNoteObject,
  ACTIVITYSTREAMS_CONTEXT,
  releaseStore,
  withStore,
  enqueueDeliveriesToFollowers,
  queueImmediateDelivery,
  createUserJWT,
  authenticateJWT,
  activityPubRoutes,
  resolveDevDataIsolation,
  setDataFactory,
  setPrismaFactory,
  setInstanceConfig,
  ok,
  fail,
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
import cronHealthRoutes from "./routes/cron-health";
import activityPubMetadataRoutes from "./routes/activitypub-metadata.js";
import activityPubExtensionsRoutes from "./routes/activitypub-extensions.js";
import coreRecoveryRoutes from "./routes/core-recovery";
import appManifestRoutes from "./routes/app-manifest";
// takos-config.ts is deprecated; config routes are now unified in config.ts per PLAN.md 5.3
import { getTakosConfig } from "./lib/runtime-config";
import {
  isManifestRoutingEnabled,
  matchesManifestRoute,
  resolveManifestRouter,
} from "./lib/manifest-routing";
import {
  ACTIVE_USER_COOKIE_NAME,
  auth,
  authenticateUser,
} from "./middleware/auth";
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
  getCronTasksForSchedule,
  validateCronConfig,
} from "./lib/cron-tasks";
import type { CronTaskDefinition, CronValidationResult } from "./lib/cron-tasks";
import takosProfile from "../../takos-profile.json";
import { validateTakosProfile } from "./lib/profile-validator";

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

export type CreateTakosAppConfig = {
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

function applyConfig(config: CreateTakosAppConfig = {}): void {
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

// Trace entry into backend router for debugging.
app.use("*", async (c, next) => {
  console.log("[backend] enter", {
    path: new URL(c.req.url).pathname,
    method: c.req.method,
  });
  await next();
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
      return c.json(
        { ok: false, error: "dev data isolation failed", details: status.errors },
        503,
      );
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

// Mount ActivityPub routes (WebFinger, Actor, Inbox, Outbox)
// ActivityPub routes define their own full paths (/ap/..., /.well-known/..., /nodeinfo/...)
// so we mount at root.
app.route("/", activityPubRoutes);
app.route("/", activityPubMetadataRoutes);
app.route("/", activityPubExtensionsRoutes);
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
app.route("/", realtimeRoutes);
app.route("/", appPreviewRoutes);
app.route("/", appDebugRoutes);

// Root endpoint for health/checks and baseline tests
app.get("/", (c) => c.text("Hello World!"));

app.get("/.well-known/takos-push.json", (c) => {
  const wellKnown = buildPushWellKnownPayload(c.env as Bindings);
  if (!wellKnown) {
    return c.json({ ok: false, error: "push not configured" }, 503);
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

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}


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
  try {
    const authResult = await authenticateUser(c, store).catch(() => null);
    const userId = (authResult as any)?.user?.id || "anon";

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
    const prefix = `user-uploads/${userId}/${datePrefix()}`;
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
  if (!env.MEDIA) return c.text("Not Found", 404);
  const path = new URL(c.req.url).pathname;
  const key = decodeURIComponent(path.replace(/^\/media\//, ""));
  if (!key) return c.text("Not Found", 404);
  const obj = await env.MEDIA.get(key);
  if (!obj) return c.text("Not Found", 404);
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
  const user = c.get("user") as any;
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
      (user as any)?.id || "anon",
      typeof pathInput === "string" ? pathInput : "",
    );
    const prefixWithSlash = basePrefix.endsWith("/") ? basePrefix : `${basePrefix}/`;

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
        user_id: (user as any)?.id || "",
        url,
        description,
        content_type: file.type || "",
      });
    }
    return ok(c, {
      key: stripUserStoragePrefix(key, (user as any)?.id || "anon"),
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
    return fail(c, "invalid credentials", 401);
  }

  const verified = await verifyMasterPassword(password, masterPassword);
  if (!verified) {
    return fail(c, "invalid credentials", 401);
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
      return fail(c, "Unauthorized", 401);
    }
    const userId = (authResult.user as any)?.id;
    if (!userId) {
      return fail(c, "invalid session", 400);
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
      return fail(c, "user_id required", 400);
    }

    if (!isValidHandle(normalizedHandle)) {
      return fail(c, "invalid handle", 400);
    }

    const user = await store.getUser(normalizedHandle).catch(() => null);
    if (!user) {
      return fail(c, "user not found", 404);
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
      return fail(c, "invalid handle", 400);
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
        return fail(c, "user not found", 404);
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
      return fail(c, "invalid actor_id", 400);
    }

    // Cannot delete the session user's actor
    const sessionUserId = normalizeHandle(authSession.user?.id ?? "");
    if (normalizedActorId === sessionUserId) {
      return fail(c, "cannot delete current session actor", 403);
    }

    // Check if actor exists
    const actor = await store.getUser(normalizedActorId).catch(() => null);
    if (!actor) {
      return fail(c, "actor not found", 404);
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

// Posts
async function requireMember(
  store: ReturnType<typeof makeData>,
  communityId: string | null | undefined,
  userId: string,
  env?: any,
) {
  if (!communityId) return true;
  const localMember = await store.hasMembership(communityId, userId);
  if (localMember) return true;
  if (!env) return false;
  const instanceDomain = requireInstanceDomain(env as any);
  const actorUri = getActorUri(userId, instanceDomain);
  const follower = await store.findApFollower?.(`group:${communityId}`, actorUri).catch(() => null);
  return follower?.status === "accepted";
}

async function buildPostPayload(
  store: ReturnType<typeof makeData>,
  user: any,
  rawBody: any,
  options: { communityId?: string | null; allowBodyCommunityOverride?: boolean; env?: any } = {},
) {
  const body = rawBody ?? {};
  let targetCommunityId = options.communityId ?? null;

  if (options.allowBodyCommunityOverride !== false) {
    const fromBody =
      typeof body.community_id === "string"
        ? body.community_id.trim()
        : "";
    if (fromBody) {
      targetCommunityId = fromBody;
    }
  }

  if (targetCommunityId) {
    const community = await store.getCommunity(targetCommunityId);
    if (!community) throw new HttpError(404, "community not found");
    if (!(await requireMember(store, targetCommunityId, user.id, options.env))) {
      throw new HttpError(403, "forbidden");
    }
  }

  const type = typeof body.type === "string" && body.type ? body.type : "text";
  const text = typeof body.text === "string" ? body.text : "";
  const mediaUrls = Array.isArray(body.media_urls)
    ? (body.media_urls as any[])
      .map((url) => (typeof url === "string" ? url.trim() : ""))
      .filter((url) => url.length > 0)
    : [];

  const audienceInput = String(body.audience || "all");
  const broadcastAll = targetCommunityId && audienceInput === "community" ? false : true;
  const visibleToFriends = broadcastAll
    ? body.visible_to_friends === undefined
      ? true
      : !!body.visible_to_friends
    : false;

  // Generate ActivityPub URIs
  const instanceDomain = requireInstanceDomain(options.env ?? {});
  const protocol = "https";
  const postId = uuid();
  const ap_object_id = getObjectUri(user.id, postId, instanceDomain);
  const ap_activity_id = getActivityUri(
    user.id,
    `create-${postId}`,
    instanceDomain,
  );

  return {
    id: postId,
    community_id: targetCommunityId ?? null,
    author_id: user.id,
    type,
    text,
    media_urls: mediaUrls,
    created_at: nowISO(),
    pinned: !!body.pinned,
    broadcast_all: broadcastAll,
    visible_to_friends: visibleToFriends,
    attributed_community_id: targetCommunityId ?? null,
    ap_object_id,
    ap_activity_id,
  };
}

const defaultStoryDuration = (item: StoryItem) => {
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
    throw new HttpError(400, "items required");
  }
  return normalized.map((item, index) => ({
    ...item,
    id: item.id || crypto.randomUUID(),
    durationMs: item.durationMs ?? defaultStoryDuration(item),
    order: typeof item.order === "number" ? item.order : index,
  }));
};

async function buildStoryPayload(
  store: ReturnType<typeof makeData>,
  user: any,
  rawBody: any,
  options: { communityId?: string | null; allowBodyCommunityOverride?: boolean; env?: any } = {},
): Promise<StoryInput> {
  const body = rawBody ?? {};
  let targetCommunityId = options.communityId ?? null;

  if (options.allowBodyCommunityOverride !== false) {
    const fromBody =
      typeof body.community_id === "string"
        ? body.community_id.trim()
        : "";
    if (fromBody) {
      targetCommunityId = fromBody;
    }
  }

  if (targetCommunityId) {
    const community = await store.getCommunity(targetCommunityId);
    if (!community) {
      throw new HttpError(404, "community not found");
    }
    if (!(await requireMember(store, targetCommunityId, user.id, options.env))) {
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

app.post("/communities/:id/posts", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const user = c.get("user") as any;
  const community_id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as any;
  try {
    const post = await buildPostPayload(store, user, body, {
      communityId: community_id,
      allowBodyCommunityOverride: false,
      env: c.env,
    });
    await store.createPost(post);

    // Generate and save Create Activity to ap_outbox_activities
    const instanceDomain = c.env.INSTANCE_DOMAIN
    const protocol = "https";
    const noteObject = generateNoteObject(
      { ...post, media_json: JSON.stringify(post.media_urls) },
      { id: user.id },
      instanceDomain!,
      protocol
    );
    const actorUri = getActorUri(user.id, instanceDomain!);
    const createActivity = {
      "@context": ACTIVITYSTREAMS_CONTEXT,
      type: "Create",
      id: post.ap_activity_id,
      actor: actorUri,
      object: noteObject,
      published: new Date(post.created_at).toISOString(),
      to: noteObject.to,
      cc: noteObject.cc,
    };

    await store.upsertApOutboxActivity({
      id: crypto.randomUUID(),
      local_user_id: user.id,
      activity_id: post.ap_activity_id!,
      activity_type: "Create",
      activity_json: JSON.stringify(createActivity),
      object_id: post.ap_object_id ?? null,
      object_type: "Note",
      created_at: new Date(),
    });

    // Enqueue delivery to followers (optimized)
    await enqueueDeliveriesToFollowers(store, user.id, post.ap_activity_id!, {
      env: c.env,
    });

    return ok(c, post, 201);
  } catch (error) {
    if (error instanceof HttpError) {
      return fail(c, error.message, error.status);
    }
    console.error("create post failed", error);
    return fail(c, "failed to create post", 500);
  }
});

app.post("/posts", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const user = c.get("user") as any;
  const body = (await c.req.json().catch(() => ({}))) as any;
  try {
    const post = await buildPostPayload(store, user, body, {
      communityId: null,
      allowBodyCommunityOverride: false,
      env: c.env,
    });
    await store.createPost(post);

    // Generate and save Create Activity to ap_outbox_activities
    const instanceDomain = c.env.INSTANCE_DOMAIN
    "example.com";
    const protocol = "https";
    const noteObject = generateNoteObject(
      { ...post, media_json: JSON.stringify(post.media_urls) },
      { id: user.id },
      instanceDomain!,
      protocol
    );
    const actorUri = getActorUri(user.id, instanceDomain!);
    const createActivity = {
      "@context": ACTIVITYSTREAMS_CONTEXT,
      type: "Create",
      id: post.ap_activity_id,
      actor: actorUri,
      object: noteObject,
      published: new Date(post.created_at).toISOString(),
      to: noteObject.to,
      cc: noteObject.cc,
    };

    await store.upsertApOutboxActivity({
      id: crypto.randomUUID(),
      local_user_id: user.id,
      activity_id: post.ap_activity_id!,
      activity_type: "Create",
      activity_json: JSON.stringify(createActivity),
      object_id: post.ap_object_id ?? null,
      object_type: "Note",
      created_at: new Date(),
    });

    // Enqueue delivery to followers (optimized)
    await enqueueDeliveriesToFollowers(store, user.id, post.ap_activity_id!, {
      env: c.env,
    });

    return ok(c, post, 201);
  } catch (error) {
    if (error instanceof HttpError) {
      return fail(c, error.message, error.status);
    }
    console.error("create global post failed", error);
    return fail(c, "failed to create post", 500);
  }
});

app.get("/communities/:id/posts", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const user = c.get("user") as any;
  const community_id = c.req.param("id");
  if (!(await store.getCommunity(community_id))) {
    return fail(c, "community not found", 404);
  }
  if (!(await requireMember(store, community_id, user.id, c.env))) {
    return fail(c, "forbidden", 403);
  }
  const list: any[] = await store.listPostsByCommunity(community_id);
  list.sort((a, b) =>
    (Number(b.pinned) - Number(a.pinned)) ||
    (a.created_at < b.created_at ? 1 : -1)
  );
  return ok(c, list);
});

app.get("/posts/:id/reactions", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const user = c.get("user") as any;
  const post_id = c.req.param("id");
  const post = await store.getPost(post_id);
  if (!post) return fail(c, "post not found", 404);
  if (!(await requireMember(store, (post as any).community_id, user.id, c.env))) {
    return fail(c, "forbidden", 403);
  }
  const list = await store.listReactionsByPost(post_id);
  return ok(c, list);
});

app.get("/posts/:id/comments", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const user = c.get("user") as any;
  const post_id = c.req.param("id");
  const post = await store.getPost(post_id);
  if (!post) return fail(c, "post not found", 404);
  if (!(await requireMember(store, (post as any).community_id, user.id, c.env))) {
    return fail(c, "forbidden", 403);
  }
  const list: any[] = await store.listCommentsByPost(post_id);
  list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return ok(c, list);
});

app.get("/posts", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const user = c.get("user") as any;
  const list: any[] = await store.listGlobalPostsForUser(user.id);
  list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return ok(c, list);
});

app.get("/communities/:id/reactions-summary", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const user = c.get("user") as any;
  const community_id = c.req.param("id");
  if (!(await store.getCommunity(community_id))) {
    return fail(c, "community not found", 404);
  }
  if (!(await requireMember(store, community_id, user.id, c.env))) {
    return fail(c, "forbidden", 403);
  }
  const summary: Record<string, Record<string, number>> = {};
  const posts = await store.listPostsByCommunity(community_id);
  for (const p of posts as any[]) {
    const reactions = await store.listReactionsByPost((p as any).id);
    for (const r of reactions as any[]) {
      if (!summary[(p as any).id]) summary[(p as any).id] = {};
      summary[(p as any).id][(r as any).emoji] =
        (summary[(p as any).id][(r as any).emoji] || 0) + 1;
    }
  }
  return ok(c, summary);
});


app.post("/posts/:id/reactions", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const user = c.get("user") as any;
  const post_id = c.req.param("id");
  const post = await store.getPost(post_id);
  if (!post) return fail(c, "post not found", 404);
  if (!(await requireMember(store, (post as any).community_id, user.id, c.env))) {
    return fail(c, "forbidden", 403);
  }
  const body = await c.req.json().catch(() => ({})) as any;
  const emoji = body.emoji || "👍";

  // Generate ActivityPub URIs
  const instanceDomain = requireInstanceDomain(c.env);
  const reactionId = uuid();
  const ap_activity_id = getActivityUri(
    user.id,
    `like-${reactionId}`,
    instanceDomain,
  );

  const reaction = {
    id: reactionId,
    post_id,
    user_id: user.id,
    emoji,
    created_at: nowISO(),
    ap_activity_id,
  };
  // Note: Reaction will be stored by inbox-worker after delivery

  // Generate and save Like Activity
  const postObjectId = (post as any).ap_object_id ||
    getObjectUri((post as any).author_id, post_id, instanceDomain);
  const actorUri = getActorUri(user.id, instanceDomain);
  const likeActivity = {
    "@context": ACTIVITYSTREAMS_CONTEXT,
    type: "Like",
    id: ap_activity_id,
    actor: actorUri,
    object: postObjectId,
    published: new Date(reaction.created_at).toISOString(),
    content: emoji !== "👍" ? emoji : undefined, // For emoji reactions (Misskey compat)
  };

  await store.upsertApOutboxActivity({
    id: crypto.randomUUID(),
    local_user_id: user.id,
    activity_id: ap_activity_id,
    activity_type: "Like",
    activity_json: JSON.stringify(likeActivity),
    object_id: postObjectId,
    object_type: "Note",
    created_at: new Date(),
  });

  // Enqueue delivery to post author (for local inbox processing)
  if ((post as any).author_id !== user.id) {
    const postAuthorInbox = `https://${instanceDomain}/ap/users/${(post as any).author_id}/inbox`;
    await queueImmediateDelivery(store, c.env as any, {
      id: crypto.randomUUID(),
      activity_id: ap_activity_id,
      target_inbox_url: postAuthorInbox,
      status: "pending",
      created_at: new Date(),
    });
  }

  // Enqueue delivery to followers (optimized)
  await enqueueDeliveriesToFollowers(store, user.id, ap_activity_id, {
    env: c.env,
  });

  // Keep notification for real-time UI updates
  if ((post as any).author_id !== user.id) {
    await notify(
      store,
      c.env as Bindings,
      (post as any).author_id,
      "like",
      user.id,
      "post",
      post_id,
      `${user.display_name} があなたの投稿にリアクションしました`,
    );
  }
  return ok(c, reaction, 201);
});

app.post("/posts/:id/comments", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const user = c.get("user") as any;
  const post_id = c.req.param("id");
  const post = await store.getPost(post_id);
  if (!post) return fail(c, "post not found", 404);
  if (!(await requireMember(store, (post as any).community_id, user.id, c.env))) {
    return fail(c, "forbidden", 403);
  }
  const body = await c.req.json().catch(() => ({})) as any;
  const text = (body.text || "").trim();
  if (!text) return fail(c, "text is required");

  // Generate ActivityPub URIs
  const instanceDomain = requireInstanceDomain(c.env);
  const commentId = uuid();
  const ap_object_id = getObjectUri(user.id, commentId, instanceDomain);
  const ap_activity_id = getActivityUri(
    user.id,
    `create-comment-${commentId}`,
    instanceDomain,
  );

  const comment = {
    id: commentId,
    post_id,
    author_id: user.id,
    text,
    created_at: nowISO(),
    ap_object_id,
    ap_activity_id,
  };
  // Note: Comment will be stored by inbox-worker after delivery

  // Generate and save Create Activity (Note with inReplyTo)
  const noteObject = {
    "@context": ACTIVITYSTREAMS_CONTEXT,
    type: "Note",
    id: ap_object_id,
    attributedTo: getActorUri(user.id, instanceDomain),
    content: `<p>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`,
    published: new Date(comment.created_at).toISOString(),
    inReplyTo: (post as any).ap_object_id ||
      getObjectUri((post as any).author_id, post_id, instanceDomain),
    to: [
      (post as any).broadcast_all
        ? "https://www.w3.org/ns/activitystreams#Public"
        : getActorUri((post as any).author_id, instanceDomain),
    ],
  };

  const actorUri = getActorUri(user.id, instanceDomain);
  const createActivity = {
    "@context": ACTIVITYSTREAMS_CONTEXT,
    type: "Create",
    id: ap_activity_id,
    actor: actorUri,
    object: noteObject,
    published: noteObject.published,
    to: noteObject.to,
  };

  await store.upsertApOutboxActivity({
    id: crypto.randomUUID(),
    local_user_id: user.id,
    activity_id: ap_activity_id,
    activity_type: "Create",
    activity_json: JSON.stringify(createActivity),
    object_id: ap_object_id,
    object_type: "Note",
    created_at: new Date(),
  });

  // Enqueue delivery to post author (for local inbox processing)
  if ((post as any).author_id !== user.id) {
    const postAuthorInbox = `https://${instanceDomain}/ap/users/${(post as any).author_id}/inbox`;
    await queueImmediateDelivery(store, c.env as any, {
      id: crypto.randomUUID(),
      activity_id: ap_activity_id,
      target_inbox_url: postAuthorInbox,
      status: "pending",
      created_at: new Date(),
    });
  }

  // Enqueue delivery to followers (optimized)
  await enqueueDeliveriesToFollowers(store, user.id, ap_activity_id, {
    env: c.env,
  });

  // Keep notification for real-time UI updates
  if ((post as any).author_id !== user.id) {
    await notify(
      store,
      c.env as Bindings,
      (post as any).author_id,
      "comment",
      user.id,
      "post",
      post_id,
      `${user.display_name} があなたの投稿にコメントしました`,
    );
  }
  return ok(c, comment, 201);
});

// Local no-op function for read-time story filtering (actual cleanup happens via cron)
function localStoryFilterCleanup() {/* read-time filter only */ }

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

app.post("/communities/:id/stories", auth, async (c) => {
  const store = makeData(c.env, c);
  const user = c.get("user") as any;
  const community_id = c.req.param("id");
  const body = await c.req.json().catch(() => ({})) as any;
  try {
    const story = await buildStoryPayload(store, user, body, {
      communityId: community_id,
      allowBodyCommunityOverride: false,
      env: c.env,
    });
    await store.createStory(story);
    await publishStoryCreate(c.env, story);
    return ok(c, story, 201);
  } catch (error) {
    if (error instanceof HttpError) {
      return fail(c, error.message, error.status);
    }
    console.error("create story failed", error);
    return fail(c, "failed to create story", 500);
  }
});

app.post("/stories", auth, async (c) => {
  const store = makeData(c.env, c);
  const user = c.get("user") as any;
  const body = await c.req.json().catch(() => ({})) as any;
  try {
    const story = await buildStoryPayload(store, user, body, { env: c.env });
    await store.createStory(story);
    await publishStoryCreate(c.env, story);
    return ok(c, story, 201);
  } catch (error) {
    if (error instanceof HttpError) {
      return fail(c, error.message, error.status);
    }
    console.error("create story failed", error);
    return fail(c, "failed to create story", 500);
  }
});

app.get("/stories", auth, async (c) => {
  const store = makeData(c.env, c);
  const user = c.get("user") as any;
  localStoryFilterCleanup();
  let list: any[] = await store.listGlobalStoriesForUser(user.id);
  const now = Date.now();
  list = list.filter((s) => Date.parse((s as any).expires_at) > now);
  list.sort((a, b) => ((a as any).created_at < (b as any).created_at ? 1 : -1));
  return ok(c, list);
});

app.get("/communities/:id/stories", auth, async (c) => {
  const store = makeData(c.env, c);
  const user = c.get("user") as any;
  const community_id = c.req.param("id");
  const community = await store.getCommunity(community_id);
  if (!community) return fail(c, "community not found", 404);
  if (!(await requireMember(store, community_id, user.id, c.env))) {
    return fail(c, "forbidden", 403);
  }
  localStoryFilterCleanup();
  let list: any[] = await store.listStoriesByCommunity(community_id);
  const now = Date.now();
  list = list.filter((s) => Date.parse((s as any).expires_at) > now);
  list.sort((a, b) => ((a as any).created_at < (b as any).created_at ? 1 : -1));
  return ok(c, list);
});

app.get("/stories/:id", auth, async (c) => {
  const store = makeData(c.env, c);
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
});

app.patch("/stories/:id", auth, async (c) => {
  const store = makeData(c.env, c);
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
});

app.delete("/stories/:id", auth, async (c) => {
  const store = makeData(c.env, c);
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
});

// If no API route is matched, fall back to serving static assets.
// The 'ASSETS' binding is configured in wrangler.toml to handle SPA routing.
app.notFound((c) => {
  console.log("[backend] notFound", {
    path: new URL(c.req.url).pathname,
    method: c.req.method,
    accept: c.req.header("accept"),
  });
  if (!c.env.ASSETS) {
    return c.text("Not Found", 404);
  }

  const method = (c.req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return c.json({ ok: false, error: "Not Found" }, 404);
  }

  try {
    return c.env.ASSETS.fetch(c.req.raw);
  } catch (error) {
    console.error("asset fallback failed", error);
    return c.text("Not Found", 404);
  }
});

// ============= Chat / DM Routes =============

// GET /dm/threads - List all DM threads for the authenticated user
app.get("/dm/threads", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const instanceDomain = requireInstanceDomain(c.env);
    const userActorUri = `https://${instanceDomain}/ap/users/${user.handle || user.id}`;

    // Get all threads where user is a participant
    const allThreads = await store.listAllDmThreads?.();
    if (!allThreads) {
      return ok(c, []);
    }

    const userThreads = allThreads.filter((thread: any) => {
      try {
        const participants = JSON.parse(thread.participants_json || "[]");
        return participants.includes(userActorUri);
      } catch {
        return false;
      }
    });

    // Enrich with latest message
    const enriched = await Promise.all(
      userThreads.map(async (thread: any) => {
        const messages = await store.listDmMessages(thread.id, 1);
        return {
          id: thread.id,
          participants: JSON.parse(thread.participants_json || "[]"),
          created_at: thread.created_at,
          latest_message: messages[0] || null,
        };
      })
    );

    return ok(c, enriched);
  } catch (error: unknown) {
    console.error("list dm threads failed", error);
    return fail(c, "failed to list dm threads", 500);
  } finally {
    await releaseStore(store);
  }
});

// GET /dm/threads/:threadId/messages - Get messages in a DM thread
app.get("/dm/threads/:threadId/messages", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const threadId = c.req.param("threadId");
    const limit = parseInt(c.req.query("limit") || "50", 10);

    // Verify user is participant in this thread
    const thread = await store.getDmThread?.(threadId);
    if (!thread) {
      return fail(c, "thread not found", 404);
    }

    const instanceDomain = requireInstanceDomain(c.env);
    const userActorUri = `https://${instanceDomain}/ap/users/${user.handle || user.id}`;
    const participants = JSON.parse(thread.participants_json || "[]");

    if (!participants.includes(userActorUri)) {
      return fail(c, "forbidden", 403);
    }

    const messages = await getDmThreadMessages(c.env, threadId, limit);
    return ok(c, messages);
  } catch (error: unknown) {
    console.error("get dm messages failed", error);
    return fail(c, "failed to get messages", 500);
  } finally {
    await releaseStore(store);
  }
});

// GET /dm/with/:handle - Get or create DM thread with specific user
app.get("/dm/with/:handle", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const otherHandle = c.req.param("handle");
    const limit = parseInt(c.req.query("limit") || "50", 10);

    const { threadId, messages } = await (async () => {
      const protocol = "https";
      const instanceDomain = requireInstanceDomain(c.env);
      const localActor = getActorUri(user.handle || user.id, instanceDomain, protocol);
      const otherActor = getActorUri(otherHandle, instanceDomain, protocol);
      const { canonicalizeParticipants, computeParticipantsHash } = await import("@takos/platform/server");
      const participants = canonicalizeParticipants([localActor, otherActor]);
      const hash = computeParticipantsHash(participants);
      const participantsJson = JSON.stringify(participants);
      const thread = await store.upsertDmThread(hash, participantsJson);
      const messages = await store.listDmMessages(thread.id, limit);
      return { threadId: thread.id, messages };
    })();

    return ok(c, { threadId, messages });
  } catch (error: unknown) {
    console.error("get dm thread by handle failed", error);
    return fail(c, "failed to get dm thread", 500);
  } finally {
    await releaseStore(store);
  }
});

// POST /dm/send - Send a direct message
app.post("/dm/send", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const body = (await c.req.json().catch(() => ({}))) as any;

    const recipients = Array.isArray(body.recipients)
      ? body.recipients
      : body.recipient
        ? [body.recipient]
        : [];

    if (recipients.length === 0) {
      return fail(c, "recipients required", 400);
    }

    const content = String(body.content || "").trim();
    if (!content) {
      return fail(c, "content required", 400);
    }

    const inReplyTo = body.in_reply_to || body.inReplyTo || undefined;

    const { sendDirectMessage: sendDm } = await import("@takos/platform/server");
    const { threadId, activity } = await sendDm(
      c.env,
      user.handle || user.id,
      recipients,
      content,
      inReplyTo,
    );

    return ok(c, { threadId, activity }, 201);
  } catch (error: unknown) {
    console.error("send dm failed", error);
    return fail(c, "failed to send message", 500);
  } finally {
    await releaseStore(store);
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
      return fail(c, "community not found", 404);
    }

    // Verify user is member
    if (!(await requireMember(store, communityId, user.id, c.env))) {
      return fail(c, "forbidden", 403);
    }

    // Verify channel exists
    const channel = await store.getChannel?.(communityId, channelId);
    if (!channel) {
      return fail(c, "channel not found", 404);
    }

    const messages = await getChannelMessages(c.env, communityId, channelId, limit);
    return ok(c, messages);
  } catch (error: unknown) {
    console.error("get channel messages failed", error);
    return fail(c, "failed to get messages", 500);
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
      return fail(c, "community not found", 404);
    }

    // Verify user is member
    if (!(await requireMember(store, communityId, user.id, c.env))) {
      return fail(c, "forbidden", 403);
    }

    // Verify channel exists
    const channel = await store.getChannel?.(communityId, channelId);
    if (!channel) {
      return fail(c, "channel not found", 404);
    }

    const content = String(body.content || "").trim();
    if (!content) {
      return fail(c, "content required", 400);
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

export function createTakosApp(
  config: CreateTakosAppConfig | string = {},
  instanceDomain: string,
): Hono<{ Bindings: Bindings; Variables: Variables }> {
  const resolvedDomain =
    typeof instanceDomain === "string" && instanceDomain.trim()
      ? instanceDomain.trim().toLowerCase()
      : undefined;
  if (!resolvedDomain) {
    throw new Error("createTakosApp requires an instanceDomain argument");
  }
  const normalizedConfig: CreateTakosAppConfig =
    typeof config === "string" ? {} : { ...config };
  normalizedConfig.instanceDomain = resolvedDomain;
  applyConfig(normalizedConfig);
  return app;
}

// Scheduled handlers for delivery, inbox, and cleanup workers
import { handleDeliveryScheduled, processInboxQueue, handleCleanupScheduled } from "@takos/platform/server";

type ScheduledTaskRunner = (event: ScheduledEvent, env: any) => Promise<void>;

const scheduledTaskHandlers: Record<string, ScheduledTaskRunner> = {
  "activitypub-workers": async (event, env) => {
    await Promise.all([
      handleDeliveryScheduled(event, env),
      processInboxQueue(env, 10),
    ]);
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
  "activitypub-cleanup": async (event, env) => {
    await handleCleanupScheduled(event, env);
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
