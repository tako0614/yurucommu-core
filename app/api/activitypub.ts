import { Hono } from "hono";
import Account from "./models/account.ts";
import { findObjects, saveObject } from "./services/unified_store.ts";
import KeyPackage from "./models/key_package.ts";
import { getEnv } from "../../shared/config.ts";

import { activityHandlers } from "./activity_handlers.ts";
import RemoteActor from "./models/remote_actor.ts";
import { getSystemKey } from "./services/system_actor.ts";

import {
  buildActivityFromStored,
  createActor,
  createObjectId,
  deliverActivityPubObject,
  getDomain,
  jsonResponse,
  verifyHttpSignature,
} from "./utils/activitypub.ts";

const app = new Hono();

app.get("/.well-known/webfinger", async (c) => {
  const resource = c.req.query("resource");
  if (!resource?.startsWith("acct:")) {
    return jsonResponse(c, { error: "Bad Request" }, 400);
  }
  const [username, host] = resource.slice(5).split("@");
  const expected = getEnv(c)["ACTIVITYPUB_DOMAIN"];
  if (expected && host !== expected) {
    return jsonResponse(c, { error: "Not found" }, 404);
  }
  const domain = expected ?? host;
  if (username === "system") {
    const jrd = {
      subject: `acct:system@${domain}`,
      links: [
        {
          rel: "self",
          type: "application/activity+json",
          href: `https://${domain}/users/system`,
        },
      ],
    };
    return jsonResponse(c, jrd, 200, "application/jrd+json");
  }
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

app.get("/users/system", async (c) => {
  const domain = getDomain(c);
  const { publicKey } = await getSystemKey(domain);
  const actor = createActor(domain, {
    userName: "system",
    displayName: "system",
    publicKey,
  });
  return jsonResponse(c, actor, 200, "application/activity+json");
});

app.get("/users/:username", async (c) => {
  const username = c.req.param("username");
  if (username === "system") {
    const domain = getDomain(c);
    const { publicKey } = await getSystemKey(domain);
    const actor = createActor(domain, {
      userName: "system",
      displayName: "system",
      publicKey,
    });
    return jsonResponse(c, actor, 200, "application/activity+json");
  }
  const account = await Account.findOne({ userName: username }).lean();
  if (!account) return jsonResponse(c, { error: "Not found" }, 404);
  const domain = getDomain(c);

  const actor = createActor(domain, {
    userName: account.userName,
    displayName: account.displayName,
    publicKey: account.publicKey,
  });
  const packages = await KeyPackage.find({ userName: username }).lean();
  actor.keyPackages = {
    type: "Collection",
    id: `https://${domain}/users/${username}/keyPackages`,
    totalItems: packages.length,
    items: packages.map((p) =>
      `https://${domain}/users/${username}/keyPackage/${p._id}`
    ),
  };
  return jsonResponse(c, actor, 200, "application/activity+json");
});

app.get("/users/:username/avatar", async (c) => {
  const username = c.req.param("username");
  if (username === "system") {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="100%" height="100%" fill="#6b7280"/><text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" font-size="60" fill="#fff" font-family="sans-serif">S</text></svg>`;
    return c.body(svg, 200, { "content-type": "image/svg+xml" });
  }
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
  if (username === "system") {
    const domain = getDomain(c);
    return jsonResponse(
      c,
      {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: `https://${domain}/users/system/outbox`,
        type: "OrderedCollection",
        totalItems: 0,
        orderedItems: [],
      },
      200,
      "application/activity+json",
    );
  }
  const domain = getDomain(c);
  const type = c.req.query("type");
  // deno-lint-ignore no-explicit-any
  const query: any = { attributedTo: username };
  if (type) query.type = type;
  const env = getEnv(c);
  const objects = await findObjects(env, query, { published: -1 });
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
  const domain = getDomain(c);
  const env = getEnv(c);
  const object = await saveObject(env, {
    _id: createObjectId(domain),
    type: body.type,
    attributedTo: username,
    content: body.content,
    to: body.to ?? [],
    cc: body.cc ?? [],
    extra: body.extra ?? {},
    actor_id: `https://${domain}/users/${username}`,
    aud: { to: body.to ?? [], cc: body.cc ?? [] },
  });
  // contentをstringに変換して渡す
  const stored = object.toObject();
  const activity = buildActivityFromStored(
    {
      _id: stored._id,
      type: stored.type ?? "Note",
      content: stored.content ?? "",
      published: stored.published,
      extra: stored.extra ?? {},
    },
    domain,
    username,
    true,
  );
  deliverActivityPubObject(
    [...object.to, ...object.cc],
    activity,
    username,
    domain,
    env,
  )
    .catch(
      (err) => {
        console.error("Delivery failed:", err);
      },
    );
  return jsonResponse(c, activity, 201, "application/activity+json");
});

app.post("/users/:username/inbox", async (c) => {
  const username = c.req.param("username");
  if (username === "system") {
    const bodyText = await c.req.text();
    const verified = await verifyHttpSignature(c.req.raw, bodyText);
    if (!verified) return jsonResponse(c, { error: "Invalid signature" }, 401);
    const activity = JSON.parse(bodyText);
    if (activity.type === "Create" && typeof activity.object === "object") {
      await saveObject(getEnv(c), activity.object as Record<string, unknown>);
    }
    return jsonResponse(c, { status: "ok" }, 200, "application/activity+json");
  }
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
  if (username === "system") {
    const domain = getDomain(c);
    const baseId = `https://${domain}/users/system/followers`;
    return jsonResponse(
      c,
      {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: baseId,
        type: "OrderedCollection",
        totalItems: 0,
        first: `${baseId}?page=1`,
      },
      200,
      "application/activity+json",
    );
  }
  const page = c.req.query("page");
  const account = await Account.findOne({ userName: username }).lean();
  if (!account) return jsonResponse(c, { error: "Not found" }, 404);
  const domain = getDomain(c);
  const list = account.followers ?? [];
  const baseId = `https://${domain}/users/${username}/followers`;

  if (page) {
    return jsonResponse(
      c,
      {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: `${baseId}?page=1`,
        type: "OrderedCollectionPage",
        partOf: baseId,
        orderedItems: list,
        next: null,
        prev: null,
      },
      200,
      "application/activity+json",
    );
  }

  return jsonResponse(
    c,
    {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: baseId,
      type: "OrderedCollection",
      totalItems: list.length,
      first: `${baseId}?page=1`,
    },
    200,
    "application/activity+json",
  );
});

app.get("/users/:username/following", async (c) => {
  const username = c.req.param("username");
  if (username === "system") {
    const domain = getDomain(c);
    const baseId = `https://${domain}/users/system/following`;
    return jsonResponse(
      c,
      {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: baseId,
        type: "OrderedCollection",
        totalItems: 0,
        first: `${baseId}?page=1`,
      },
      200,
      "application/activity+json",
    );
  }
  const page = c.req.query("page");
  const account = await Account.findOne({ userName: username }).lean();
  if (!account) return jsonResponse(c, { error: "Not found" }, 404);
  const domain = getDomain(c);
  const list = account.following ?? [];
  const baseId = `https://${domain}/users/${username}/following`;

  if (page) {
    return jsonResponse(
      c,
      {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: `${baseId}?page=1`,
        type: "OrderedCollectionPage",
        partOf: baseId,
        orderedItems: list,
        next: null,
        prev: null,
      },
      200,
      "application/activity+json",
    );
  }

  return jsonResponse(
    c,
    {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: baseId,
      type: "OrderedCollection",
      totalItems: list.length,
      first: `${baseId}?page=1`,
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

    // 既存キャッシュを確認
    const cached = await RemoteActor.findOne({ actorUrl }).lean();
    if (cached) {
      return c.json({
        name: cached.name,
        preferredUsername: cached.preferredUsername,
        icon: cached.icon,
        summary: cached.summary,
      });
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

    // DBに保存
    await RemoteActor.findOneAndUpdate(
      { actorUrl },
      {
        name: actor.name || "",
        preferredUsername: actor.preferredUsername || "",
        icon: actor.icon || null,
        summary: actor.summary || "",
        cachedAt: new Date(),
      },
      { upsert: true },
    );

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
