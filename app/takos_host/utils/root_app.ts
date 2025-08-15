import { Hono } from "hono";
import type { Context } from "hono";
import { serveStatic } from "hono/deno";
import FaspServerProviderInfo from "../models/fasp_server_provider_info.ts";
import { FASP_PROVIDER_INFO_PATHS, } from "./host_context.ts";
import { getAppForHost, getRealHost, isRootHost } from "./host_context.ts";
import type { HostContext } from "./host_context.ts";

/** Frontend dev proxy (GET/HEAD only). */
const devProxy = (prefix: string) => async (c: Context, next: () => Promise<void>) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") return await next();
  const path = c.req.path.replace(new RegExp(`^${prefix}`), "");
  const url = `http://localhost:1421${path}`;
  const res = await fetch(url);
  return new Response(await res.arrayBuffer(), { status: res.status, headers: res.headers });
};

function serviceActorAndActivityPubMiddleware(ctx: HostContext) {
  const { rootDomain, rootActivityPubApp, serviceActorApp } = ctx;
  if (!(rootDomain && (rootActivityPubApp || serviceActorApp))) return null;
  return async (c: Context, next: () => Promise<void>) => {
    const host = getRealHost(c);
    if (!isRootHost(host, rootDomain)) return await next();
    if (serviceActorApp && /^(\/actor|\/inbox|\/outbox)(\/|$)?/.test(c.req.path)) {
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
  const doc = (!info || Array.isArray(info)) ? null : info as { name?: string; capabilities?: unknown[] };
  if (!doc) {
    return c.json({ name: hostEnv["SERVER_NAME"] || rootDomain || "takos", capabilities: [] });
  }
  return c.json({ name: doc.name ?? (hostEnv["SERVER_NAME"] || rootDomain || "takos"), capabilities: Array.isArray(doc.capabilities) ? doc.capabilities : [] });
}

/** Build the root (host) app with all routing logic encapsulated. */
export function buildRootApp(ctx: HostContext) {
  const { authApp, oauthApp, consumerApp, rootDomain, faspServerDisabled, termsText, notFoundHtml, isDev, rootActivityPubApp, serviceActorApp } = ctx;
  const app = new Hono();

  // Basic mount
  app.route("/auth", authApp);
  app.route("/oauth", oauthApp);

  // Always serve Host UI at /user and /user/ (any host) before consumer API middleware.
  // This ensures authenticated API 404s don't mask the SPA entrypoint and removes rootDomain restriction.
  if (isDev) {
    const proxyUser = devProxy("/user");
    const uiDevHandler = async (c: Context, next: () => Promise<void>) => {
      const p = c.req.path;
      if (p === "/user" || p === "/user/") {
        return await proxyUser(c, next);
      }
      await next();
    };
    app.use("/user", uiDevHandler);
    app.use("/user/", uiDevHandler);
  } else {
    const userStatic = serveStatic({ root: "./client/dist", rewriteRequestPath: (p) => p.replace(/^\/user/, "") });
    const uiProdHandler = async (c: Context, next: () => Promise<void>) => {
      const p = c.req.path;
      if (p === "/user" || p === "/user/") {
        return await userStatic(c, next);
      }
      await next();
    };
    app.use("/user", uiProdHandler);
    app.use("/user/", uiProdHandler);
  }

  // Consumer API: keep it on /user/* only so that /user (and /user/) root can fall through to UI (static/proxy)
  if (rootDomain) {
    app.use("/user/*", async (c, _next) => {
      // /user プレフィックスを剥がして consumerApp ( /instances など ) に正しくマッチさせる
      const orig = c.req.raw;
      const url = new URL(orig.url);
      url.pathname = url.pathname.replace(/^\/user/, "") || "/"; // /user/instances -> /instances, /user/ -> /
      const newReq = new Request(url, orig);
      return await consumerApp.fetch(newReq);
    });
  } else {
    app.route("/user", consumerApp); // no rootDomain => expose whole /user (API + UI 可)
  }

  // FASP provider_info endpoints
  if (!faspServerDisabled) {
    for (const path of FASP_PROVIDER_INFO_PATHS) {
      app.get(path, (c) => ensureProviderInfo(ctx, c));
    }
  }

  if (termsText) {
    app.get("/terms", () => new Response(termsText, { headers: { "content-type": "text/markdown; charset=utf-8" } }));
  }

  // Dev vs Prod static / proxy handling
  if (isDev) {
    app.use("/auth/*", devProxy("/auth"));
    // Host UI for /user and /user/* - same logic as root path
    if (rootDomain) {
      const userProxy = devProxy("/user");
      app.use("/user", async (c, next) => {
        const host = getRealHost(c);
        if (isRootHost(host, rootDomain)) {
          return await userProxy(c, next);
        }
        await next();
      });
      app.use("/user/*", async (c, next) => {
        const host = getRealHost(c);
        if (isRootHost(host, rootDomain)) {
          return await userProxy(c, next);
        }
        await next();
      });
    } else {
      app.use("/user", devProxy("/user"));
      app.use("/user/*", devProxy("/user"));
    }
    if (rootDomain && (rootActivityPubApp || serviceActorApp)) {
      const proxyRoot = devProxy("");
      app.use(async (c, next) => {
        const host = getRealHost(c);
        if (isRootHost(host, rootDomain)) {
          if (serviceActorApp && /^(\/actor|\/inbox|\/outbox)(\/|$)?/.test(c.req.path)) {
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
  } else {
    const mid = serviceActorAndActivityPubMiddleware(ctx);
    if (mid) app.use(mid);
    app.use("/auth/*", serveStatic({ root: "./client/dist", rewriteRequestPath: (p) => p.replace(/^\/auth/, "") }));
    // Host UI for /user and /user/* - same logic as root path
    if (rootDomain) {
      const userStatic = serveStatic({ root: "./client/dist", rewriteRequestPath: (p) => p.replace(/^\/user/, "") });
      app.use("/user", async (c, next) => {
        const host = getRealHost(c);
        if (host === rootDomain) {
          return await userStatic(c, next);
        }
        await next();
      });
      app.use("/user/*", async (c, next) => {
        const host = getRealHost(c);
        if (host === rootDomain) {
          return await userStatic(c, next);
        }
        await next();
      });
    } else {
      app.use("/user", serveStatic({ root: "./client/dist", rewriteRequestPath: (p) => p.replace(/^\/user/, "") }));
      app.use("/user/*", serveStatic({ root: "./client/dist", rewriteRequestPath: (p) => p.replace(/^\/user/, "") }));
    }
    if (rootDomain) {
      app.use(async (c, next) => {
        const host = getRealHost(c);
        if (host === rootDomain) {
          await serveStatic({ root: "./client/dist" })(c, next);
        } else await next();
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
      if (!isDev && notFoundHtml) {
        return new Response(notFoundHtml, { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
      }
      return c.text("not found", 404);
    }
    return tenantApp.fetch(c.req.raw);
  });

  return app;
}
