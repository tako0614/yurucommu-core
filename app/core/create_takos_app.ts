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
// import fasp from "./routes/fasp.ts"; // FASP機能凍結
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
import type { Context } from "hono";
import { rateLimit } from "./utils/rate_limit.ts";
import dms from "./routes/dms.ts";
import { handleOAuthCallback } from "./utils/oauth_callback.ts";
// DB 依存を避けるため、createTakosApp 本体で DB 生成等の作業を行わない

// Deno 環境が無い場合でも評価可能にする
// deno-lint-ignore no-explicit-any
const isDev = (typeof (globalThis as any).Deno !== "undefined") && ((globalThis as any).Deno.env.get("DEV") === "1");

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
    groups,
  ];
  for (const r of apiRoutes) {
    app.route("/api", r);
  }

  // 未定義の API エンドポイントは SPA へフォールバックせず 404 を返す
  app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

  // ActivityPub など公開エンドポイントを / にマウントする

  // const rootRoutes = [nodeinfo, activitypub, rootInbox, fasp];
  const rootRoutes = [nodeinfo, activitypub, rootInbox];
  for (const r of rootRoutes) {
    app.route("/", r);
  }

  app.use("/*", handleOAuthCallback);

  // 明示的なコールバックパスを /api 側に用意（実処理はミドルウェアで発火）
  app.get("/api/login/oauth/callback", (_c) => new Response(null, { status: 204 }));

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
    // 開発時はクライアントへプロキシするが、/api/* は除外
    app.all("*", async (c, next) => {
      if (c.req.path === "/api" || c.req.path.startsWith("/api/")) {
        // ここに到達するのは既存の /api ルートで未処理の場合のみ
        return c.json({ error: "Not Found" }, 404);
      }
      const p = proxy();
      return await p(c, next);
    });
  } else {
    // 静的配信は上位レイヤ（ホストアプリや Workers [assets]）で処理
  app.all("*", (_c) => new Response("Not Found", { status: 404 }));
  }
  return app;
}
