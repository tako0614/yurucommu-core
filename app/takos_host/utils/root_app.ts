import { Hono } from "hono";
import type { Context } from "hono";
import { serveStatic } from "hono/deno";
import { getAppForHost, getRealHost, isRootHost } from "./host_context.ts";
import type { HostContext } from "./host_context.ts";

/** Frontend dev proxy (GET/HEAD only). */
const devProxy =
  (prefix: string) => async (c: Context, next: () => Promise<void>) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") return await next();
    const path = c.req.path.replace(new RegExp(`^${prefix}`), "");
    const url = `http://localhost:1421${path}`;
    const res = await fetch(url);
    return new Response(await res.arrayBuffer(), {
      status: res.status,
      headers: res.headers,
    });
  };

/** Build the root (host) app with all routing logic encapsulated. */
export function buildRootApp(ctx: HostContext) {
  const {
    authApp,
    oauthApp,
    consumerApp,
    rootDomain,
    termsText,
    notFoundHtml,
    isDev,
    rootActivityPubApp,
    serviceActorApp,
  } = ctx;
  const app = new Hono();

  // ホスト用フロントエンド: 本番時は dist 直配信 + SPA フォールバック
  const hostStaticRoot = serveStatic({ root: "./client/dist" });
  const hostSpaEntry = serveStatic({ root: "./client/dist", path: "index.html" });

  // Portal (root) host detection:
  // - Prod: host equals configured rootDomain
  // - Dev (DEV=1) and rootDomain not set: treat localhost/127.0.0.1 as portal
  const isPortalHost = (c: Context) => {
    const host = getRealHost(c);
    if (rootDomain) return isRootHost(host, rootDomain);
    return isDev && (host === "localhost" || host === "127.0.0.1");
  };

  // Middleware wrapper that only runs on the portal host
  const onlyRoot = (
    handler: (
      c: Context,
      next: () => Promise<void>,
    ) => Promise<Response> | Response,
  ) =>
  async (c: Context, next: () => Promise<void>) => {
    if (!isPortalHost(c)) return await next();
    return await handler(c, next);
  };

  // Basic mount
  app.route("/auth", authApp);
  app.route("/oauth", oauthApp);

  // ---- /user UI root (SPA entry) ----
  const userUiHandler = (() => {
    if (isDev) {
      const proxy = devProxy("/user");
      return onlyRoot(async (c: Context, next: () => Promise<void>) => {
        if (c.req.path === "/user" || c.req.path === "/user/") {
          return await proxy(c, next);
        }
        await next();
      });
    }
    const stat = serveStatic({
      root: "./client/dist",
      rewriteRequestPath: (p) => p.replace(/^\/user/, ""),
    });
    return onlyRoot(async (c: Context, next: () => Promise<void>) => {
      if (c.req.path === "/user" || c.req.path === "/user/") {
        return await stat(c, next);
      }
      await next();
    });
  })();
  app.use("/user", userUiHandler);
  app.use("/user/", userUiHandler);
  // ---- /user/* Consumer API (root only) ----
  app.use(
    "/user/*",
    onlyRoot(async (c, _next) => {
      const orig = c.req.raw;
      const url = new URL(orig.url);
      url.pathname = url.pathname.replace(/^\/user/, "") || "/"; // strip /user prefix
      const newReq = new Request(url, orig);
      return await consumerApp.fetch(newReq);
    }),
  );

  if (termsText) {
    app.get(
      "/terms",
      onlyRoot((_c) =>
        new Response(termsText, {
          headers: { "content-type": "text/markdown; charset=utf-8" },
        })
      ),
    );
  }

  // Dev vs Prod: handle /auth static/proxy, but bypass OAuth endpoints
  // - Ensure dynamic handlers like /auth/google/start and /auth/*/callback reach authApp
  if (isDev) {
    const proxy = devProxy("/auth");
    app.use(
      "/auth/*",
      onlyRoot(async (c, next) => {
        const p = c.req.path;
        const isOauthEdge = /\/(start|callback)\/?$/.test(p);
        if (isOauthEdge) {
          return await authApp.fetch(c.req.raw);
        }
        return await proxy(c, next);
      }),
    );
  } else {
    const stat = serveStatic({
      root: "./client/dist",
      rewriteRequestPath: (p) => p.replace(/^\/auth/, ""),
    });
    app.use(
      "/auth/*",
      onlyRoot(async (c, next) => {
        const p = c.req.path;
        const isOauthEdge = /\/(start|callback)\/?$/.test(p);
        if (isOauthEdge) {
          return await authApp.fetch(c.req.raw);
        }
        return await stat(c, next);
      }),
    );
  }

  // Catch-all dynamic tenant dispatch
  app.all("/*", async (c) => {
    const host = getRealHost(c);
    const isRoot = isPortalHost(c);
    if (isRoot) {
      if (
        serviceActorApp && /^(\/actor|\/inbox|\/outbox)(\/|$)?/.test(c.req.path)
      ) {
        const resSvc = await serviceActorApp.fetch(c.req.raw);
        if (resSvc.status !== 404) return resSvc;
      }
      if (rootActivityPubApp) {
        const res = await rootActivityPubApp.fetch(c.req.raw);
        if (res.status !== 404) return res;
      }
    }
    const tenantApp = await getAppForHost(host, ctx);
    if (tenantApp) return tenantApp.fetch(c.req.raw);
    // Fallback:
    // - ルートドメインではホスト UI を返す（dev は Vite にプロキシ）
    // - それ以外のホストは 404 を返却（ホスト UI を誤配信しない）
    if (isRoot) {
      if (isDev) {
        const proxy = devProxy("");
        return await proxy(c, async () => {});
      }
      // 本番: まず静的ファイルを探し、なければ SPA エントリ(index.html)を返却
      const res = await hostStaticRoot(c, async () => undefined);
      return res ?? await hostSpaEntry(c, async () => {});
    }
    return new Response(notFoundHtml || "Not Found", {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  });

  return app;
}
