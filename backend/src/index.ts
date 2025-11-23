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
  createUserJWT,
  authenticateJWT,
  activityPubRoutes,
  setDataFactory,
  setPrismaFactory,
  setInstanceConfig,
  ok,
  fail,
} from "@takos/platform/server";
import { buildPushRegistrationPayload } from "./lib/push-registration";
import { createJwtStoreAdapter } from "./lib/jwt-store";
import type {
  PublicAccountBindings as Bindings,
  Variables,
  PrismaEnv,
} from "@takos/platform/server";
import { authenticateSession } from "@takos/platform/server/session";
/// <reference types="@cloudflare/workers-types" />

// Import route modules
import usersRoutes from "./routes/users";
import communitiesRoutes from "./routes/communities";
import postsRoutes from "./routes/posts";
import storiesRoutes from "./routes/stories";
import chatRoutes from "./routes/chat";
import mediaRoutes from "./routes/media";
import { auth, optionalAuth, authenticateUser } from "./middleware/auth";

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
    "Content-Type, Authorization";
  const allowMethods = "GET,POST,PUT,PATCH,DELETE,OPTIONS";

  if (c.req.method === "OPTIONS") {
    const headers = new Headers();
    headers.set("Access-Control-Allow-Origin", allowOrigin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Headers", allowHeaders);
    headers.set("Access-Control-Allow-Methods", allowMethods);
    headers.set("Access-Control-Max-Age", "86400");
    headers.append("Vary", "Origin");
    return new Response(null, { status: 204, headers });
  }

  await next();

  const responseHeaders = c.res.headers;
  responseHeaders.set("Access-Control-Allow-Origin", allowOrigin);
  responseHeaders.set("Access-Control-Allow-Credentials", "true");
  responseHeaders.set("Access-Control-Allow-Headers", allowHeaders);
  responseHeaders.set("Access-Control-Allow-Methods", allowMethods);
  responseHeaders.append("Vary", "Origin");
});

// Ensure the D1 schema exists before any handlers run
app.use("*", async (c, next) => {
  await ensureDatabaseFn(c.env);
  await next();
});

// Mount ActivityPub routes (WebFinger, Actor, Inbox, Outbox)
// Scope to ActivityPub paths to avoid intercepting API routes.
app.route("/ap", activityPubRoutes);
app.route("/.well-known", activityPubRoutes);

// Mount feature route modules
// IMPORTANT: usersRoutes and communitiesRoutes must be mounted BEFORE postsRoutes
// to prevent catch-all routes in postsRoutes from shadowing specific routes
app.route("/", usersRoutes);
app.route("/", communitiesRoutes);
app.route("/", postsRoutes);
app.route("/", storiesRoutes);
app.route("/", chatRoutes);
app.route("/", mediaRoutes);

// Root endpoint for health/checks and baseline tests
app.get("/", (c) => c.text("Hello World!"));

app.get("/.well-known/takos-push.json", (c) => {
  const instance = c.env.INSTANCE_DOMAIN?.trim();
  const tenant = instance || "";
  const publicKey = c.env.PUSH_REGISTRATION_PUBLIC_KEY?.trim();
  if (!instance || !publicKey) {
    return c.json({ ok: false, error: "push not configured" }, 503);
  }
  const body = {
    instance,
    tenant,
    registrationPublicKey: publicKey,
    webhook: {
      algorithm: "ES256",
      publicKey,
    },
  };
  const response = c.json(body);
  response.headers.set("Cache-Control", "public, max-age=300, immutable");
  return response;
});

// Helpers
const nowISO = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const addHours = (date: Date, h: number) =>
  new Date(date.getTime() + h * 3600 * 1000);

const encoder = new TextEncoder();
const PASSWORD_PROVIDER = "password";
const HANDLE_REGEX = /^[a-z0-9_]{3,32}$/;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return toHex(new Uint8Array(digest));
}

function generateSalt(length = 16): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

async function hashPasswordValue(password: string, salt?: string) {
  const actualSalt = salt || generateSalt();
  const hash = await sha256Hex(`${actualSalt}:${password}`);
  return `${actualSalt}$${hash}`;
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

async function getPasswordAccount(
  db: D1Database,
  userId: string,
): Promise<{ id: string; secret: string } | null> {
  const prisma = getPrisma(db);
  try {
    const account = await prisma.user_accounts.findFirst({
      where: { provider: PASSWORD_PROVIDER, user_id: userId },
      select: { id: true, provider_account_id: true },
    });
    return account
      ? { id: account.id, secret: account.provider_account_id }
      : null;
  } finally {
    await prisma.$disconnect();
  }
}

async function upsertPasswordAccount(
  db: D1Database,
  userId: string,
  hashed: string,
) {
  const prisma = getPrisma(db);
  try {
    const existing = await prisma.user_accounts.findFirst({
      where: { provider: PASSWORD_PROVIDER, user_id: userId },
      select: { id: true },
    });

    if (existing) {
      await prisma.user_accounts.update({
        where: { id: existing.id },
        data: {
          provider_account_id: hashed,
          updated_at: new Date(),
        },
      });
      return;
    }

    await prisma.user_accounts.create({
      data: {
        id: crypto.randomUUID(),
        user_id: userId,
        provider: PASSWORD_PROVIDER,
        provider_account_id: hashed,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

function normalizeHandle(input: string): string {
  return input.trim().toLowerCase();
}

function isValidHandle(handle: string) {
  return HANDLE_REGEX.test(handle);
}

function isValidPassword(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) return false;
  if (password.length > MAX_PASSWORD_LENGTH) return false;
  return true;
}

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

type PushRegistrationEnvelope = Awaited<
  ReturnType<typeof buildPushRegistrationPayload>
>;

async function syncPushDeviceWithHost(
  env: Bindings,
  signedPayload: PushRegistrationEnvelope,
) {
  const gatewayUrl = env.PUSH_GATEWAY_URL?.trim();
  if (!gatewayUrl) {
    console.warn("push gateway URL not configured; skipping KV sync");
    return;
  }
  let endpoint: URL;
  try {
    endpoint = new URL("/push/register", gatewayUrl);
  } catch (error) {
    console.error("invalid PUSH_GATEWAY_URL", gatewayUrl, error);
    return;
  }
  try {
    const res = await fetch(endpoint.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(signedPayload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(
        "push gateway sync failed",
        signedPayload.action,
        res.status,
        text,
      );
    }
  } catch (error) {
    console.error("push gateway sync error", error);
  }
}

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

app.post("/media/upload", auth, async (c) => {
  const env = c.env as Bindings;
  if (!env.MEDIA) return fail(c, "media storage not configured", 500);
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    if (!user?.id) return fail(c, "Unauthorized", 401);

    const form = await c.req.formData().catch(() => null);
    if (!form) return fail(c, "invalid form data", 400);
    const file = form.get("file") as File | null;
    if (!file) return fail(c, "file required", 400);
    const ext = safeFileExt((file as any).name || "", file.type);
    const id = crypto.randomUUID().replace(/-/g, "");
    const prefix = `user-uploads/${(user as any)?.id || "anon"}/${datePrefix()}`;
    const key = `${prefix}/${id}${ext ? "." + ext : ""}`;
    await env.MEDIA.put(key, file, {
      httpMetadata: {
        contentType: file.type || "application/octet-stream",
        cacheControl: "public, max-age=31536000, immutable",
      },
    });
    const url = `/media/${encodeURI(key)}`;
    return ok(c, { key, url }, 201);
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
    return ok(c, {
      key: stripUserStoragePrefix(key, (user as any)?.id || "anon"),
      full_key: key,
      url,
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

// (Removed) Mock login endpoint for development

// Registration disabled - using environment variable authentication
app.post("/auth/password/register", async (c) => {
  if (!featureEnabled("envPasswordAuth")) {
    return fail(c, "password authentication disabled", 404);
  }
  return fail(c, "registration disabled - use environment variables for authentication", 403);
});

app.post("/auth/password/login", async (c) => {
  if (!featureEnabled("envPasswordAuth")) {
    return fail(c, "password authentication disabled", 404);
  }
  const body = (await c.req.json().catch(() => ({}))) as Record<string, any>;
  const username = typeof body.handle === "string" ? body.handle : "";
  const password = typeof body.password === "string" ? body.password : "";

  // Check against environment variables
  const envUsername = c.env.AUTH_USERNAME;
  const envPassword = c.env.AUTH_PASSWORD;

  if (!envUsername || !envPassword) {
    return fail(c, "authentication not configured", 500);
  }

  if (username !== envUsername || password !== envPassword) {
    return fail(c, "invalid credentials", 401);
  }

  // Get the single user from database (assumes single-user setup)
  const store = makeData(c.env as any, c);
  try {
    const user = await store.getUser(envUsername);
    if (!user) {
      return fail(c, "user not found in database", 500);
    }
    const { token } = await createUserJWT(c, store, user.id);
    return ok(c, { user, token });
  } finally {
    await releaseStore(store);
  }
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
    return ok(c, { token, user: authResult.user });
  } finally {
    await releaseStore(store);
  }
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
) {
  if (!communityId) return true;
  return await store.hasMembership(communityId, userId);
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
    if (!(await requireMember(store, targetCommunityId, user.id))) {
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
  options: { communityId?: string | null; allowBodyCommunityOverride?: boolean } = {},
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
    if (!(await requireMember(store, targetCommunityId, user.id))) {
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
    await enqueueDeliveriesToFollowers(store, user.id, post.ap_activity_id!);
    
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
    await enqueueDeliveriesToFollowers(store, user.id, post.ap_activity_id!);
    
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
  if (!(await requireMember(store, community_id, user.id))) {
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
  if (!(await requireMember(store, (post as any).community_id, user.id))) {
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
  if (!(await requireMember(store, (post as any).community_id, user.id))) {
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
  if (!(await requireMember(store, community_id, user.id))) {
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

app.get("/me", auth, (c) => {
  console.log("[backend] /me handler", {
    path: new URL(c.req.url).pathname,
    method: c.req.method,
  });
  const user = c.get("user");
  return ok(c, user);
});

// Update my profile
app.patch("/me", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const user = c.get("user") as any;
  const body = await c.req.json().catch(() => ({})) as any;
  const updates: Record<string, any> = {};
  let newHandle: string | null = null;
  const shouldMarkComplete = !user.profile_completed_at;

  if (typeof body.display_name === "string") {
    updates.display_name = String(body.display_name).slice(0, 100);
  }
  if (typeof body.avatar_url === "string") {
    updates.avatar_url = String(body.avatar_url).slice(0, 500);
  }
  if (typeof body.handle === "string") {
    const handle = String(body.handle).trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(handle)) {
      return fail(c, "invalid handle", 400);
    }
    if (handle !== user.id) {
      const existing = await store.getUser(handle);
      if (existing) {
        return fail(c, "handle already taken", 409);
      }
      newHandle = handle;
    }
  } else if (body.handle !== undefined) {
    return fail(c, "invalid handle", 400);
  }

  if (shouldMarkComplete) {
    updates.profile_completed_at = nowISO();
  }

  if (!Object.keys(updates).length && !newHandle) {
    return fail(c, "no valid fields", 400);
  }

  let currentId = user.id as string;
  let updated: any = null;

  if (newHandle) {
    updated = await store.renameUserId(currentId, newHandle);
    currentId = newHandle;
  }

  if (Object.keys(updates).length) {
    updated = await store.updateUser(currentId, updates);
  }

  if (!updated) {
    updated = await store.getUser(currentId);
  }

  c.set("user", updated);
  return ok(c, updated);
});

const normalizeUserIdParam = (input: string): string => {
  const trimmed = (input || "").trim();
  const withoutPrefix = trimmed.replace(/^@+/, "");
  if (!withoutPrefix.includes("@")) {
    return withoutPrefix || trimmed;
  }
  const [local] = withoutPrefix.split("@");
  return local || withoutPrefix || trimmed;
};

// Fetch another user's public profile
app.get("/users/:id", optionalAuth, async (c) => {
  const store = makeData(c.env as any, c);
  const me = c.get("user") as any;
  const rawId = c.req.param("id");
  const normalizedId = normalizeUserIdParam(rawId);
  const u: any = await store.getUser(normalizedId);
  if (!u) return fail(c, "user not found", 404);
  // Accounts are private by default. For now, still return basic profile, and include friend status.
  let relation: any = null;
  if (me?.id && normalizedId !== me.id) {
    relation = await store.getFriendshipBetween(me.id, normalizedId).catch(() => null);
  }
  return ok(c, { ...u, friend_status: relation?.status || null });
});

// ---- Friendships ----
app.post("/users/:id/friends", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const me = c.get("user") as any;
  const targetId = c.req.param("id");
  if (me.id === targetId) return fail(c, "cannot friend yourself");
  const existing: any = await store
    .getFriendshipBetween(me.id, targetId)
    .catch(() => null);
  if (existing) {
    if (existing.status === "accepted") return ok(c, existing);
    if (existing.status === "pending" && existing.addressee_id === me.id) {
      const updated = await store.setFriendStatus(
        existing.requester_id,
        existing.addressee_id,
        "accepted",
      );
      await notify(
        store,
        c.env as Bindings,
        existing.requester_id,
        "friend_accepted",
        me.id,
        "user",
        me.id,
        `${me.display_name} が友達リクエストを承認しました`,
      );
      return ok(c, updated);
    }
    if (existing.status === "pending" && existing.requester_id === me.id) {
      return ok(c, existing);
    }
  }
  const created: any = await store.createFriendRequest(me.id, targetId);
  await notify(
    store,
    c.env as Bindings,
    targetId,
    "friend_request",
    me.id,
    "user",
    me.id,
    `${me.display_name} から友達リクエスト`,
  );
  return ok(c, created, 201);
});

app.post("/users/:id/friends/accept", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const me = c.get("user") as any;
  const requesterId = c.req.param("id");
  const rel: any = await store.getFriendRequest(requesterId, me.id);
  if (!rel || rel.status !== "pending") {
    return fail(c, "no pending request", 400);
  }
  const updated: any = await store.setFriendStatus(
    requesterId,
    me.id,
    "accepted",
  );
  await notify(
    store,
    c.env as Bindings,
    requesterId,
    "friend_accepted",
    me.id,
    "user",
    me.id,
    `${me.display_name} が友達リクエストを承認しました`,
  );
  
  // Generate and save Accept Activity for Follow
  const instanceDomain = requireInstanceDomain(c.env);
  const actorUri = getActorUri(me.id, instanceDomain);
  const requesterUri = getActorUri(requesterId, instanceDomain);
  
  // Find the original Follow activity ID (stored in ap_followers or friendships)
  const followRecord = await store.findApFollower(me.id, requesterUri);
  const followActivityId =
    followRecord?.activity_id ||
    followRecord?.id ||
    `${requesterUri}/follows/${me.id}`;
  
  const activityId = getActivityUri(
    me.id,
    `accept-follow-${requesterId}-${Date.now()}`,
    instanceDomain,
  );
  const acceptActivity = {
    "@context": ACTIVITYSTREAMS_CONTEXT,
    type: "Accept",
    id: activityId,
    actor: actorUri,
    object: {
      type: "Follow",
      id: followActivityId,
      actor: requesterUri,
      object: actorUri,
    },
    published: new Date().toISOString(),
  };
  
  await store.upsertApOutboxActivity({
    id: crypto.randomUUID(),
    local_user_id: me.id,
    activity_id: activityId,
    activity_type: "Accept",
    activity_json: JSON.stringify(acceptActivity),
    object_id: followActivityId,
    object_type: "Follow",
    created_at: new Date(),
  });
  
  // Enqueue delivery to requester
  const requesterActor = await store.findApActor(requesterUri);
  if (requesterActor?.inbox_url) {
    await store.createApDeliveryQueueItem({
      id: crypto.randomUUID(),
      activity_id: activityId,
      target_inbox_url: requesterActor.inbox_url,
      status: "pending",
      created_at: new Date(),
    });
  }
  
  return ok(c, updated);
});

app.post("/users/:id/friends/reject", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const me = c.get("user") as any;
  const requesterId = c.req.param("id");
  const rel: any = await store.getFriendRequest(requesterId, me.id);
  if (!rel || rel.status !== "pending") {
    return fail(c, "no pending request", 400);
  }
  const updated: any = await store.setFriendStatus(
    requesterId,
    me.id,
    "rejected",
  );
  
  // Generate and save Reject Activity for Follow
  const instanceDomain = requireInstanceDomain(c.env);
  const actorUri = getActorUri(me.id, instanceDomain);
  const requesterUri = getActorUri(requesterId, instanceDomain);
  
  // Find the original Follow activity ID
  const followRecord = await store.findApFollower(me.id, requesterUri);
  const followActivityId =
    followRecord?.activity_id ||
    followRecord?.id ||
    `${requesterUri}/follows/${me.id}`;
  
  const activityId = getActivityUri(
    me.id,
    `reject-follow-${requesterId}-${Date.now()}`,
    instanceDomain,
  );
  const rejectActivity = {
    "@context": ACTIVITYSTREAMS_CONTEXT,
    type: "Reject",
    id: activityId,
    actor: actorUri,
    object: {
      type: "Follow",
      id: followActivityId,
      actor: requesterUri,
      object: actorUri,
    },
    published: new Date().toISOString(),
  };
  
  await store.upsertApOutboxActivity({
    id: crypto.randomUUID(),
    local_user_id: me.id,
    activity_id: activityId,
    activity_type: "Reject",
    activity_json: JSON.stringify(rejectActivity),
    object_id: followActivityId,
    object_type: "Follow",
    created_at: new Date(),
  });
  
  // Enqueue delivery to requester
  const requesterActor = await store.findApActor(requesterUri);
  if (requesterActor?.inbox_url) {
    await store.createApDeliveryQueueItem({
      id: crypto.randomUUID(),
      activity_id: activityId,
      target_inbox_url: requesterActor.inbox_url,
      status: "pending",
      created_at: new Date(),
    });
  }
  
  return ok(c, updated);
});

app.get("/me/friends", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const me = c.get("user") as any;
  const list = await store.listFriendships(me.id, "accepted");
  return ok(c, list);
});

app.get("/me/friend-requests", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const me = c.get("user") as any;
  const url = new URL(c.req.url);
  const direction = url.searchParams.get("direction");
  const list = await store.listFriendships(me.id, "pending");
  const filtered = list.filter((edge: any) => {
    if (direction === "incoming") return edge.addressee_id === me.id;
    if (direction === "outgoing") return edge.requester_id === me.id;
    return true;
  });
  return ok(c, filtered);
});

app.post("/me/push-devices", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const me = c.get("user") as any;
    const body = await c.req.json().catch(() => ({})) as any;
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) return fail(c, "token is required", 400);
    const platformRaw = typeof body.platform === "string" ? body.platform.trim() : "";
    const platform = platformRaw || "unknown";
    const deviceName = typeof body.device_name === "string"
      ? body.device_name.slice(0, 255)
      : "";
    const locale = typeof body.locale === "string"
      ? body.locale.slice(0, 32)
      : "";
    await store.registerPushDevice({
      user_id: me.id,
      token,
      platform: platform.slice(0, 32),
      device_name: deviceName,
      locale,
    });
    const instance = c.env.INSTANCE_DOMAIN!;
    let registration: PushRegistrationEnvelope | null = null;
    try {
      registration = await buildPushRegistrationPayload(c.env, {
        action: "register",
        payload: {
          instance,
          userId: me.id,
          token,
          platform,
          appId: typeof body.appId === "string" ? body.appId : "",
        },
      });
    } catch (error) {
      console.error("failed to sign push registration payload", error);
    }
    if (registration) {
      await syncPushDeviceWithHost(c.env, registration);
    }
    return ok(c, { token, platform, registration });
  } finally {
    await releaseStore(store);
  }
});

app.delete("/me/push-devices", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const body = await c.req.json().catch(() => ({})) as any;
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) return fail(c, "token is required", 400);
    await store.removePushDevice(token);
    const me = c.get("user") as any;
    const instance = c.env.INSTANCE_DOMAIN!;
    let registration: PushRegistrationEnvelope | null = null;
    try {
      registration = await buildPushRegistrationPayload(c.env, {
        action: "deregister",
        payload: {
          instance,
          userId: me?.id || "",
          token,
          platform: "",
          appId: "",
        },
      });
    } catch (error) {
      console.error("failed to sign push deregistration payload", error);
    }
    if (registration) {
      await syncPushDeviceWithHost(c.env, registration);
    }
    return ok(c, { token, removed: true, registration });
  } finally {
    await releaseStore(store);
  }
});

// ---- Notifications ----
app.get("/notifications", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const me = c.get("user") as any;
  const list = await store.listNotifications(me.id);
  return ok(c, list);
});

app.post("/notifications/:id/read", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const me = c.get("user") as any;
  const id = c.req.param("id");
  await store.markNotificationRead(id);
  const count = await store.countUnreadNotifications(me.id);
  return ok(c, { id, read: true, unread_count: count });
});

app.get("/me/communities", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const user = c.get("user") as any;
  const list = await store.listUserCommunities(user.id);
  return ok(c, list);
});

app.post("/posts/:id/reactions", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const user = c.get("user") as any;
  const post_id = c.req.param("id");
  const post = await store.getPost(post_id);
  if (!post) return fail(c, "post not found", 404);
  if (!(await requireMember(store, (post as any).community_id, user.id))) {
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
    await store.createApDeliveryQueueItem({
      id: crypto.randomUUID(),
      activity_id: ap_activity_id,
      target_inbox_url: postAuthorInbox,
      status: "pending",
      created_at: new Date(),
    });
  }
  
  // Enqueue delivery to followers (optimized)
  await enqueueDeliveriesToFollowers(store, user.id, ap_activity_id);
  
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
  if (!(await requireMember(store, (post as any).community_id, user.id))) {
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
    await store.createApDeliveryQueueItem({
      id: crypto.randomUUID(),
      activity_id: ap_activity_id,
      target_inbox_url: postAuthorInbox,
      status: "pending",
      created_at: new Date(),
    });
  }
  
  // Enqueue delivery to followers (optimized)
  await enqueueDeliveriesToFollowers(store, user.id, ap_activity_id);
  
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

function cleanupExpiredStories() {/* read-time filter only */}

app.post("/communities/:id/stories", auth, async (c) => {
  const store = makeData(c.env, c);
  const user = c.get("user") as any;
  const community_id = c.req.param("id");
  const body = await c.req.json().catch(() => ({})) as any;
  try {
    const story = await buildStoryPayload(store, user, body, {
      communityId: community_id,
      allowBodyCommunityOverride: false,
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
    const story = await buildStoryPayload(store, user, body);
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
  cleanupExpiredStories();
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
  if (!(await requireMember(store, community_id, user.id))) {
    return fail(c, "forbidden", 403);
  }
  cleanupExpiredStories();
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
    if (!(await requireMember(store, story.community_id, user.id))) {
      return fail(c, "forbidden", 403);
    }
  } else if (story.author_id !== user.id) {
    const visibleToFriends = (story as any).visible_to_friends ?? true;
    if (!visibleToFriends) {
      return fail(c, "forbidden", 403);
    }
    const relation = await store
      .getFriendshipBetween(user.id, story.author_id)
      .catch(() => null);
    if (!relation || relation.status !== "accepted") {
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
        ])
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
        ])
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
    if (!(await requireMember(store, communityId, user.id))) {
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
    if (!(await requireMember(store, communityId, user.id))) {
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

export async function handleScheduled(event: ScheduledEvent, env: any): Promise<void> {
  console.log("Scheduled event triggered:", event.cron);
  
  // Check if this is the daily cleanup cron (0 2 * * *)
  // vs the regular worker cron (*/5 * * * *)
  const isCleanupCron = event.cron === "0 2 * * *";
  
  if (isCleanupCron) {
    // Daily cleanup at 2 AM UTC
    console.log("Running daily cleanup worker...");
    await handleCleanupScheduled(event, env);
  } else {
    // Regular workers (every 5 minutes)
    console.log("Running delivery and inbox workers...");
    await Promise.all([
      handleDeliveryScheduled(event, env),
      processInboxQueue(env, 10),
    ]);
  }
}
