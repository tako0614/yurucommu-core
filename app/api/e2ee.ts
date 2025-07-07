import { Hono } from "hono";
import KeyPackage from "./models/key_package.ts";
import EncryptedMessage from "./models/encrypted_message.ts";
import ActivityPubObject from "./models/activitypub_object.ts";
import Account from "./models/account.ts";
import authRequired from "./utils/auth.ts";
import {
  buildActivityFromStored,
  createAddActivity,
  createCreateActivity,
  createDeleteActivity,
  createRemoveActivity,
  deliverActivityPubObject,
  fetchActorInbox,
  getDomain,
} from "./utils/activitypub.ts";

const app = new Hono();
app.use("*", authRequired);

async function deliverToFollowers(
  user: string,
  activity: unknown,
  domain: string,
) {
  const account = await Account.findOne({ userName: user }).lean();
  if (!account || !account.followers) return;
  const followerInboxes = await Promise.all(
    account.followers.map(async (actorUrl: string) => {
      try {
        const url = new URL(actorUrl);
        if (url.host === domain && url.pathname.startsWith("/users/")) {
          return null;
        }
        return await fetchActorInbox(actorUrl);
      } catch {
        return null;
      }
    }),
  );
  const validInboxes = followerInboxes.filter((i): i is string =>
    typeof i === "string" && !!i
  );
  if (validInboxes.length > 0) {
    deliverActivityPubObject(validInboxes, activity, user).catch((err) => {
      console.error("Delivery failed:", err);
    });
  }
}

app.get("/users/:user/keyPackages", async (c) => {
  const user = c.req.param("user");
  const list = await KeyPackage.find({ userName: user }).lean();
  const domain = getDomain(c);
  const items = list.map((doc) => ({
    id: `https://${domain}/users/${user}/keyPackage/${doc._id}`,
    type: "KeyPackage",
    content: doc.content,
    mediaType: doc.mediaType,
    encoding: doc.encoding,
    createdAt: doc.createdAt,
  }));
  return c.json({ type: "Collection", items });
});

app.get("/users/:user/keyPackage/:keyId", async (c) => {
  const user = c.req.param("user");
  const keyId = c.req.param("keyId");
  const doc = await KeyPackage.findOne({ _id: keyId, userName: user }).lean();
  if (!doc) return c.body("Not Found", 404);
  const domain = getDomain(c);
  const object = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://purl.archive.org/socialweb/mls",
    ],
    id: `https://${domain}/users/${user}/keyPackage/${keyId}`,
    type: "KeyPackage",
    attributedTo: `https://${domain}/users/${user}`,
    to: ["https://www.w3.org/ns/activitystreams#Public"],
    mediaType: doc.mediaType,
    encoding: doc.encoding,
    content: doc.content,
  };
  return c.json(object);
});

app.post("/users/:user/keyPackages", async (c) => {
  const user = c.req.param("user");
  const { content, mediaType, encoding } = await c.req.json();
  if (typeof content !== "string") {
    return c.json({ error: "content is required" }, 400);
  }
  const pkg = await KeyPackage.create({
    userName: user,
    content,
    mediaType: mediaType ?? "message/mls",
    encoding: encoding ?? "base64",
  });
  const domain = getDomain(c);
  const actorId = `https://${domain}/users/${user}`;
  const keyObj = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://purl.archive.org/socialweb/mls",
    ],
    id: `https://${domain}/users/${user}/keyPackage/${pkg._id}`,
    type: "KeyPackage",
    attributedTo: actorId,
    to: ["https://www.w3.org/ns/activitystreams#Public"],
    mediaType: pkg.mediaType,
    encoding: pkg.encoding,
    content: pkg.content,
  };
  const addActivity = createAddActivity(domain, actorId, keyObj);
  await deliverToFollowers(user, addActivity, domain);
  return c.json({ result: "ok", keyId: pkg._id.toString() });
});

app.delete("/users/:user/keyPackages/:keyId", async (c) => {
  const user = c.req.param("user");
  const keyId = c.req.param("keyId");
  await KeyPackage.deleteOne({ _id: keyId, userName: user });
  const domain = getDomain(c);
  const actorId = `https://${domain}/users/${user}`;
  const removeActivity = createRemoveActivity(
    domain,
    actorId,
    `https://${domain}/users/${user}/keyPackage/${keyId}`,
  );
  const deleteActivity = createDeleteActivity(
    domain,
    actorId,
    `https://${domain}/users/${user}/keyPackage/${keyId}`,
  );
  await deliverToFollowers(user, removeActivity, domain);
  await deliverToFollowers(user, deleteActivity, domain);
  return c.json({ result: "removed" });
});

app.post("/users/:user/messages", async (c) => {
  const sender = c.req.param("user");
  const { to, content, mediaType, encoding } = await c.req.json();
  if (!Array.isArray(to) || typeof content !== "string") {
    return c.json({ error: "invalid body" }, 400);
  }
  const msg = await EncryptedMessage.create({
    from: sender,
    to,
    content,
    mediaType: mediaType ?? "message/mls",
    encoding: encoding ?? "base64",
  });
  const domain = getDomain(c);
  const actorId = `https://${domain}/users/${sender}`;
  const object = await ActivityPubObject.create({
    type: "PrivateMessage",
    attributedTo: sender,
    content,
    to,
    extra: { mediaType: msg.mediaType, encoding: msg.encoding },
  });

  const privateMessage = buildActivityFromStored(
    { ...object.toObject(), content },
    domain,
    sender,
    false,
  );

  const activity = createCreateActivity(domain, actorId, privateMessage);
  // 個別配信
  activity.to = to;
  activity.cc = [];
  deliverActivityPubObject(to, activity, sender).catch((err) => {
    console.error("deliver failed", err);
  });

  return c.json({ result: "sent", id: msg._id.toString() });
});

app.get("/users/:user/messages", async (c) => {
  const user = c.req.param("user");
  const list = await EncryptedMessage.find({ to: user }).sort({ createdAt: -1 })
    .lean();
  const messages = list.map((doc) => ({
    id: doc._id.toString(),
    from: doc.from,
    to: doc.to,
    content: doc.content,
    mediaType: doc.mediaType,
    encoding: doc.encoding,
    createdAt: doc.createdAt,
  }));
  return c.json(messages);
});

export default app;
