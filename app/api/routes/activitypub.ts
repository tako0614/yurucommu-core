import { Hono } from "hono";
import { createDB } from "../DB/mod.ts";
import { getEnv } from "../../shared/config.ts";
import {
  buildActivityPubFollowCollection,
  UserNotFoundError,
} from "../services/follow-info.ts";

import { activityHandlers } from "../activity_handlers.ts";
import { getSystemKey } from "../services/system_actor.ts";
import { b64ToBuf } from "../../shared/buffer.ts";

// 未設定時に返すデフォルトアイコン
const DEFAULT_AVATAR = await Deno.readFile(
  new URL("../image/people.png", import.meta.url),
);

import {
  buildActivityFromStored,
  createActor,
  createObjectId,
  deliverActivityPubObject,
  getDomain,
  jsonResponse,
} from "../utils/activitypub.ts";
import { parseActivityRequest, storeCreateActivity } from "../utils/inbox.ts";

const app = new Hono();

export async function getActivityPubFollowCollection(
  username: string,
  type: "followers" | "following",
  page: string | undefined,
  domain: string,
  env: Record<string, string>,
) {
  return await buildActivityPubFollowCollection(
    username,
    type,
    page,
    domain,
    env,
  );
}

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
  }, { includeIcon: false });
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
    }, { includeIcon: false });
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
      `https://${domain}/users/${username}/keyPackages/${p._id}`
    ),
  };
  // keyPackages を含める場合は MLS コンテキストを追加
  const mls = "https://purl.archive.org/socialweb/mls";
  if (Array.isArray(actor["@context"])) {
    if (!actor["@context"].includes(mls)) actor["@context"].push(mls);
  } else if (actor["@context"] !== mls) {
    actor["@context"] = [actor["@context"], mls];
  }
  return jsonResponse(c, actor, 200, "application/activity+json");
});

app.get("/users/:username/avatar", async (c) => {
  const username = c.req.param("username");
  if (username === "system") {
    const icon = username.slice(0, 2).toUpperCase();
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="100%" height="100%" fill="#6b7280"/><text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" font-size="60" fill="#fff" font-family="sans-serif">${icon}</text></svg>`;
    return c.body(svg, 200, { "content-type": "image/svg+xml" });
  }
  const env = getEnv(c);
  const db = createDB(env);
  const account = await db.findAccountByUserName(username);
  if (!account) return c.body("Not Found", 404);

  const icon = account.avatarInitial;
  // 未設定またはテキストのみの場合はデフォルトアイコンを返す
  if (
    !icon ||
    (!icon.startsWith("http://") &&
      !icon.startsWith("https://") &&
      !icon.startsWith("/") &&
      !icon.startsWith("data:image/"))
  ) {
    return c.body(DEFAULT_AVATAR, 200, {
      "content-type": "image/png",
    });
  }
  // 保存されている値がURLの場合はリダイレクトする
  if (icon.startsWith("http://") || icon.startsWith("https://")) {
    return c.redirect(icon);
  }
  if (icon.startsWith("/")) {
    const domain = getDomain(c);
    return c.redirect(`https://${domain}${icon}`);
  }
  // データURLの場合はデコードして返す
  if (icon.startsWith("data:image/")) {
    const match = icon.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (match) {
      const [, type, data] = match;
      const bytes = b64ToBuf(data);
      return c.body(bytes, 200, { "content-type": type });
    }
  }

  // 上記に該当しない場合もデフォルトアイコンを返す
  return c.body(DEFAULT_AVATAR, 200, { "content-type": "image/png" });
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
  const env = getEnv(c);
  const db = createDB(env);
  // Message を outbox から除外する
  const objectsUnknown = await db.findObjects(
    { attributedTo: username },
    { published: -1 },
  ) as unknown[];

  // 型ガードでナローイング
  type ActivityObject = { type?: string; [k: string]: unknown };
  const isActivityObject = (v: unknown): v is ActivityObject =>
    typeof v === "object" && v !== null;

  const objects = objectsUnknown
    .filter(isActivityObject)
    .filter((o) => o.type !== "Message");
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
  // Message の投稿は outbox では受け付けない
  if (body.type === "Message") {
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
    const result = await parseActivityRequest(c);
    if (!result) return jsonResponse(c, { error: "Invalid signature" }, 401);
    const { activity } = result;
    await storeCreateActivity(activity, getEnv(c));
    return jsonResponse(c, { status: "ok" }, 200, "application/activity+json");
  }
  const env = getEnv(c);
  const db = createDB(env);
  const account = await db.findAccountByUserName(username);
  if (!account) return jsonResponse(c, { error: "Not found" }, 404);
  const result = await parseActivityRequest(c);
  if (!result) return jsonResponse(c, { error: "Invalid signature" }, 401);
  const { activity } = result;

  // activity.type の型安全な参照
  const typeVal = (activity as { type?: unknown })?.type;
  if (typeof typeVal === "string" && typeVal in activityHandlers) {
    // deno-lint-ignore no-explicit-any
    const handler = (activityHandlers as Record<string, any>)[typeVal];
    if (typeof handler === "function") {
      const res = await handler(activity as unknown, username, c);
      // handler が Hono のレスポンス用のオブジェクトを返したらそれを返す
      if (
        res && typeof res === "object" &&
        ("status" in (res as object) || "body" in (res as object))
      ) {
        return res as unknown as Response;
      }
    }
  }
  return jsonResponse(c, { status: "ok" }, 200, "application/activity+json");
});

app.get("/ap/users/:username/followers", async (c) => {
  const username = c.req.param("username");
  if (username === "system") {
    const domain = getDomain(c);
    const baseId = `https://${domain}/ap/users/system/followers`;
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
  const domain = getDomain(c);
  let data: Record<string, unknown>;
  try {
    data = await getActivityPubFollowCollection(
      username,
      "followers",
      page,
      domain,
      env,
    );
  } catch (error) {
    if (error instanceof UserNotFoundError) {
      console.warn("User not found", username);
      return jsonResponse(c, { error: "Not found" }, 404);
    }
    console.error("Error fetching followers:", error);
    return jsonResponse(c, { error: "Failed to fetch followers" }, 500);
  }
  return jsonResponse(c, data, 200, "application/activity+json");
});

app.get("/ap/users/:username/following", async (c) => {
  const username = c.req.param("username");
  if (username === "system") {
    const domain = getDomain(c);
    const baseId = `https://${domain}/ap/users/system/following`;
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
  const domain = getDomain(c);
  let data: Record<string, unknown>;
  try {
    data = await getActivityPubFollowCollection(
      username,
      "following",
      page,
      domain,
      env,
    );
  } catch (error) {
    if (error instanceof UserNotFoundError) {
      console.warn("User not found", username);
      return jsonResponse(c, { error: "Not found" }, 404);
    }
    console.error("Error fetching following:", error);
    return jsonResponse(c, { error: "Failed to fetch following" }, 500);
  }
  return jsonResponse(c, data, 200, "application/activity+json");
});

export default app;
