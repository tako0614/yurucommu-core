import { Hono } from "hono";
import Account from "./models/account.ts";
import ActivityPubObject from "./models/activitypub_object.ts";

import { activityHandlers } from "./activity_handlers.ts";

import {
  buildActivityFromStored,
  createActor,
  deliverActivityPubObject,
  getDomain,
  jsonResponse,
  verifyHttpSignature,
} from "./utils/activitypub.ts";
import { env } from "./utils/env.ts";

const app = new Hono();
import { logger } from "hono/logger";
app.use(logger());

app.get("/.well-known/webfinger", async (c) => {
  const resource = c.req.query("resource");
  if (!resource?.startsWith("acct:")) {
    return jsonResponse(c, { error: "Bad Request" }, 400);
  }
  const [username, host] = resource.slice(5).split("@");
  const expected = env["ACTIVITYPUB_DOMAIN"];
  if (expected && host !== expected) {
    return jsonResponse(c, { error: "Not found" }, 404);
  }
  const domain = expected ?? host;
  const account = await Account.findOne({ userName: username });
  if (!account) return jsonResponse(c, { error: "Not found" }, 404);
  const jrd = {
    subject: `acct:${username}@${domain}`,
    links: [
      {
        rel: "self",
        type: "application/activity+json",
        href: `https://${domain}/users/${username}`,
      },
    ],
  };
  return jsonResponse(c, jrd, 200, "application/jrd+json");
});

app.get("/users/:username", async (c) => {
  const username = c.req.param("username");
  const account = await Account.findOne({ userName: username }).lean();
  if (!account) return jsonResponse(c, { error: "Not found" }, 404);
  const domain = getDomain(c);

  const actor = createActor(domain, {
    userName: account.userName,
    displayName: account.displayName,
    publicKey: account.publicKey,
  });
  return jsonResponse(c, actor, 200, "application/activity+json");
});

app.get("/users/:username/avatar", async (c) => {
  const username = c.req.param("username");
  const account = await Account.findOne({ userName: username }).lean();
  if (!account) return c.body("Not Found", 404);

  let icon = account.avatarInitial ||
    username.charAt(0).toUpperCase().substring(0, 2);

  if (icon.startsWith("data:image/")) {
    const match = icon.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (match) {
      const [, type, data] = match;
      const binary = atob(data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return c.body(bytes, 200, { "content-type": type });
    }
  }

  icon = icon.slice(0, 2).toUpperCase();
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="100%" height="100%" fill="#6b7280"/><text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" font-size="60" fill="#fff" font-family="sans-serif">${icon}</text></svg>`;
  return c.body(svg, 200, { "content-type": "image/svg+xml" });
});

app.get("/users/:username/outbox", async (c) => {
  const username = c.req.param("username");
  const domain = getDomain(c);
  const type = c.req.query("type");
  // deno-lint-ignore no-explicit-any
  const query: any = { attributedTo: username };
  if (type) query.type = type;
  const objects = await ActivityPubObject.find(query).sort({
    published: -1,
  }).lean();
  const outbox = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `https://${domain}/users/${username}/outbox`,
    type: "OrderedCollection",
    totalItems: objects.length,
    // deno-lint-ignore no-explicit-any
    orderedItems: objects.map((n: any) =>
      buildActivityFromStored(
        { ...n, content: n.content ?? "" },
        domain,
        username,
      )
    ),
  };
  console.log(outbox);
  return jsonResponse(c, outbox, 200, "application/activity+json");
});

app.post("/users/:username/outbox", async (c) => {
  const username = c.req.param("username");
  const body = await c.req.json();
  if (typeof body.type !== "string" || typeof body.content !== "string") {
    return jsonResponse(c, { error: "Invalid body" }, 400);
  }
  const object = new ActivityPubObject({
    type: body.type,
    attributedTo: username,
    content: body.content,
    to: body.to ?? [],
    cc: body.cc ?? [],
    extra: body.extra ?? {},
  });
  await object.save();
  const domain = getDomain(c);
  // contentをstringに変換して渡す
  const activity = buildActivityFromStored(
    { ...object.toObject(), content: object.content ?? "" },
    domain,
    username,
    true,
  );
  deliverActivityPubObject([...object.to, ...object.cc], activity, username)
    .catch(
      (err) => {
        console.error("Delivery failed:", err);
      },
    );
  return jsonResponse(c, activity, 201, "application/activity+json");
});

app.post("/users/:username/inbox", async (c) => {
  const username = c.req.param("username");
  const account = await Account.findOne({ userName: username });
  if (!account) return jsonResponse(c, { error: "Not found" }, 404);
  const bodyText = await c.req.text();
  const verified = await verifyHttpSignature(c.req.raw, bodyText);
  if (!verified) return jsonResponse(c, { error: "Invalid signature" }, 401);
  const activity = JSON.parse(bodyText);
  const handler = activityHandlers[activity.type];
  if (handler) {
    await handler(activity, username, c);
  }
  return jsonResponse(c, { status: "ok" }, 200, "application/activity+json");
});

app.get("/users/:username/followers", async (c) => {
  const username = c.req.param("username");
  const account = await Account.findOne({ userName: username }).lean();
  if (!account) return jsonResponse(c, { error: "Not found" }, 404);
  const domain = getDomain(c);
  const list = account.followers ?? [];
  return jsonResponse(
    c,
    {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `https://${domain}/users/${username}/followers`,
      type: "OrderedCollection",
      totalItems: list.length,
      orderedItems: list,
    },
    200,
    "application/activity+json",
  );
});

app.get("/users/:username/following", async (c) => {
  const username = c.req.param("username");
  const account = await Account.findOne({ userName: username }).lean();
  if (!account) return jsonResponse(c, { error: "Not found" }, 404);
  const domain = getDomain(c);
  const list = account.following ?? [];
  return jsonResponse(
    c,
    {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `https://${domain}/users/${username}/following`,
      type: "OrderedCollection",
      totalItems: list.length,
      orderedItems: list,
    },
    200,
    "application/activity+json",
  );
});

// ActivityPub アクタープロキシ（外部ユーザー情報取得用）
app.get("/activitypub/actor-proxy", async (c) => {
  try {
    const actorUrl = c.req.query("url");
    if (!actorUrl || typeof actorUrl !== "string") {
      return c.json({ error: "Actor URL is required" }, 400);
    }

    // URLの検証
    try {
      new URL(actorUrl);
    } catch {
      return c.json({ error: "Invalid URL" }, 400);
    }

    // ActivityPub Accept ヘッダーでリクエスト
    const response = await fetch(actorUrl, {
      headers: {
        "Accept":
          'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
        "User-Agent": "Takos ActivityPub Client/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch actor: ${response.status}`);
    }

    const actor = await response.json();

    // 必要な情報のみを返す（セキュリティのため）
    return c.json({
      name: actor.name || "",
      preferredUsername: actor.preferredUsername || "",
      icon: actor.icon || null,
      summary: actor.summary || "",
    });
  } catch (error) {
    console.error("Error proxying ActivityPub actor:", error);
    return c.json({ error: "Failed to fetch actor information" }, 500);
  }
});

export default app;
