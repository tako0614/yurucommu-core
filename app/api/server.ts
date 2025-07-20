import { Hono } from "hono";
import { connectDatabase } from "../../shared/db.ts";
import { initEnv, loadConfig } from "../../shared/config.ts";
import login from "./login.ts";
import logout from "./logout.ts";
import oauthLogin from "./oauth_login.ts";
import setupUI from "./setup_ui.ts";
import session from "./session.ts";
import accounts from "./accounts.ts";
import notifications from "./notifications.ts";
import activitypub from "./activitypub.ts";
import microblog from "./microblog.ts";
import search from "./search.ts";
import users from "./users.ts";
import userInfo from "./user-info.ts";
import rootInbox from "./root_inbox.ts";
import nodeinfo from "./nodeinfo.ts";
import e2ee from "./e2ee.ts";
import relays from "./relays.ts";
import videos, { initVideoModule, initVideoWebSocket } from "./videos.ts";
import wsRouter from "./ws.ts";
import config from "./config.ts";
import fcm from "./fcm.ts";
import adsense from "./adsense.ts";
import { fetchOgpData } from "./services/ogp.ts";
import { serveStatic } from "hono/deno";
import type { Context } from "hono";
import { rateLimit } from "./utils/rate_limit.ts";

export async function createTakosApp(env?: Record<string, string>) {
  const e = env ?? await loadConfig();

  const app = new Hono();
  initEnv(app, e);
  app.use("/api/*", async (c, next) => {
    if (c.req.path === "/api/ws") {
      await next();
      return;
    }
    const rl = rateLimit({ windowMs: 60_000, limit: 100 });
    await rl(c, next);
  });
  await initVideoModule(e);
  initVideoWebSocket();

  const apiRoutes = [
    wsRouter,
    login,
    logout,
    session,
    accounts,
    notifications,
    microblog,
    config,
    fcm,
    adsense,
    setupUI,
    videos,
    search,
    relays,
    users,
    userInfo,
    e2ee,
    activitypub, // ActivityPubプロキシAPI用
  ];
  if (e["OAUTH_HOST"] || e["ROOT_DOMAIN"]) {
    apiRoutes.splice(3, 0, oauthLogin);
  }
  for (const r of apiRoutes) {
    app.route("/api", r);
  }

  const rootRoutes = [nodeinfo, activitypub, rootInbox, e2ee];
  // e2ee アプリは最後に配置し、ActivityPub ルートへ認証不要でアクセスできるようにする
  for (const r of rootRoutes) {
    app.route("/", r);
  }

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
  const isDev = Deno.env.get("DEV") === "1";

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
        onNotFound: async (_path, c) => {
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

if (import.meta.main) {
  const env = await loadConfig();
  await connectDatabase(env);
  const app = await createTakosApp(env);
  Deno.serve(app.fetch);
}
