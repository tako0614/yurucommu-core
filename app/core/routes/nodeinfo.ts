import { type Context, Hono } from "hono";
import { getDB } from "../db/mod.ts";
import { getDomain } from "../utils/activitypub.ts";
import { getEnv } from "@takos/config";
// NodeInfo は外部から参照されるため認証は不要

const app = new Hono();
// app.use("*", authRequired); // 認証ミドルウェアは適用しない

async function getNodeStats(c: Context) {
  const env = getEnv(c);
  const db = getDB(c);
  const users = await db.accounts.count();
  let posts = 0;
  try {
    posts += (await db.posts.findNotes({}, {})).length;
  } catch { /* optional */ }
  try {
    posts += (await db.posts.findMessages({}, {})).length;
  } catch { /* optional */ }
  const version = env["TAKOS_VERSION"] ?? "1.0.0";
  return { users, posts, version };
}

app.get("/.well-known/nodeinfo", (c) => {
  const domain = getDomain(c);
  return c.json({
    links: [
      {
        rel: "http://nodeinfo.diaspora.software/ns/schema/2.0",
        href: `https://${domain}/nodeinfo/2.0`,
      },
    ],
  });
});

app.get("/nodeinfo/2.0", async (c) => {
  const { users, posts, version } = await getNodeStats(c);
  return c.json({
    version: "2.0",
    software: {
      name: "takos",
      version,
    },
    protocols: ["activitypub"],
    services: { inbound: [], outbound: [] },
    openRegistrations: false,
    usage: {
      users: { total: users, activeMonth: users, activeHalfyear: users },
      localPosts: posts,
    },
    metadata: {},
  });
});

export default app;
