import { Hono } from "hono";
import { connectDatabase } from "../../shared/db.ts";
import { initEnv, loadConfig } from "../../shared/config.ts";
import { startRelayPolling } from "./services/relay_poller.ts";
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
  initVideoModule(e);
  initVideoWebSocket();
  app.route("/api", wsRouter);
  app.route("/api", login);
  app.route("/api", logout);
  if (e["OAUTH_HOST"] || e["ROOT_DOMAIN"]) {
    app.route("/api", oauthLogin);
  }
  app.route("/api", session);
  app.route("/api", accounts);
  app.route("/api", notifications);
  app.route("/api", microblog);
  app.route("/api", config);
  app.route("/api", fcm);
  app.route("/api", setupUI);
  app.route("/api", videos);
  app.route("/api", search);
  app.route("/api", relays);
  app.route("/api", users);
  app.route("/api", userInfo);
  app.route("/api", e2ee);
  app.route("/api", activitypub); // ActivityPubプロキシAPI用
  app.route("/", nodeinfo);
  app.route("/", activitypub);
  app.route("/", rootInbox);
  // e2ee アプリは最後に配置し、ActivityPub ルートへ認証不要でアクセスできるようにする
  app.route("/", e2ee);

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

  startRelayPolling(e);

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
