import { Hono } from "hono";
import { createDB } from "../DB/mod.ts";
import { getEnv } from "../../shared/config.ts";
import { getFollowList } from "../services/follow-info.ts";

import { activityHandlers } from "../activity_handlers.ts";
import { getSystemKey } from "../services/system_actor.ts";

import {
  buildActivityFromStored,
  createActor,
  createObjectId,
  deliverActivityPubObject,
  getDomain,
  jsonResponse,
  verifyHttpSignature,
} from "../utils/activitypub.ts";

const app = new Hono();

interface KeyPackageDoc {
  _id: unknown;
}

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
  const env = getEnv(c);
  const db = createDB(env);
  const account = await db.findAccountByUserName(username);
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
  const db = createDB(getEnv(c));
  const { publicKey } = await getSystemKey(db, domain);
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
    const db = createDB(getEnv(c));
    const { publicKey } = await getSystemKey(db, domain);
    const actor = createActor(domain, {
      userName: "system",
      displayName: "system",
      publicKey,
    });
    return jsonResponse(c, actor, 200, "application/activity+json");
  }
  const env = getEnv(c);
  const db = createDB(env);
  const account = await db.findAccountByUserName(username);
  if (!account) return jsonResponse(c, { error: "Not found" }, 404);
  const domain = getDomain(c);

  const actor = createActor(domain, {
    userName: account.userName,
    displayName: account.displayName,
    publicKey: account.publicKey,
  });
  const packages = await db.listKeyPackages(username) as KeyPackageDoc[];
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
  const env = getEnv(c);
  const db = createDB(env);
  const account = await db.findAccountByUserName(username);
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
  const db = createDB(env);
  const objects = await db.findObjects(query, { published: -1 });
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
  const db = createDB(env);
  const object = await db.saveObject({
    _id: createObjectId(domain),
    type: body.type,
    attributedTo: username,
    content: body.content,
    to: body.to ?? [],
    cc: body.cc ?? [],
    extra: body.extra ?? {},
    actor_id: `https://${domain}/users/${username}`,
    aud: { to: body.to ?? [], cc: body.cc ?? [] },
  }) as {
    _id: unknown;
    type?: string;
    content?: string;
    published: unknown;
    extra?: Record<string, unknown>;
    to?: string[];
    cc?: string[];
  };
  // contentをstringに変換して渡す
  const activity = buildActivityFromStored(
    {
      _id: object._id,
      type: object.type ?? "Note",
      content: object.content ?? "",
      published: object.published,
      extra: object.extra ?? {},
    },
    domain,
    username,
    true,
  );
  deliverActivityPubObject(
    [...(object.to ?? []), ...(object.cc ?? [])],
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
      const db = createDB(getEnv(c));
      await db.saveObject(activity.object as Record<string, unknown>);
    }
    return jsonResponse(c, { status: "ok" }, 200, "application/activity+json");
  }
  const env = getEnv(c);
  const db = createDB(env);
  const account = await db.findAccountByUserName(username);
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
  const env = getEnv(c);
  let list: string[];
  try {
    list = await getFollowList(username, "followers", env);
  } catch {
    return jsonResponse(c, { error: "Not found" }, 404);
  }
  const domain = getDomain(c);
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
  const env = getEnv(c);
  let list: string[];
  try {
    list = await getFollowList(username, "following", env);
  } catch {
    return jsonResponse(c, { error: "Not found" }, 404);
  }
  const domain = getDomain(c);
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

export default app;
