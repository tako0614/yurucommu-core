import { Hono } from "hono";
import Account from "./models/account.ts";
import ActivityPubObject from "./models/activitypub_object.ts";
import { getDomain } from "./utils/activitypub.ts";
import { env } from "./utils/env.ts";
// NodeInfo は外部からの参照を想定しているため認証は不要

const app = new Hono();
// app.use("*", authRequired); // 認証ミドルウェアは適用しない

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
  const version = env["TAKOS_VERSION"] ?? "1.0.0";
  const users = await Account.countDocuments();
  const posts = await ActivityPubObject.countDocuments();

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
  const domain = getDomain(c);
  const version = env["TAKOS_VERSION"] ?? "1.0.0";
  const userCount = await Account.countDocuments();
  const statusCount = await ActivityPubObject.countDocuments();

  return c.json({
    uri: domain,
    title: "Takos Instance",
    short_description: "分散SNSサーバー",
    description: "Takosで運用されている分散SNSサーバーです。",
    email: `info@${domain}`,
    version,
    urls: {},
    stats: {
      user_count: userCount,
      status_count: statusCount,
      domain_count: 1,
    },
    thumbnail: null,
    languages: ["ja"],
    registrations: false,
    approval_required: false,
    invites_enabled: false,
  });
});

app.get("/.well-known/x-nodeinfo2", async (c) => {
  const version = env["TAKOS_VERSION"] ?? "1.0.0";
  const users = await Account.countDocuments();
  const posts = await ActivityPubObject.countDocuments();

  return c.json({
    software: "takos",
    version,
    protocols: ["activitypub"],
    openRegistrations: false,
    usage: {
      users: { total: users },
      localPosts: posts,
    },
  });
});

export default app;
