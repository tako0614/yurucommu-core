import { Hono } from "hono";
import Account from "./models/account.ts";
import Note from "./models/note.ts";

import {
  deliverActivityPubObject,
  ensurePem,
  verifyHttpSignature,
} from "./utils/activitypub.ts";
import { env } from "./utils/env.ts";

const app = new Hono();

app.get("/.well-known/webfinger", async (c) => {
  const resource = c.req.query("resource");
  if (!resource?.startsWith("acct:")) {
    return c.json({ error: "Bad Request" }, 400);
  }
  const [username, host] = resource.slice(5).split("@");
  const domain = env["ACTIVITYPUB_DOMAIN"];
  if (host !== domain) {
    return c.json({ error: "Not found" }, 404);
  }
  const account = await Account.findOne({ userName: username });
  if (!account) return c.json({ error: "Not found" }, 404);
  return c.json({
    subject: `acct:${username}@${domain}`,
    links: [
      {
        rel: "self",
        type: "application/activity+json",
        href: `https://${domain}/users/${username}`,
      },
    ],
  });
});

app.get("/users/:username", async (c) => {
  const username = c.req.param("username");
  const account = await Account.findOne({ userName: username }).lean();
  if (!account) return c.json({ error: "Not found" }, 404);
  const domain = env["ACTIVITYPUB_DOMAIN"] ?? new URL(c.req.url).host;

  c.header("content-type", "application/activity+json");
  return c.json({
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `https://${domain}/users/${username}`,
    type: "Person",
    preferredUsername: account.userName,
    name: account.displayName,
    inbox: `https://${domain}/inbox/${username}`,
    outbox: `https://${domain}/users/${username}/outbox`,
    followers: `https://${domain}/users/${username}/followers`,
    following: `https://${domain}/users/${username}/following`,
    publicKey: {
      id: `https://${domain}/users/${username}#main-key`,
      owner: `https://${domain}/users/${username}`,
      publicKeyPem: ensurePem(account.publicKey, "PUBLIC KEY"),
    },
  });
});

app.get("/users/:username/outbox", async (c) => {
  const username = c.req.param("username");
  const domain = env["ACTIVITYPUB_DOMAIN"] ?? new URL(c.req.url).host;
  const notes = await Note.find({ attributedTo: username }).sort({
    published: -1,
  }).lean();
  c.header("content-type", "application/activity+json");
  return c.json({
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `https://${domain}/users/${username}/outbox`,
    type: "OrderedCollection",
    totalItems: notes.length,
    orderedItems: notes.map((n) => ({
      id: `https://${domain}/notes/${n._id}`,
      type: "Note",
      attributedTo: `https://${domain}/users/${username}`,
      content: n.content,
      published: n.published.toISOString(),
    })),
  });
});

app.post("/users/:username/outbox", async (c) => {
  const username = c.req.param("username");
  const body = await c.req.json();
  if (body.type !== "Note" || typeof body.content !== "string") {
    return c.json({ error: "Invalid body" }, 400);
  }
  const note = new Note({
    attributedTo: username,
    content: body.content,
    to: body.to ?? [],
    cc: body.cc ?? [],
  });
  await note.save();
  const domain = env["ACTIVITYPUB_DOMAIN"] ?? new URL(c.req.url).host;
  const activity = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `https://${domain}/notes/${note._id}`,
    type: "Note",
    attributedTo: `https://${domain}/users/${username}`,
    content: note.content,
    published: note.published.toISOString(),
  };
  deliverActivityPubObject([...note.to, ...note.cc], activity, username).catch(
    (err) => {
      console.error("Delivery failed:", err);
    },
  );
  c.header("content-type", "application/activity+json");
  return c.json(activity, 201);
});

app.post("/inbox/:username", async (c) => {
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
    const accept = {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `https://${
        env["ACTIVITYPUB_DOMAIN"]
      }/activities/${crypto.randomUUID()}`,
      type: "Accept",
      actor: `https://${env["ACTIVITYPUB_DOMAIN"]}/users/${username}`,
      object: activity,
    };
    deliverActivityPubObject([activity.actor], accept, username).catch(
      (err) => {
        console.error("Delivery failed:", err);
      },
    );
  }
  return c.json({ status: "ok" });
});

export default app;
