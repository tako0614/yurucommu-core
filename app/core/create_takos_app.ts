import { Hono } from "hono";
import { initEnv } from "@takos/config";
import type { DB } from "@takos/db";
import login from "./routes/login.ts";
import logout from "./routes/logout.ts";
import onboarding from "./routes/onboarding.ts";
import session from "./routes/session.ts";
import accounts from "./routes/accounts.ts";
import notifications from "./routes/notifications.ts";
import activitypub from "./routes/activitypub.ts";
import posts from "./routes/posts.ts";
import search from "./routes/search.ts";
import users from "./routes/users.ts";
import follow from "./routes/follow.ts";
import rootInbox from "./routes/root_inbox.ts";
import nodeinfo from "./routes/nodeinfo.ts";
import fasp from "./routes/fasp.ts";
import files, { initFileModule } from "./routes/files.ts";
import wsRouter from "./routes/ws.ts";
import config from "./routes/config.ts";
import fcm from "./routes/fcm.ts";
import placeholder from "./routes/placeholder.ts";
import image from "./routes/image.ts";
import trends from "./routes/trends.ts";
import systemSetup from "./routes/system_setup.ts";
import dm from "./routes/dm.ts";
import groups from "./routes/groups.ts";
import { fetchOgpData } from "./services/ogp.ts";
import { serveStatic } from "hono/deno";
import type { Context } from "hono";
import { rateLimit } from "./utils/rate_limit.ts";
import { deleteCookie, getCookie } from "hono/cookie";
import { issueSession } from "./utils/session.ts";
import dms from "./routes/dms.ts";
// DB 依存を避けるため、createTakosApp 本体は DB 生成や操作を行わない

const isDev = Deno.env.get("DEV") === "1";

export async function createTakosApp(
  env: Record<string, string>,
  db: DB,
) {
  const app = new Hono();
  initEnv(app, env);
  app.use("/*", async (c: Context, next: () => Promise<void>) => {
    c.set("db", db);
    await next();
  });
  app.use("/api/*", async (c: Context, next: () => Promise<void>) => {
    if (c.req.path === "/api/ws") {
      await next();
      return;
    }
    const rl = rateLimit({ windowMs: 60_000, limit: 100 });
    await rl(c, next);
  });
  await initFileModule(env);
  // DB 初期化や鍵生成はホスト側（takos host）や起動スクリプトで実施する

  const apiRoutes = [
    wsRouter,
    login,
    logout,
    session,
    accounts,
    follow,
    notifications,
    posts,
    config,
    fcm,
    systemSetup,
    onboarding,
    placeholder,
    image,
    trends,
    files,
    search,
    users,
    dm,
    dms,
  ];
  for (const r of apiRoutes) {
    app.route("/api", r);
  }

  // ActivityPub や公開エンドポイントは / にマウントする

  const rootRoutes = [nodeinfo, activitypub, rootInbox, fasp, groups];
  for (const r of rootRoutes) {
    app.route("/", r);
  }

  // OAuth landing handler: intercept /?code=... and perform server-side exchange
  app.use("/*", async (c: Context, next: () => Promise<void>) => {
    try {
      if (c.req.method !== "GET") return await next();
      const code = c.req.query("code");
      const state = c.req.query("state") ?? "";
      if (!code) return await next();
      const env = (c as unknown as { get: (k: string) => unknown }).get(
        "env",
      ) as Record<string, string>;
      const host = env["OAUTH_HOST"];
      const clientId = env["OAUTH_CLIENT_ID"];
      const clientSecret = env["OAUTH_CLIENT_SECRET"];
      if (!host || !clientId || !clientSecret) return await next();
      const stateCookie = getCookie(c, "oauthState") ?? "";
      if (!state || !stateCookie || state !== stateCookie) return await next();
      // Clear state cookie
      deleteCookie(c, "oauthState", { path: "/" });
      const xfProto = c.req.header("x-forwarded-proto");
      const xfHost = c.req.header("x-forwarded-host");
      let origin: string;
      if (xfProto && xfHost) {
        origin = `${xfProto.split(",")[0].trim()}://${
          xfHost.split(",")[0].trim()
        }`;
      } else {
        const u = new URL(c.req.url);
        origin = `${u.protocol}//${u.host}`;
      }
      const redirectUri = origin;
      const base = host.startsWith("http") ? host : `https://${host}`;
      const form = new URLSearchParams();
      form.set("grant_type", "authorization_code");
      form.set("code", code);
      form.set("client_id", clientId);
      form.set("client_secret", clientSecret);
      form.set("redirect_uri", redirectUri);
      const tokenRes = await fetch(`${base}/oauth/token`, {
        method: "POST",
        body: form,
      });
      if (!tokenRes.ok) return await next();
      const tokenData = await tokenRes.json() as { access_token?: string };
      if (!tokenData.access_token) return await next();
      const verifyRes = await fetch(`${base}/oauth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenData.access_token }),
      });
      if (!verifyRes.ok) return await next();
      const v = await verifyRes.json();
      if (!v.active) return await next();
      await issueSession(c);
      return c.redirect("/");
    } catch (_e) {
      // ignore and pass through to static
      await next();
    }
  });

  app.get("/api/ogp", async (c) => {
    const url = c.req.query("url");
    if (!url) {
      return c.json({ error: "URL parameter is required" }, 400);
    }
    const ogpData = await fetchOgpData(url);
    if (ogpData) {
      return c.json(ogpData);
    } else {
      return c.json({ error: "Failed to fetch OGP data" }, 500);
    }
  });
  function proxy() {
    return async (c: Context, next: () => Promise<void>) => {
      if (c.req.method !== "GET" && c.req.method !== "HEAD") {
        await next();
        return;
      }
      const url = `http://localhost:1420${c.req.path}`;
      const res = await fetch(url);
      const body = await res.arrayBuffer();
      return new Response(body, { status: res.status, headers: res.headers });
    };
  }

  if (isDev) {
    app.use("/*", proxy());
  } else {
    app.use(
      "/*",
      serveStatic({
        root: "../client/dist",
        onNotFound: async (_path: string, c: Context) => {
          await serveStatic({ root: "../client/dist", path: "index.html" })(
            c,
            async () => {},
          );
        },
      }),
    );
  }

  return app;
}
