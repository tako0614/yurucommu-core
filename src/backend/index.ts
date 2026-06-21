import { Hono } from "hono";
import type { Env, EnvVars, Variables } from "./types.ts";
import { extractActorFromSession } from "./lib/session-actor.ts";
import { isBackendPath } from "./lib/backend-paths.ts";
import { wrapCloudflareBindings } from "./runtime/cloudflare.ts";
import {
  getOidcClientCredentials,
  getOidcIssuerUrl,
} from "./lib/oauth-providers.ts";

import authRoutes from "./routes/auth.ts";
import actorsRoutes from "./routes/actors.ts";
import followRoutes from "./routes/follow.ts";
import timelineRoutes from "./routes/timeline.ts";
import postsRoutes from "./routes/posts.ts";
import notificationsRoutes from "./routes/notifications.ts";
import storiesRoutes from "./routes/stories.ts";
import searchRoutes from "./routes/search.ts";
import communitiesRoutes from "./routes/communities.ts";
import dmRoutes from "./routes/dm.ts";
import mediaRoutes from "./routes/media.ts";
import activitypubRoutes from "./routes/activitypub.ts";
import takosProxyRoutes from "./routes/takos-proxy.ts";
import takosToolsRoutes from "./routes/takos-tools.ts";
import recommendationsRoutes from "./routes/recommendations.ts";
import { moderationRoutes } from "./routes/moderation.ts";
import { appsApiRoutes, appsServeRoutes } from "./routes/apps.ts";

import { rateLimit, RateLimitConfigs } from "./middleware/rate-limit.ts";
import { csrfProtection } from "./middleware/csrf.ts";
import { createErrorMiddleware } from "./middleware/error-handler.ts";
import {
  bodyLimit,
  DEFAULT_BODY_LIMIT_BYTES,
} from "./middleware/body-limit.ts";
import { logger } from "./lib/logger.ts";

const log = logger.child({ component: "backend.index" });
import type { MessageBatch } from "@cloudflare/workers-types";
import type {
  DeliveryDlqMessageV1,
  DeliveryQueueMessageV1,
} from "./lib/delivery/types.ts";
import {
  handleDeliveryDlqBatch,
  handleDeliveryQueueBatch,
} from "./lib/delivery/queue.ts";

type YurucommuApp = Hono<{ Bindings: Env; Variables: Variables }>;

export const YURUCOMMU_BACKEND_PLUGIN_API_VERSION = 1 as const;

export interface BackendPluginContextV1 {
  app: YurucommuApp;
}

export interface YurucommuBackendPluginV1 {
  apiVersion: typeof YURUCOMMU_BACKEND_PLUGIN_API_VERSION;
  name: string;
  setup?: (ctx: BackendPluginContextV1) => void;
  beforeRoutes?: (ctx: BackendPluginContextV1) => void;
  afterRoutes?: (ctx: BackendPluginContextV1) => void;
}

export interface CreateYurucommuBackendAppOptionsV1 {
  plugins?: YurucommuBackendPluginV1[];
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
  ".webp": "image/webp",
  ".wasm": "application/wasm",
};

function getMimeType(path: string): string {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

// Hard runtime preconditions: without these the worker cannot serve a request
// correctly, so /readyz must 503 when any is missing. A correctly-provisioned
// fresh install (Capsule supplies APP_URL + ENCRYPTION_KEY + an auth method,
// platform supplies DB + KV) satisfies all of these and is therefore ready.
function collectMissingRequiredBindings(env: Env): string[] {
  const missing: string[] = [];
  const hasValue = (value: string | undefined): boolean => !!value?.trim();
  if (!env.DB_INSTANCE) missing.push("DB");
  if (!env.KV) missing.push("KV");
  if (!hasValue(env.APP_URL)) missing.push("APP_URL");
  if (!hasValue(env.ENCRYPTION_KEY)) missing.push("ENCRYPTION_KEY");
  const hasPassword = hasValue(env.AUTH_PASSWORD_HASH);
  const hasGoogle =
    hasValue(env.GOOGLE_CLIENT_ID) && hasValue(env.GOOGLE_CLIENT_SECRET);
  const hasX = hasValue(env.X_CLIENT_ID) && hasValue(env.X_CLIENT_SECRET);
  const oidcCredentials = getOidcClientCredentials(env);
  const hasAccountsOidc =
    hasValue(getOidcIssuerUrl(env) ?? undefined) &&
    hasValue(oidcCredentials.clientId) &&
    hasValue(oidcCredentials.clientSecret);
  if (!hasPassword && !hasGoogle && !hasX && !hasAccountsOidc) {
    missing.push("AUTH_METHOD");
  }
  return missing;
}

// Optional capabilities the worker can run WITHOUT and still be "ready":
//   - MEDIA: media storage; uploads are unavailable but the rest of the app
//     (timeline, posts, federation reads) serves normally. MEDIA is optional in
//     the Env type and may be replaced by a STORAGE-backed asset path.
//   - DELIVERY_QUEUE / DELIVERY_DLQ: outbound federation delivery. When unbound,
//     enqueued activities are buffered/persisted and re-fire once the bindings
//     appear (see lib/delivery/queue.ts); local dev only attaches them behind
//     YURUCOMMU_ENABLE_LOCAL_DELIVERY_QUEUE. Treating these as hard-required
//     would 503 a perfectly serviceable install, so they are reported as
//     degraded info on /healthz but do not fail /readyz.
function collectMissingOptionalBindings(env: Env): string[] {
  const missing: string[] = [];
  if (!env.MEDIA) missing.push("MEDIA");
  if (!env.DELIVERY_QUEUE) missing.push("DELIVERY_QUEUE");
  if (!env.DELIVERY_DLQ) missing.push("DELIVERY_DLQ");
  return missing;
}

// Full binding report in the original declaration order (DB, MEDIA, KV,
// DELIVERY_QUEUE, DELIVERY_DLQ, APP_URL, ENCRYPTION_KEY, AUTH_METHOD). Used by
// /healthz and surfaced in /readyz's missingBindings for visibility; /readyz's
// status/code is driven by the required subset only (see collectMissingRequiredBindings).
function collectMissingRuntimeBindings(env: Env): string[] {
  const missing: string[] = [];
  const hasValue = (value: string | undefined): boolean => !!value?.trim();
  if (!env.DB_INSTANCE) missing.push("DB");
  if (!env.MEDIA) missing.push("MEDIA");
  if (!env.KV) missing.push("KV");
  if (!env.DELIVERY_QUEUE) missing.push("DELIVERY_QUEUE");
  if (!env.DELIVERY_DLQ) missing.push("DELIVERY_DLQ");
  if (!hasValue(env.APP_URL)) missing.push("APP_URL");
  if (!hasValue(env.ENCRYPTION_KEY)) missing.push("ENCRYPTION_KEY");
  const hasPassword = hasValue(env.AUTH_PASSWORD_HASH);
  const hasGoogle =
    hasValue(env.GOOGLE_CLIENT_ID) && hasValue(env.GOOGLE_CLIENT_SECRET);
  const hasX = hasValue(env.X_CLIENT_ID) && hasValue(env.X_CLIENT_SECRET);
  const oidcCredentials = getOidcClientCredentials(env);
  const hasAccountsOidc =
    hasValue(getOidcIssuerUrl(env) ?? undefined) &&
    hasValue(oidcCredentials.clientId) &&
    hasValue(oidcCredentials.clientSecret);
  if (!hasPassword && !hasGoogle && !hasX && !hasAccountsOidc) {
    missing.push("AUTH_METHOD");
  }
  return missing;
}

function isStrictReadinessEnabled(env: Env): boolean {
  const value = env.YURUCOMMU_STRICT_READINESS?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function mountReadinessRoutes(app: YurucommuApp): void {
  app.get("/healthz", (c) => {
    // /healthz reports the full picture (required + optional capabilities) so
    // operators can see degraded-but-serving states. The 503 gate stays opt-in
    // via YURUCOMMU_STRICT_READINESS for a hard all-or-nothing health check.
    const missing = collectMissingRuntimeBindings(c.env);
    const strict = isStrictReadinessEnabled(c.env);
    return c.json(
      {
        status:
          missing.length === 0 ? "ok" : strict ? "misconfigured" : "degraded",
        service: "yurucommu",
        missingBindings: missing,
      },
      strict && missing.length > 0 ? 503 : 200,
    );
  });

  app.get("/readyz", (c) => {
    // Readiness keys off the HARD preconditions only. Optional capabilities
    // (MEDIA, DELIVERY_QUEUE, DELIVERY_DLQ) are still reported in
    // missingBindings for visibility, but their absence does NOT flip the
    // worker to not-ready: a correctly-provisioned fresh install with
    // APP_URL + ENCRYPTION_KEY + an auth method (and DB + KV) is ready even
    // before media storage / federation delivery queues are bound. The status
    // and HTTP code are therefore driven solely by the required set, while
    // missingBindings still surfaces every gap.
    const missingRequired = collectMissingRequiredBindings(c.env);
    const missing = collectMissingRuntimeBindings(c.env);
    return c.json(
      {
        status: missingRequired.length === 0 ? "ok" : "misconfigured",
        service: "yurucommu",
        missingBindings: missing,
      },
      missingRequired.length === 0 ? 200 : 503,
    );
  });

  // Operator-sensible crawler defaults. Allow the public landing / actor
  // profile HTML to be indexed, but keep the JSON API and the machine-only
  // ActivityPub federation surface out of search crawlers. Mounted alongside
  // the readiness probes so they answer BEFORE body-size / payload validation
  // middleware and stay reachable in any runtime mode.
  app.get("/robots.txt", (c) => {
    const body = [
      "User-agent: *",
      "Disallow: /api/",
      "Disallow: /ap/",
      "Disallow: /.takos/",
      "Disallow: /hosted/",
      "Disallow: /media/",
      "Allow: /",
      "",
    ].join("\n");
    return c.body(body, 200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    });
  });

  // Minimal RFC 9116 security.txt. The contact points operators at the
  // instance admin; APP_URL (when configured) makes the policy line concrete.
  app.get("/.well-known/security.txt", (c) => {
    const appUrl = c.env.APP_URL?.trim().replace(/\/+$/, "");
    const lines = ["Contact: mailto:security@yurucommu.invalid"];
    if (appUrl) {
      lines.push(`Policy: ${appUrl}/.well-known/security.txt`);
    }
    lines.push("Preferred-Languages: en, ja");
    lines.push("");
    return c.body(lines.join("\n"), 200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    });
  });
}

// media.ts advertises MAX_VIDEO_SIZE = 100MB (and MAX_IMAGE_SIZE = 20MB) and
// returns a friendly 413 citing those numbers. The pre-route body cap MUST sit
// at or above the largest advertised media size, otherwise an upload between
// the body cap and the advertised limit is rejected by the cap FIRST with a
// generic error, making the advertised limit unreachable and the friendly 413
// dead. media.ts buffers the whole file in Worker memory (formData() +
// arrayBuffer(), ~2x the file size), so the cap is also the memory ceiling:
// it is sized to just cover MAX_VIDEO_SIZE = 40MB (40 * 1024 * 1024) plus
// multipart/form-data envelope overhead (= 48 MiB), keeping peak buffering
// well under the Workers ~128MB per-request memory budget while leaving the
// friendly per-size 413 in media.ts reachable.
const MEDIA_UPLOAD_BODY_LIMIT_BYTES = 48 * 1024 * 1024; // 48 MiB
const INBOX_BODY_LIMIT_BYTES = 512 * 1024; // 512 KiB

function applyBodyLimits(app: YurucommuApp): void {
  // Per-route caps are registered BEFORE the global default cap. The stricter
  // inbox cap (512 KiB) wins for /ap/*/inbox; the LARGER media-upload cap
  // (48 MiB) wins for /api/media/*. ActivityPub inbox is unauthenticated and
  // federation peers can hammer it, so its cap matches the rate-limit
  // assumption (small JSON activities).
  //
  // IMPORTANT: Hono runs every matching `use()` middleware in registration
  // order, and bodyLimit always calls next() when the request is within its
  // own cap. That means the trailing default `*` cap below ALSO runs on
  // /api/media/* and /ap/*/inbox. For the inbox routes that is harmless — the
  // stricter 512 KiB cap already rejected anything the 1 MiB default would,
  // and a body that passed 512 KiB trivially passes 1 MiB. For media it is
  // NOT harmless: a 30 MB upload that passes the 48 MiB media cap would then
  // be rejected by the 1 MiB default cap with a generic `body_too_large`,
  // making the friendly per-size 413 in routes/media.ts (which advertises
  // MAX_VIDEO_SIZE = 100MB / MAX_IMAGE_SIZE = 20MB) unreachable. So the default
  // cap is registered with a path guard that SKIPS the media prefix, leaving
  // /api/media/* governed solely by its own 48 MiB cap.
  //
  // The inbox cap runs pre-auth, so a chunked body with no `Content-Length`
  // could otherwise bypass the declared-length check entirely. We require
  // `Content-Length` there and reject with 411 when it is missing — a
  // conformant ActivityPub delivery always sets it, so this only refuses
  // chunked-only senders (which are the DoS vector). Legitimate authenticated
  // upload routes keep the default streaming cap instead so chunked uploads
  // are not broken.
  app.use(
    "/ap/*/inbox",
    bodyLimit({
      maxBytes: INBOX_BODY_LIMIT_BYTES,
      requireContentLength: true,
    }),
  );
  // The advertised shared inbox is `/ap/inbox` (no middle path segment), which
  // the `/ap/*/inbox` pattern above does NOT match. It runs the same
  // verify/dispatch pipeline as the per-actor inboxes and is the primary
  // fan-out target for large servers, so it needs the same strict pre-auth
  // body cap.
  app.use(
    "/ap/inbox",
    bodyLimit({
      maxBytes: INBOX_BODY_LIMIT_BYTES,
      requireContentLength: true,
    }),
  );
  // Media uploads carry binary payloads (images, short videos). The cap covers
  // the largest advertised media size so routes/media.ts owns the friendly,
  // per-size 413; see the MEDIA_UPLOAD_BODY_LIMIT_BYTES note above.
  // mediaRoutes is mounted at BOTH /api/media and the bare /media prefix
  // (the latter is the public serve path used by AP/HTML), but media.ts also
  // registers POST /upload. That means /media/upload exists too and MUST get
  // the same large media cap — otherwise an advertised-size upload posted to
  // /media/upload would be rejected by the 1 MiB default cap with a generic
  // 413, a dead path. Apply the identical 48 MiB cap to /media/* so the cap
  // is consistent across both mounts.
  for (const prefix of ["/api/media/*", "/media/*"]) {
    app.use(prefix, bodyLimit({ maxBytes: MEDIA_UPLOAD_BODY_LIMIT_BYTES }));
  }
  // Default global cap: 1 MiB covers JSON-shaped API traffic. It must NOT also
  // clamp the media prefixes (whose intended cap is larger), so guard both.
  const defaultCap = bodyLimit({ maxBytes: DEFAULT_BODY_LIMIT_BYTES });
  app.use("*", async (c, next) => {
    const path = c.req.path;
    if (path.startsWith("/api/media/") || path.startsWith("/media/")) {
      return next();
    }
    return defaultCap(c, next);
  });
}

function applyGlobalMiddleware(app: YurucommuApp): void {
  app.onError(createErrorMiddleware());

  app.use("*", async (c, next) => {
    await next();

    const preserveRouteSecurityHeaders = c.req.path.startsWith("/hosted/");
    const setSecurityHeader = (name: string, value: string) => {
      if (preserveRouteSecurityHeaders && c.res.headers.has(name)) {
        return;
      }
      c.header(name, value);
    };

    setSecurityHeader("Cross-Origin-Opener-Policy", "same-origin");
    setSecurityHeader("Cross-Origin-Embedder-Policy", "credentialless");

    const takosUrl = c.env.TAKOS_URL?.trim();
    const oidcIssuer = getOidcIssuerUrl(c.env);
    // unpkg.com is only used by web/src/lib/ffmpeg.ts to fetch @ffmpeg/core
    // assets (JS + WASM). The fetched body is wrapped in a blob: URL via
    // toBlobURL before being imported, so script-src does NOT need unpkg —
    // only connect-src (for fetch) and blob: in script-src (for the wrapped
    // worker script). Pinning unpkg in script-src would make any compromised
    // npm package directly executable on this origin.
    const connectSrc = ["'self'", "https://unpkg.com", "wss:"];
    const formAction = ["'self'"];
    if (takosUrl) {
      connectSrc.push(takosUrl);
      formAction.push(takosUrl);
    }
    if (oidcIssuer) {
      connectSrc.push(oidcIssuer);
      formAction.push(oidcIssuer);
    }
    const csp = [
      "default-src 'self'",
      "script-src 'self' blob: https://static.cloudflareinsights.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "media-src 'self' data: blob:",
      "font-src 'self' data:",
      `connect-src ${connectSrc.join(" ")}`,
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
      `form-action ${formAction.join(" ")}`,
      "base-uri 'self'",
    ].join("; ");
    setSecurityHeader("Content-Security-Policy", csp);

    setSecurityHeader("X-Content-Type-Options", "nosniff");
    setSecurityHeader("X-Frame-Options", "DENY");
    setSecurityHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    setSecurityHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    // HSTS: once a client has reached this host over HTTPS, keep it on HTTPS
    // (defeats SSL-strip / downgrade). Sent unconditionally — browsers ignore it
    // when delivered over plain HTTP, so it is harmless for an HTTP-only
    // self-host, and correct behind a TLS-terminating proxy where the worker
    // sees HTTP but the client is on HTTPS. Deliberately NO includeSubDomains /
    // preload: this is a self-hostable app and must not force HTTPS onto sibling
    // subdomains the operator may serve over HTTP.
    setSecurityHeader("Strict-Transport-Security", "max-age=31536000");
  });

  app.use("*", async (c, next) => {
    c.set("db", c.env.DB_INSTANCE);
    await next();
  });

  app.use("/api/*", async (c, next) => {
    await extractActorFromSession(c);
    await next();
  });

  // The bare /media/* serve path (the URL stored in every attachment + actor
  // icon/header, embedded in AP docs and rendered by the SPA) also needs the
  // session: media authorization gates non-public blobs (followers-only /
  // direct / private-community story) and must recognize an authenticated
  // in-app viewer. A federation peer or logged-out visitor sends no session
  // cookie, so `extractActorFromSession` early-returns and they stay anonymous —
  // seeing only public media, exactly as before. No CSRF (these are GET reads),
  // and public media still returns a public/cacheable response.
  app.use("/media/*", async (c, next) => {
    await extractActorFromSession(c);
    await next();
  });

  // Takos tools endpoints may be called from the browser (same-origin) and rely on
  // the same session cookie auth as the rest of the API.
  app.use("/.takos/tools/*", async (c, next) => {
    await extractActorFromSession(c);
    await next();
  });

  app.use("/api/*", csrfProtection());
  app.use("/.takos/tools/*", csrfProtection());

  app.use("/api/*", rateLimit(RateLimitConfigs.general));
  app.use("/.takos/tools/*", rateLimit(RateLimitConfigs.general));
  app.use("/api/auth/*", rateLimit(RateLimitConfigs.auth));
  app.use("/api/search/*", rateLimit(RateLimitConfigs.search));
  app.use("/api/media/*", rateLimit(RateLimitConfigs.mediaUpload));
  // The bare /media mount serves media and also exposes POST /media/upload;
  // throttle it with the same media budget as /api/media/* for consistency.
  app.use("/media/*", rateLimit(RateLimitConfigs.mediaUpload));
  app.use("/api/dm/*", rateLimit(RateLimitConfigs.dm));
  app.post("/api/posts", rateLimit(RateLimitConfigs.postCreate));
  app.use("/ap/*/inbox", rateLimit(RateLimitConfigs.inbox));
  // `/ap/inbox` (shared inbox) is not matched by `/ap/*/inbox`; apply the same
  // per-IP inbox throttle since it is unauthenticated and federation peers can
  // hammer it.
  app.use("/ap/inbox", rateLimit(RateLimitConfigs.inbox));

  // Federation discovery endpoints are unauthenticated and can be probed by
  // any remote actor. Throttle them per-IP to mitigate enumeration / DoS.
  app.use(
    "/.well-known/webfinger",
    rateLimit(RateLimitConfigs.federationDiscovery),
  );
  app.use(
    "/.well-known/nodeinfo",
    rateLimit(RateLimitConfigs.federationDiscovery),
  );
  app.use("/nodeinfo/*", rateLimit(RateLimitConfigs.federationDiscovery));
  app.use("/ap/users/*", rateLimit(RateLimitConfigs.federationDiscovery));
  app.use("/ap/objects/*", rateLimit(RateLimitConfigs.federationDiscovery));
  app.use(
    "/ap/users/*/outbox",
    rateLimit(RateLimitConfigs.federationDiscovery),
  );
}

function mountCoreRoutes(app: YurucommuApp): void {
  app.route("/api/auth", authRoutes);
  app.route("/api/actors", actorsRoutes);
  app.route("/api/follow", followRoutes);
  app.route("/api/timeline", timelineRoutes);
  app.route("/api/posts", postsRoutes);

  app.get("/api/bookmarks", async (c) => {
    const url = new URL(c.req.url);
    url.pathname = "/api/posts/bookmarks";
    const newReq = new Request(url.toString(), c.req.raw);
    return app.fetch(newReq, c.env, c.executionCtx);
  });

  app.route("/api/notifications", notificationsRoutes);
  app.route("/api/stories", storiesRoutes);
  app.route("/api/search", searchRoutes);
  app.route("/api/communities", communitiesRoutes);
  app.route("/api/dm", dmRoutes);
  app.route("/api/media", mediaRoutes);
  app.route("/media", mediaRoutes);
  app.route("/api/takos", takosProxyRoutes);
  app.route("/.takos/tools", takosToolsRoutes);
  app.route("/api/recommendations", recommendationsRoutes);
  app.route("/api/moderation", moderationRoutes);
  app.route("/api/apps", appsApiRoutes);
  app.route("/hosted", appsServeRoutes);
  app.route("/", activitypubRoutes);
}

function mountStaticFallback(app: YurucommuApp): void {
  app.all("*", async (c) => {
    // A request that reaches the static fallback under a backend route prefix
    // means no API / AP / media route matched it — return a genuine JSON 404
    // instead of the SPA HTML shell. Without this, the Cloudflare ASSETS binding
    // (single-page-application mode) served index.html with a 200 for unmatched
    // /api/* paths, so an API client (or our own fetch) got HTML 200 instead of
    // a 404 — the Bun runtime already guarded this; share one source of truth.
    if (isBackendPath(new URL(c.req.url).pathname)) {
      return c.json({ error: "Not Found", code: "NOT_FOUND" }, 404);
    }

    if (c.env.ASSETS) {
      return c.env.ASSETS.fetch(c.req.raw);
    }

    const storage = (c.env as { STORAGE?: R2Bucket }).STORAGE;
    if (storage) {
      const url = new URL(c.req.url);
      let assetPath = url.pathname;

      if (assetPath === "/" || assetPath === "") {
        assetPath = "/index.html";
      }

      const r2Key = `_assets${assetPath}`;

      try {
        const object = await storage.get(r2Key);
        if (object) {
          const headers = new Headers();
          headers.set("Content-Type", getMimeType(assetPath));
          headers.set(
            "Cache-Control",
            assetPath.includes("/assets/")
              ? "public, max-age=31536000, immutable"
              : "public, max-age=3600",
          );
          if (object.httpEtag) {
            headers.set("ETag", object.httpEtag);
          }
          return new Response(object.body as unknown as BodyInit, { headers });
        }

        if (!assetPath.includes(".")) {
          const indexObject = await storage.get("_assets/index.html");
          if (indexObject) {
            const headers = new Headers();
            headers.set("Content-Type", "text/html; charset=utf-8");
            headers.set("Cache-Control", "no-cache");
            return new Response(indexObject.body as unknown as BodyInit, {
              headers,
            });
          }
        }
      } catch (err) {
        log.error("Failed to serve asset from R2", {
          event: "assets.r2.serve_failed",
          error: err,
        });
      }
    }

    return c.json(
      {
        error: "Static assets not configured",
        message:
          "This instance is running in API-only mode. Frontend assets are not available.",
        hint: "Access /api/* endpoints for API functionality.",
      },
      503,
    );
  });
}

export function createYurucommuBackendApp(
  options: CreateYurucommuBackendAppOptionsV1 = {},
): YurucommuApp {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  const plugins = options.plugins ?? [];
  const pluginContext: BackendPluginContextV1 = { app };

  for (const plugin of plugins) {
    if (plugin.apiVersion !== YURUCOMMU_BACKEND_PLUGIN_API_VERSION) {
      throw new Error(
        `[yurucommu] backend plugin "${plugin.name}" uses unsupported apiVersion=${plugin.apiVersion}. ` +
          `Expected ${YURUCOMMU_BACKEND_PLUGIN_API_VERSION}.`,
      );
    }
  }

  mountReadinessRoutes(app);
  // Body-size cap must run BEFORE any handler reads the body or executes
  // expensive auth / rate-limit logic. Mounted after readiness probes so
  // /healthz and /readyz stay reachable even when payload validation
  // misbehaves.
  applyBodyLimits(app);
  applyGlobalMiddleware(app);
  for (const plugin of plugins) {
    plugin.setup?.(pluginContext);
  }
  for (const plugin of plugins) {
    plugin.beforeRoutes?.(pluginContext);
  }

  mountCoreRoutes(app);
  for (const plugin of plugins) {
    plugin.afterRoutes?.(pluginContext);
  }

  mountStaticFallback(app);
  return app;
}

const app = createYurucommuBackendApp();

export const backendApp = app;

export async function handleYurucommuQueueBatch(
  batch: MessageBatch<DeliveryQueueMessageV1 | DeliveryDlqMessageV1>,
  env: Env,
): Promise<void> {
  const deliveryQueueName = env.DELIVERY_QUEUE_NAME ?? "yurucommu-delivery";
  const deliveryDlqName = env.DELIVERY_DLQ_NAME ?? "yurucommu-delivery-dlq";

  if (batch.queue === deliveryQueueName) {
    return handleDeliveryQueueBatch(
      batch as MessageBatch<DeliveryQueueMessageV1>,
      env,
    );
  }
  if (batch.queue === deliveryDlqName) {
    return handleDeliveryDlqBatch(
      batch as MessageBatch<DeliveryDlqMessageV1>,
      env,
    );
  }

  log.warn("Unknown queue", {
    event: "queue.unknown",
    queue: batch.queue,
  });
  batch.ackAll();
}

type WorkerBindings = EnvVars & {
  DB: D1Database;
  MEDIA?: R2Bucket;
  KV: KVNamespace;
  ASSETS?: Fetcher;
  DELIVERY_QUEUE?: Queue<DeliveryQueueMessageV1>;
  DELIVERY_DLQ?: Queue<DeliveryDlqMessageV1>;
};

export default {
  async fetch(
    request: Request,
    bindings: WorkerBindings,
    ctx: ExecutionContext,
  ): Promise<Response> {
    return app.fetch(request, wrapCloudflareBindings(bindings), ctx);
  },

  async queue(
    batch: MessageBatch<DeliveryQueueMessageV1 | DeliveryDlqMessageV1>,
    bindings: WorkerBindings,
  ): Promise<void> {
    return handleYurucommuQueueBatch(batch, wrapCloudflareBindings(bindings));
  },
};
