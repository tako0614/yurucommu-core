import { Hono } from "hono";
import { connectDatabase } from "../shared/db.ts";
import { initEnv, loadConfig } from "../shared/config.ts";
import login from "./routes/login.ts";
import logout from "./routes/logout.ts";
import oauthLogin from "./routes/oauth_login.ts";
import setupUI from "./routes/setup_ui.ts";
import session from "./routes/session.ts";
import accounts from "./routes/accounts.ts";
import notifications from "./routes/notifications.ts";
import activitypub from "./routes/activitypub.ts";
import posts from "./routes/posts.ts";
import search from "./routes/search.ts";
import users from "./routes/users.ts";
import follow from "./routes/follow.ts";
import dms from "./routes/dms.ts";
import rootInbox from "./routes/root_inbox.ts";
import nodeinfo from "./routes/nodeinfo.ts";
import e2ee from "./routes/e2ee.ts";
import relays from "./routes/relays.ts";
import videos, {
  initVideoModule,
  initVideoWebSocket,
} from "./routes/videos.ts";
import {
  initAttachmentWebSocket,
  initAttachmentWsModule,
} from "./routes/attachments_ws.ts";
import messageAttachments from "./routes/message_attachments.ts";
import files, { initFileModule } from "./routes/files.ts";
import wsRouter from "./routes/ws.ts";
import config from "./routes/config.ts";
import fcm from "./routes/fcm.ts";
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
  await initFileModule(e);
  await initVideoModule(e);
  await initAttachmentWsModule(e);
  initVideoWebSocket();
  initAttachmentWebSocket();

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
    setupUI,
    videos,
    dms,
    messageAttachments,
    files,
    search,
    relays,
    users,
    e2ee,
  ];
  if (e["OAUTH_HOST"] || e["ROOT_DOMAIN"]) {
    apiRoutes.splice(3, 0, oauthLogin);
  }
  for (const r of apiRoutes) {
    app.route("/api", r);
  }

  // ActivityPub ルートは / のみにマウントする

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
