import { Hono } from "hono";
import { createDB } from "../DB/mod.ts";
import { getEnv } from "../../shared/config.ts";
import {
  buildActivityPubFollowCollection,
  UserNotFoundError,
} from "../services/follow-info.ts";

import { activityHandlers } from "../activity_handlers.ts";

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
  resolveActorFromAcct,
} from "../utils/activitypub.ts";
import { parseActivityRequest } from "../utils/inbox.ts";

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

app.get("/users/:username", async (c) => {
  const username = c.req.param("username");
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
  return jsonResponse(c, actor, 200, "application/activity+json");
});

app.get("/users/:username/avatar", async (c) => {
  const username = c.req.param("username");
  const env = getEnv(c);
  const db = createDB(env);
  const account = await db.findAccountByUserName(username);
  if (!account) return c.body("Not Found", 404);

  const icon = account.avatarInitial;
  if (
    !icon || (
      !icon.startsWith("http://") && !icon.startsWith("https://")
    )
  ) {
    return c.body(DEFAULT_AVATAR, 200, { "content-type": "image/png" });
  }
  return c.redirect(icon);
});

app.get("/users/:username/outbox", async (c) => {
  const username = c.req.param("username");
  const domain = getDomain(c);
  const env = getEnv(c);
  const db = createDB(env);
  // ノートのみを取得する
  const objectsUnknown = await db.findNotes(
    { attributedTo: `https://${domain}/users/${username}` },
    { published: -1 },
  ) as unknown[];

  // 型ガードでナローイング
  type ActivityObject = { type?: string; [k: string]: unknown };
  const isActivityObject = (v: unknown): v is ActivityObject =>
    typeof v === "object" && v !== null;

  const objects = objectsUnknown.filter(isActivityObject);
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
  if (typeof body.type !== "string") {
    return jsonResponse(c, { error: "Invalid body" }, 400);
  }
  const allowed = ["Note", "Image", "Video", "Audio", "Document"];
  if (!allowed.includes(body.type)) {
    return jsonResponse(c, { error: "Unsupported type" }, 400);
  }
  if (body.type === "Note") {
    if (!(typeof body.content === "string" && body.content.trim())) {
      return jsonResponse(c, { error: "Invalid body" }, 400);
    }
  } else if (
    !(typeof body.url === "string" && body.url &&
      typeof body.mediaType === "string" && body.mediaType)
  ) {
    return jsonResponse(c, { error: "Invalid body" }, 400);
  }
  const domain = getDomain(c);
  const env = getEnv(c);
  const db = createDB(env);
  const data: Record<string, unknown> = {
    _id: createObjectId(domain),
    type: body.type,
    attributedTo: `https://${domain}/users/${username}`,
    to: body.to ?? [],
    cc: body.cc ?? [],
    extra: body.extra ?? {},
    actor_id: `https://${domain}/users/${username}`,
    aud: { to: body.to ?? [], cc: body.cc ?? [] },
  };
  if (body.type === "Note") {
    data.content = body.content;
  } else {
    data.url = body.url;
    data.mediaType = body.mediaType;
    if (typeof body.name === "string") data.name = body.name;
    if (typeof body.content === "string") data.content = body.content;
  }
  const object = await db.saveObject(data) as {
    _id: unknown;
    type?: string;
    content?: string;
    url?: string;
    mediaType?: string;
    name?: string;
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
      url: object.url,
      mediaType: object.mediaType,
      name: object.name,
    },
    domain,
    username,
    true,
  );
  const recipients = [...(object.to ?? []), ...(object.cc ?? [])];
  const targets = await Promise.all(
    recipients.map(async (r) => {
      if (typeof r === "string" && r.startsWith("http")) return r;
      if (typeof r === "string") {
        const acct = r.startsWith("acct:") ? r.slice(5) : r;
        const actor = await resolveActorFromAcct(acct).catch(() => null);
        return actor?.id ?? null;
      }
      return null;
    }),
  );
  deliverActivityPubObject(
    targets.filter((t): t is string => typeof t === "string"),
    activity,
    username,
    domain,
    env,
  ).catch(
    (err) => {
      console.error("Delivery failed:", err);
    },
  );
  return jsonResponse(c, activity, 201, "application/activity+json");
});

app.post("/users/:username/inbox", async (c) => {
  const username = c.req.param("username");
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
