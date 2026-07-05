import { Hono, type Context } from "hono";
import { MOBILE_PUSH_REGISTRATION_PATH } from "./lib/mobile-contract.ts";
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
import takosToolsRoutes from "./routes/takos-tools.ts";
import recommendationsRoutes from "./routes/recommendations.ts";
import { moderationRoutes } from "./routes/moderation.ts";
import { appsApiRoutes, appsServeRoutes } from "./routes/apps.ts";
import mobileRoutes from "./routes/mobile.ts";

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
  // The client SECRET is optional — Takosumi materializes a PUBLIC (PKCE-only,
  // no-secret) OIDC client for auto-provisioned Capsules. issuer + client_id is
  // a usable auth method (mirrors getAuthConfig's provider gate).
  const hasAccountsOidc =
    hasValue(getOidcIssuerUrl(env) ?? undefined) &&
    hasValue(oidcCredentials.clientId);
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
  // The client SECRET is optional — Takosumi materializes a PUBLIC (PKCE-only,
  // no-secret) OIDC client for auto-provisioned Capsules. issuer + client_id is
  // a usable auth method (mirrors getAuthConfig's provider gate).
  const hasAccountsOidc =
    hasValue(getOidcIssuerUrl(env) ?? undefined) &&
    hasValue(oidcCredentials.clientId);
  if (!hasPassword && !hasGoogle && !hasX && !hasAccountsOidc) {
    missing.push("AUTH_METHOD");
  }
  return missing;
}

function buildSocialServerDiscovery(appUrl: string, issuer: string) {
  return {
    product: "yurucommu",
    name: "Yurucommu",
    server: {
      id: "yurucommu-server",
      name: "Yurucommu Server",
      canonicalOrigin: appUrl,
      activitypubOrigin: appUrl,
    },
    clients: [
      {
        id: "yurucommu",
        name: "Yurucommu",
        defaultEntry: "feed",
      },
      {
        id: "yurume",
        name: "Yurumeet",
        defaultEntry: "messages",
      },
    ],
    issuer,
    apiBaseUrl: appUrl,
    activitypubOrigin: appUrl,
    mediaOrigin: `${appUrl}/media`,
    socialServerCapabilitiesUrl: `${appUrl}/.well-known/social-server`,
    capabilities: [
      "api.social.v1",
      "activitypub.server.v1",
      "client.yurucommu.feed.v1",
      "client.yurume.messages.v1",
    ],
    endpoints: {
      api: `${appUrl}/api`,
      authProviders: `${appUrl}/api/auth/providers`,
      currentUser: `${appUrl}/api/auth/me`,
      timeline: `${appUrl}/api/timeline`,
      conversations: `${appUrl}/api/dm/contacts`,
      notifications: `${appUrl}/api/notifications`,
      mobilePushRegistrations: `${appUrl}${MOBILE_PUSH_REGISTRATION_PATH}`,
    },
  };
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

  const wellKnownSocialServer = (
    c: Context<{ Bindings: Env; Variables: Variables }>,
  ) => {
    const appUrl = normalizeOrigin(c.env.APP_URL, c.req.url);
    const issuer = getOidcIssuerUrl(c.env) ?? appUrl;
    return c.json(buildSocialServerDiscovery(appUrl, issuer), 200, {
      "Cache-Control": "public, max-age=300",
    });
  };

  app.get("/.well-known/yurucommu", wellKnownSocialServer);
  app.get("/.well-known/social-server", wellKnownSocialServer);

  // Minimal RFC 9116 security.txt. The contact points operators at the
  // instance admin; APP_URL (when configured) makes the policy line concrete.
  app.get("/.well-known/security.txt", (c) => {
    // RFC 9116: `Contact` and `Expires` are REQUIRED. The previous file used a
    // placeholder `mailto:security@yurucommu.invalid` (the .invalid TLD is
    // non-routable, so vulnerabilities could not actually be reported), pointed
    // `Policy` circularly at this very file, and omitted `Expires` entirely —
    // making the document non-compliant (scanners reject it). Default `Contact`
    // to the upstream project's working security-advisory channel, overridable
    // by an operator via the SECURITY_CONTACT env (their own mailto:/https
    // report path), and always emit a future `Expires`.
    const contact =
      (c.env as { SECURITY_CONTACT?: string }).SECURITY_CONTACT?.trim() ||
      "https://github.com/tako0614/yurucommu/security/advisories/new";
    // Kept ~1 year out (recomputed per request, cached 1h) — well within the
    // RFC's "less than a year" recommendation and never stale.
    const expires = new Date(
      Date.now() + 365 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const lines = [
      `Contact: ${contact}`,
      `Expires: ${expires}`,
      "Policy: https://github.com/tako0614/yurucommu/security/policy",
      "Preferred-Languages: en, ja",
      "",
    ];
    return c.body(lines.join("\n"), 200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    });
  });
}

function normalizeOrigin(
  appUrl: string | undefined,
  requestUrl: string,
): string {
  const raw = appUrl?.trim() || new URL(requestUrl).origin;
  const url = new URL(raw);
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/g, "");
}

// media.ts advertises MAX_VIDEO_SIZE = 40MB (and MAX_IMAGE_SIZE = 20MB) and
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

// Every ActivityPub inbox handler (inbox.ts): the shared inbox `/ap/inbox`, the
// per-actor singleton `/ap/actor/inbox`, and the two-segment per-recipient
// inboxes `/ap/users/:username/inbox` + `/ap/groups/:name/inbox`. Hono's single
// `*` matches EXACTLY ONE path segment, so `/ap/*/inbox` covers `/ap/actor/inbox`
// but NOT the two-segment user/group inboxes — those must be listed explicitly,
// or they silently fall through to the lax global default cap + miss the per-IP
// inbox rate limit. Every inbox is unauthenticated and verifies an HTTP
// signature + touches the DB *before* any throttle runs, so each one needs BOTH
// the strict pre-auth body cap AND the dedicated per-IP `inbox` rate limit; this
// single list is the source of truth for both (applyBodyLimits +
// applyGlobalMiddleware) so they can never drift out of coverage.
const INBOX_PATH_PATTERNS = [
  "/ap/inbox",
  "/ap/*/inbox",
  "/ap/users/*/inbox",
  "/ap/groups/*/inbox",
] as const;

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
  // MAX_VIDEO_SIZE = 40MB / MAX_IMAGE_SIZE = 20MB) unreachable. So the default
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
  // Apply the strict pre-auth body cap to EVERY inbox route (shared, per-actor,
  // and the two-segment user/group inboxes). See INBOX_PATH_PATTERNS: a single
  // `*` only matches one segment, so the user/group inboxes must be listed
  // explicitly or they fall through to the lax 1 MiB default cap (which also
  // omits requireContentLength).
  for (const pattern of INBOX_PATH_PATTERNS) {
    app.use(
      pattern,
      bodyLimit({
        maxBytes: INBOX_BODY_LIMIT_BYTES,
        requireContentLength: true,
      }),
    );
  }
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
    // unpkg.com is only used by the official client to fetch @ffmpeg/core
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
  // mediaRoutes is double-mounted at /api/media AND the bare /media, and it
  // registers POST /upload — so /media/upload is a session-cookie-authenticated
  // state-changing write (R2 + DB) that, without this, would bypass the CSRF
  // control its /api/media/upload alias enforces. csrfProtection only guards
  // POST/PUT/DELETE/PATCH, so the public GET /media/* serve path is unaffected.
  // (Inert today behind the SameSite=Strict session cookie, but this keeps the
  // two upload aliases under the same Origin/Referer check regardless of any
  // future cookie-policy change.)
  app.use("/media/*", csrfProtection());

  app.use("/api/*", rateLimit(RateLimitConfigs.general));
  app.use("/.takos/tools/*", rateLimit(RateLimitConfigs.general));
  app.use("/api/auth/*", rateLimit(RateLimitConfigs.auth));
  app.use("/api/search/*", rateLimit(RateLimitConfigs.search));
  // The remote resolver makes an attacker-controlled outbound fetch to an
  // arbitrary host; throttle it far tighter than the general search budget,
  // like the other federation-discovery endpoints.
  app.use(
    "/api/search/remote",
    rateLimit(RateLimitConfigs.federationDiscovery),
  );
  app.use("/api/media/*", rateLimit(RateLimitConfigs.mediaUpload));
  // The bare /media mount serves media and also exposes POST /media/upload;
  // throttle it with the same media budget as /api/media/* for consistency.
  app.use("/media/*", rateLimit(RateLimitConfigs.mediaUpload));
  app.use("/api/dm/*", rateLimit(RateLimitConfigs.dm));
  app.post("/api/posts", rateLimit(RateLimitConfigs.postCreate));
  // Like/repost are federated WRITES (they sign + deliver activities to remote
  // inboxes), so bound them at the write budget rather than the general read
  // budget to limit mass-interaction delivery storms.
  app.post("/api/posts/:id/like", rateLimit(RateLimitConfigs.postCreate));
  app.post("/api/posts/:id/repost", rateLimit(RateLimitConfigs.postCreate));
  // Community creation generates an RSA keypair + actor; bound it at the write
  // budget rather than the general read budget.
  app.post("/api/communities", rateLimit(RateLimitConfigs.postCreate));
  // Follow / unfollow / accept / reject are federated WRITES (they sign + deliver
  // Follow / Undo / Accept / Reject to remote inboxes), so bound them at the
  // write budget like like/repost — a follow-toggle loop otherwise drives ~1000
  // signed remote deliveries/min at the general read budget.
  app.post("/api/follow", rateLimit(RateLimitConfigs.postCreate));
  app.delete("/api/follow", rateLimit(RateLimitConfigs.postCreate));
  app.post("/api/follow/accept", rateLimit(RateLimitConfigs.postCreate));
  app.post("/api/follow/reject", rateLimit(RateLimitConfigs.postCreate));
  // Apply the dedicated per-IP `inbox` budget (1k/min) to EVERY inbox route.
  // The two-segment user/group inboxes are NOT matched by `/ap/*/inbox` and the
  // user inbox would otherwise be throttled only by the much tighter 60/min
  // `/ap/users/*` discovery limiter below (wrongly 429'ing legitimate inbound
  // federation), while the group inbox would get NO per-IP throttle at all (an
  // unauthenticated per-IP DoS forcing an unthrottled DB lookup + signature
  // verify per request). See INBOX_PATH_PATTERNS.
  for (const pattern of INBOX_PATH_PATTERNS) {
    app.use(pattern, rateLimit(RateLimitConfigs.inbox));
  }

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
  // `/ap/users/*` covers actor docs, outbox, followers, etc. — but NOT the user
  // inbox, which gets the dedicated 1k/min `inbox` budget above. Both limiters
  // use separate buckets (distinct keyPrefix), so without this skip an inbox
  // delivery would increment BOTH and stay capped at the stricter 60/min — the
  // exact over-throttling the dedicated inbox budget exists to avoid.
  const fedDiscoveryLimiter = rateLimit(RateLimitConfigs.federationDiscovery);
  app.use("/ap/users/*", async (c, next) => {
    if (c.req.path.endsWith("/inbox")) {
      return next();
    }
    return fedDiscoveryLimiter(c, next);
  });
  app.use("/ap/objects/*", rateLimit(RateLimitConfigs.federationDiscovery));
  app.use(
    "/ap/users/*/outbox",
    rateLimit(RateLimitConfigs.federationDiscovery),
  );
  // Parity for the structurally-identical Group + instance-actor collection
  // endpoints (/ap/groups/:name/{outbox,followers,moderators}, /ap/actor/{outbox,
  // followers}). Without this they were the only unauthenticated AP discovery
  // GETs with NO per-IP throttle, while /ap/users/*/outbox was capped at 60/min.
  // Skip the inbox sub-routes so the dedicated 1k/min inbox budget still governs
  // them (the same skip the /ap/users/* limiter uses), avoiding double-counting.
  app.use("/ap/groups/*", async (c, next) => {
    if (c.req.path.endsWith("/inbox")) return next();
    return fedDiscoveryLimiter(c, next);
  });
  app.use("/ap/actor/*", async (c, next) => {
    if (c.req.path.endsWith("/inbox")) return next();
    return fedDiscoveryLimiter(c, next);
  });
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
  app.route("/api/mobile", mobileRoutes);
  app.route("/api/stories", storiesRoutes);
  app.route("/api/search", searchRoutes);
  app.route("/api/communities", communitiesRoutes);
  app.route("/api/dm", dmRoutes);
  app.route("/api/media", mediaRoutes);
  app.route("/media", mediaRoutes);
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
