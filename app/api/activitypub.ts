import { Hono } from "hono";
import Account from "./models/account.ts";
import ActivityPubObject from "./models/activitypub_object.ts";

import {
  deliverActivityPubObject,
  ensurePem,
  verifyHttpSignature,
} from "./utils/activitypub.ts";
import { env } from "./utils/env.ts";

const app = new Hono();

function getDomain(c: any) {
  return env["ACTIVITYPUB_DOMAIN"] ?? new URL(c.req.url).host;
}

function jsonResponse(c: any, data: any, status = 200, contentType = "application/activity+json") {
  return c.body(JSON.stringify(data), status, {
    "content-type": contentType
  });
}

app.get("/.well-known/webfinger", async (c) => {
  const resource = c.req.query("resource");
  if (!resource?.startsWith("acct:")) {
    return c.json({ error: "Bad Request" }, 400);
  }
  const [username, host] = resource.slice(5).split("@");
  const expected = env["ACTIVITYPUB_DOMAIN"];
  if (expected && host !== expected) {
    return c.json({ error: "Not found" }, 404);
  }
  const domain = expected ?? host;
  const account = await Account.findOne({ userName: username });
  if (!account) return c.json({ error: "Not found" }, 404);
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
  if (!account) return c.json({ error: "Not found" }, 404);
  const domain = getDomain(c);

  const actor = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/v1"
    ],
    id: `https://${domain}/users/${username}`,
    type: "Person",
    preferredUsername: account.userName,
    name: account.displayName,
    summary: account.displayName,
    url: `https://${domain}/@${username}`,
    icon: {
      type: "Image",
      mediaType: "image/png",
      url: `https://${domain}/users/${username}/avatar`
    },
    inbox: `https://${domain}/users/${username}/inbox`,
    outbox: `https://${domain}/users/${username}/outbox`,
    followers: `https://${domain}/users/${username}/followers`,
    following: `https://${domain}/users/${username}/following`,
    publicKey: {
      id: `https://${domain}/users/${username}#main-key`,
      owner: `https://${domain}/users/${username}`,
      publicKeyPem: ensurePem(account.publicKey, "PUBLIC KEY"),
    },
  };
  return jsonResponse(c, actor);
});

app.get("/users/:username/outbox", async (c) => {
  const username = c.req.param("username");
  const domain = getDomain(c);
  const type = c.req.query("type");
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
    orderedItems: objects.map((n: any) => ({
      id: `https://${domain}/objects/${n._id}`,
      type: n.type,
      attributedTo: `https://${domain}/users/${username}`,
      content: n.content,
      published: n.published instanceof Date ? n.published.toISOString() : n.published,
      ...n.extra,
    })),
  };
  return jsonResponse(c, outbox);
});

app.post("/users/:username/outbox", async (c) => {
  const username = c.req.param("username");
  const body = await c.req.json();
  if (typeof body.type !== "string" || typeof body.content !== "string") {
    return c.json({ error: "Invalid body" }, 400);
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
  const activity = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `https://${domain}/objects/${object._id}`,
    type: object.type,
    attributedTo: `https://${domain}/users/${username}`,
    content: object.content,
    published: object.published instanceof Date ? object.published.toISOString() : object.published,
    ...object.extra,
  };
  deliverActivityPubObject([...object.to, ...object.cc], activity, username).catch(
    (err) => {
      console.error("Delivery failed:", err);
    },
  );
  return jsonResponse(c, activity, 201);
});

app.post("/users/:username/inbox", async (c) => {
  const username = c.req.param("username");
  const account = await Account.findOne({ userName: username });
  if (!account) return c.json({ error: "Not found" }, 404);
  const bodyText = await c.req.text();
  const verified = await verifyHttpSignature(c.req.raw, bodyText);
  if (!verified) return c.json({ error: "Invalid signature" }, 401);
  const activity = JSON.parse(bodyText);
  if (activity.type === "Follow" && typeof activity.actor === "string") {
    await Account.updateOne(
      { userName: username },
      { $addToSet: { followers: activity.actor } },
    );
    const domain = getDomain(c);
    const accept = {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `https://${domain}/activities/${crypto.randomUUID()}`,
      type: "Accept",
      actor: `https://${domain}/users/${username}`,
      object: activity,
    };
    deliverActivityPubObject([activity.actor], accept, username).catch(
      (err) => {
        console.error("Delivery failed:", err);
      },
    );
  }
  return jsonResponse(c, { status: "ok" });
});

export default app;
