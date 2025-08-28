import { Hono } from "hono";
import { initEnv } from "@takos/config";
import type { DataStore } from "./db/types.ts";
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
import dm from "./routes/dm.ts";
import groups from "./routes/groups.ts";
import { fetchOgpData } from "./services/ogp.ts";
import { serveStatic } from "hono/deno";
import type { Context } from "hono";
import { rateLimit } from "./utils/rate_limit.ts";
import dms from "./routes/dms.ts";
import { handleOAuthCallback } from "./utils/oauth_callback.ts";
// DB 依存を避けるため、createTakosApp 本体は DB 生成や操作を行わない

const isDev = Deno.env.get("DEV") === "1";

export async function createTakosApp(
  env: Record<string, string>,
  db: DataStore,
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

  app.use("/*", handleOAuthCallback);

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
