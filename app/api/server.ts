import { load } from "jsr:@std/dotenv";
import { Hono } from "hono";
import { connectDatabase } from "./db.ts";
import { initEnv } from "./utils/env_store.ts";
import login from "./login.ts";
import logout from "./logout.ts";
import oauthLogin from "./oauth_login.ts";
import session from "./session.ts";
import accounts from "./accounts.ts";
import notifications from "./notifications.ts";
import activitypub from "./activitypub.ts";
import microblog from "./microblog.ts";
import search from "./search.ts";
import communities from "./communities.ts";
import users from "./users.ts";
import userInfo from "./user-info.ts";
import group from "./group.ts";
import rootInbox from "./root_inbox.ts";
import nodeinfo from "./nodeinfo.ts";
import e2ee from "./e2ee.ts";
import relays from "./relays.ts";
import videos from "./videos.ts";
import { fetchOgpData } from "./services/ogp.ts";

export async function createTakosApp(env?: Record<string, string>) {
  const e = env ?? await load();

  const app = new Hono();
  initEnv(app, e);
  app.route("/api", login);
  app.route("/api", logout);
  if (e["OAUTH_HOST"]) {
    app.route("/api", oauthLogin);
  }
  app.route("/api", session);
  app.route("/api", accounts);
  app.route("/api", notifications);
  app.route("/api", microblog);
  app.route("/api", videos);
  app.route("/api", search);
  app.route("/api", communities);
  app.route("/api", relays);
  app.route("/api", users);
  app.route("/api", userInfo);
  app.route("/api", e2ee);
  app.route("/api", activitypub); // ActivityPubプロキシAPI用
  app.route("/api", group);
  app.route("/", nodeinfo);
  app.route("/", activitypub);
  app.route("/", group);
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

  return app;
}

if (import.meta.main) {
  const env = await load();
  await connectDatabase(env);
  const app = await createTakosApp(env);
  Deno.serve(app.fetch);
}
