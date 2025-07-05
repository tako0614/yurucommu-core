import { Hono } from "hono";
import Account from "./models/account.ts";
import ActivityPubObject from "./models/activitypub_object.ts";

import {
  buildActivityFromStored,
  createAcceptActivity,
  createActor,
  deliverActivityPubObject,
  getDomain,
  jsonResponse,
  verifyHttpSignature,
} from "./utils/activitypub.ts";
import { env } from "./utils/env.ts";

const app = new Hono();
import { logger } from 'hono/logger'
app.use(logger())

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
  await ActivityPubObject.create({
    type: activity.type || "Activity",
    attributedTo: typeof activity.actor === "string" ? activity.actor : "",
    inboxUser: username,
    raw: activity,
  });
  if (activity.type === "Follow" && typeof activity.actor === "string") {
    await Account.updateOne(
      { userName: username },
      { $addToSet: { followers: activity.actor } },
    );
    const domain = getDomain(c);
    const accept = createAcceptActivity(
      domain,
      `https://${domain}/users/${username}`,
      activity,
    );
    deliverActivityPubObject([activity.actor], accept, username).catch(
      (err) => {
        console.error("Delivery failed:", err);
      },
    );
  }
  return jsonResponse(c, { status: "ok" }, 200, "application/activity+json");
});

export default app;
