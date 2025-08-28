import { Hono } from "hono";
import type { Context } from "hono";
import { serveStatic } from "hono/deno";
import FaspServerProviderInfo from "../models/fasp_server_provider_info.ts";
import { FASP_PROVIDER_INFO_PATHS } from "./host_context.ts";
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

function serviceActorAndActivityPubMiddleware(ctx: HostContext) {
  const { rootDomain, rootActivityPubApp, serviceActorApp } = ctx;
  if (!(rootDomain && (rootActivityPubApp || serviceActorApp))) return null;
  return async (c: Context, next: () => Promise<void>) => {
    const host = getRealHost(c);
    if (!isRootHost(host, rootDomain)) return await next();
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
    await next();
  };
}

async function ensureProviderInfo(ctx: HostContext, c: Context) {
  const { rootDomain, hostEnv } = ctx;
  const host = getRealHost(c);
  if (rootDomain && host !== rootDomain) return c.text("not found", 404);
  let info = await FaspServerProviderInfo.findOne({ _id: "provider" }).lean();
  if (!info || Array.isArray(info)) {
    const name = hostEnv["SERVER_NAME"] || rootDomain || "takos";
    const initial = new FaspServerProviderInfo({
      _id: "provider",
      name,
      capabilities: [{ id: "data_sharing", version: "v0" }],
    });
    await initial.save().catch(() => {});
    info = await FaspServerProviderInfo.findOne({ _id: "provider" }).lean();
  }
  const doc = (!info || Array.isArray(info))
    ? null
    : info as { name?: string; capabilities?: unknown[] };
  if (!doc) {
    return c.json({
      name: hostEnv["SERVER_NAME"] || rootDomain || "takos",
      capabilities: [],
    });
  }
  return c.json({
    name: doc.name ?? (hostEnv["SERVER_NAME"] || rootDomain || "takos"),
    capabilities: Array.isArray(doc.capabilities) ? doc.capabilities : [],
  });
}

/** Build the root (host) app with all routing logic encapsulated. */
export function buildRootApp(ctx: HostContext) {
  const {
    authApp,
    oauthApp,
    consumerApp,
    rootDomain,
    faspServerDisabled,
    termsText,
    notFoundHtml,
    isDev,
    rootActivityPubApp,
    serviceActorApp,
  } = ctx;
  const app = new Hono();

  // Basic mount
  app.route("/auth", authApp);
  app.route("/oauth", oauthApp);

  // ---- /user UI root (SPA entry) ----
  const userUiHandler = (() => {
    if (isDev) {
      const proxy = devProxy("/user");
      return async (c: Context, next: () => Promise<void>) => {
        if (c.req.path === "/user" || c.req.path === "/user/") {
          return await proxy(c, next);
        }
        await next();
      };
    }
    const stat = serveStatic({
      root: "./client/dist",
      rewriteRequestPath: (p) => p.replace(/^\/user/, ""),
    });
    return async (c: Context, next: () => Promise<void>) => {
      if (c.req.path === "/user" || c.req.path === "/user/") {
        return await stat(c, next);
      }
      await next();
    };
  })();
  app.use("/user", userUiHandler);
  app.use("/user/", userUiHandler);

  // ---- /user/* Consumer API ----
  if (rootDomain) {
    app.use("/user/*", async (c, _next) => {
      const orig = c.req.raw;
      const url = new URL(orig.url);
      url.pathname = url.pathname.replace(/^\/user/, "") || "/"; // strip /user prefix
      const newReq = new Request(url, orig);
      return await consumerApp.fetch(newReq);
    });
  } else {
    // rootDomain 無し構成では API も UI も /user を共有する (従来動作踏襲)
    app.use("/user/*", async (c, _next) => {
      const orig = c.req.raw;
      const url = new URL(orig.url);
      url.pathname = url.pathname.replace(/^\/user/, "") || "/";
      const newReq = new Request(url, orig);
      return await consumerApp.fetch(newReq);
    });
  }

  // FASP provider_info endpoints
  if (!faspServerDisabled) {
    for (const path of FASP_PROVIDER_INFO_PATHS) {
      app.get(path, (c) => ensureProviderInfo(ctx, c));
    }
  }

  if (termsText) {
    app.get(
      "/terms",
      () =>
        new Response(termsText, {
          headers: { "content-type": "text/markdown; charset=utf-8" },
        }),
    );
  }

  // Dev vs Prod: only handle /auth static/proxy & root domain static fallback + ActivityPub
  if (isDev) {
    app.use("/auth/*", devProxy("/auth"));
    // ルートドメインが設定されている場合は、ルートをフロントの dev サーバーへプロキシ
    if (rootDomain && (rootActivityPubApp || serviceActorApp)) {
      const proxyRoot = devProxy("");
      app.use(async (c, next) => {
        const host = getRealHost(c);
        if (isRootHost(host, rootDomain)) {
          if (
            serviceActorApp &&
            /^(\/actor|\/inbox|\/outbox)(\/|$)?/.test(c.req.path)
          ) {
            const resSvc = await serviceActorApp.fetch(c.req.raw);
            if (resSvc.status !== 404) return resSvc;
          }
          if (rootActivityPubApp) {
            const res = await rootActivityPubApp.fetch(c.req.raw);
            if (res.status !== 404) return res;
          }
          return await proxyRoot(c, next);
        }
        await next();
      });
    }
    // ルートドメイン未設定の場合でも、テナントに該当しないアクセスはホストUIへフォールバック
    if (!rootDomain) {
      const proxyRoot = devProxy("");
      app.use(async (c, next) => {
        const host = getRealHost(c);
        const tenantApp = await getAppForHost(host, ctx);
        if (!tenantApp) return await proxyRoot(c, next);
        await next();
      });
    }
  } else {
    const mid = serviceActorAndActivityPubMiddleware(ctx);
    if (mid) app.use(mid);
    app.use(
      "/auth/*",
      serveStatic({
        root: "./client/dist",
        rewriteRequestPath: (p) => p.replace(/^\/auth/, ""),
      }),
    );
    if (rootDomain) {
      app.use(async (c, next) => {
        const host = getRealHost(c);
        if (host === rootDomain) {
          await serveStatic({ root: "./client/dist" })(c, next);
        } else await next();
      });
    }
    // ルートドメイン未設定時: テナントに該当しない場合はビルド済みホストUI(index.html)を返す
    if (!rootDomain) {
      app.use(async (c, next) => {
        const host = getRealHost(c);
        const tenantApp = await getAppForHost(host, ctx);
        if (!tenantApp) {
          return await serveStatic({
            root: "./client/dist",
            rewriteRequestPath: () => "/index.html",
          })(c, next);
        }
        await next();
      });
    }
  }

  // Catch-all dynamic tenant dispatch
  app.all("/*", async (c) => {
    const host = getRealHost(c);
    if (rootDomain && host === rootDomain && rootActivityPubApp) {
      return rootActivityPubApp.fetch(c.req.raw);
    }
    const tenantApp = await getAppForHost(host, ctx);
    if (!tenantApp) {
      // 開発時は最終フォールバックで dev サーバーへ（上の use でも対応しているが念のため）
      if (isDev) {
        const proxy = devProxy("");
        return await proxy(c, async () => {});
      }
      // 本番時かつ ルートドメイン未設定なら index.html を返す（上の use と二重になっても問題なし）
      if (!rootDomain) {
        return await serveStatic({
          root: "./client/dist",
          rewriteRequestPath: () => "/index.html",
        })(c, async () => {});
      }
      if (!isDev && notFoundHtml) {
        return new Response(notFoundHtml, {
          status: 404,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      return c.text("not found", 404);
    }
    return tenantApp.fetch(c.req.raw);
  });

  return app;
}
