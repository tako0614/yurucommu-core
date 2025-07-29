import { Hono } from "hono";
import { createDB } from "../DB/mod.ts";
import { getDomain } from "../utils/activitypub.ts";
import { getEnv } from "../../shared/config.ts";
// NodeInfo は外部から参照されるため認証は不要

const app = new Hono();
// app.use("*", authRequired); // 認証ミドルウェアは適用しない

async function getNodeStats(env: Record<string, string>) {
  const db = createDB(env);
  const users = await db.countAccounts();
  const posts = (await db.findObjects({}, {})).length;
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
  const env = getEnv(c);
  const { users, posts, version } = await getNodeStats(env);
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

app.get("/api/v1/instance", async (c) => {
  const env = getEnv(c);
  const domain = getDomain(c);
  const { users, posts, version } = await getNodeStats(env);
  return c.json({
    uri: domain,
    title: "Takos Instance",
    short_description: "分散SNSサーバー",
    description: "Takosで運用されている分散SNSサーバーです。",
    email: `info@${domain}`,
    version,
    urls: {},
    stats: { user_count: users, status_count: posts, domain_count: 1 },
    thumbnail: null,
    languages: ["ja"],
    registrations: false,
    approval_required: false,
    invites_enabled: false,
  });
});

app.get("/.well-known/x-nodeinfo2", (c) => {
  // Misskey 互換のルート。実体は /nodeinfo/2.0 へ統合したためリダイレクトのみ
  return c.redirect("/nodeinfo/2.0");
});

export default app;
