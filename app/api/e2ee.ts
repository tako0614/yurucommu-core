import { Hono } from "hono";
import KeyPackage from "./models/key_package.ts";
import EncryptedMessage from "./models/encrypted_message.ts";
import PublicMessage from "./models/public_message.ts";
import ActivityPubObject from "./models/activitypub_object.ts";
import Account from "./models/account.ts";
import authRequired from "./utils/auth.ts";
import {
  type ActivityPubActor,
  buildActivityFromStored,
  createAddActivity,
  createCreateActivity,
  createDeleteActivity,
  createRemoveActivity,
  deliverActivityPubObject,
  fetchActorInbox,
  fetchJson,
  getDomain,
  resolveActor,
} from "./utils/activitypub.ts";

interface ActivityPubActivity {
  [key: string]: unknown;
  "@context"?: unknown;
  to?: unknown;
  cc?: unknown;
}
import RemoteActor from "./models/remote_actor.ts";

async function resolveActorCached(acct: string) {
  const [name, host] = acct.split("@");
  if (!name || !host) return null;

  const hostRegex = new RegExp(
    `^https?://${host.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}/`,
  );
  const cached = await RemoteActor.findOne({
    preferredUsername: name,
    actorUrl: { $regex: hostRegex },
  }).lean();

  let actor:
    | (ActivityPubActor & { keyPackages?: string | { id?: string } })
    | null = null;
  if (cached) {
    try {
      actor = await fetchJson<
        ActivityPubActor & { keyPackages?: string | { id?: string } }
      >(
        cached.actorUrl,
      );
    } catch (err) {
      console.error(`Failed to fetch cached actor ${cached.actorUrl}:`, err);
    }
  }

  if (!actor) {
    actor = await resolveActor(name, host) as
      | (ActivityPubActor & { keyPackages?: string | { id?: string } })
      | null;
    if (actor) {
      await RemoteActor.findOneAndUpdate(
        { actorUrl: actor.id },
        {
          name: actor.name || "",
          preferredUsername: actor.preferredUsername || "",
          icon: actor.icon || null,
          summary: actor.summary || "",
          cachedAt: new Date(),
        },
        { upsert: true },
      );
    }
  }

  return actor;
}

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
  const acct = c.req.param("user");
  const domain = getDomain(c);

  const [user, host] = acct.split("@");
  if (!user || !host) {
    return c.json({ error: "invalid user format" }, 400);
  }

  if (host === domain) {
    const list = await KeyPackage.find({ userName: acct }).lean();
    const items = list.map((doc) => ({
      id: `https://${domain}/users/${user}/keyPackage/${doc._id}`,
      type: "KeyPackage",
      content: doc.content,
      mediaType: doc.mediaType,
      encoding: doc.encoding,
      createdAt: doc.createdAt,
    }));
    return c.json({ type: "Collection", items });
  }

  const actor = await resolveActorCached(acct);
  if (!actor) return c.json({ type: "Collection", items: [] });
  const kpUrl = typeof actor.keyPackages === "string"
    ? actor.keyPackages
    : actor.keyPackages?.id;
  if (!kpUrl) return c.json({ type: "Collection", items: [] });

  try {
    const col = await fetchJson<{ items?: unknown[] }>(kpUrl);
    const items = Array.isArray(col.items) ? col.items : [];
    return c.json({ type: "Collection", items });
  } catch (_err) {
    console.error("remote keyPackages fetch failed", _err);
    return c.json({ type: "Collection", items: [] });
  }
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
  const acct = c.req.param("user");
  const [sender, senderDomain] = acct.split("@");
  if (!sender || !senderDomain) {
    return c.json({ error: "invalid user format" }, 400);
  }
  const { to, content, mediaType, encoding } = await c.req.json();
  if (!Array.isArray(to) || typeof content !== "string") {
    return c.json({ error: "invalid body" }, 400);
  }
  const msg = await EncryptedMessage.create({
    from: acct,
    to,
    content,
    mediaType: mediaType ?? "message/mls",
    encoding: encoding ?? "base64",
  });
  const domain = getDomain(c);
  const actorId = `https://${domain}/users/${sender}`;
  const object = await ActivityPubObject.create({
    type: "PrivateMessage",
    attributedTo: acct,
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
  (privateMessage as ActivityPubActivity)["@context"] = [
    "https://www.w3.org/ns/activitystreams",
    "https://purl.archive.org/socialweb/mls",
  ];

  const activity = createCreateActivity(domain, actorId, privateMessage);
  (activity as ActivityPubActivity)["@context"] = [
    "https://www.w3.org/ns/activitystreams",
    "https://purl.archive.org/socialweb/mls",
  ];
  // 個別配信
  (activity as ActivityPubActivity).to = to;
  (activity as ActivityPubActivity).cc = [];
  deliverActivityPubObject(to, activity, sender).catch((err) => {
    console.error("deliver failed", err);
  });

  return c.json({ result: "sent", id: msg._id.toString() });
});

app.post("/users/:user/publicMessages", async (c) => {
  const acct = c.req.param("user");
  const [sender, senderDomain] = acct.split("@");
  if (!sender || !senderDomain) {
    return c.json({ error: "invalid user format" }, 400);
  }
  const { to, content, mediaType, encoding } = await c.req.json();
  if (!Array.isArray(to) || typeof content !== "string") {
    return c.json({ error: "invalid body" }, 400);
  }
  const msg = await PublicMessage.create({
    from: acct,
    to,
    content,
    mediaType: mediaType ?? "message/mls",
    encoding: encoding ?? "base64",
  });
  const domain = getDomain(c);
  const actorId = `https://${domain}/users/${sender}`;
  const object = await ActivityPubObject.create({
    type: "PublicMessage",
    attributedTo: acct,
    content,
    to,
    extra: { mediaType: msg.mediaType, encoding: msg.encoding },
  });

  const publicMessage = buildActivityFromStored(
    { ...object.toObject(), content },
    domain,
    sender,
    false,
  );
  (publicMessage as ActivityPubActivity)["@context"] = [
    "https.://www.w3.org/ns/activitystreams",
    "https://purl.archive.org/socialweb/mls",
  ];

  const activity = createCreateActivity(domain, actorId, publicMessage);
  (activity as ActivityPubActivity)["@context"] = [
    "https://www.w3.org/ns/activitystreams",
    "https://purl.archive.org/socialweb/mls",
  ];
  (activity as ActivityPubActivity).to = to;
  (activity as ActivityPubActivity).cc = [];
  deliverActivityPubObject(to, activity, sender).catch((err) => {
    console.error("deliver failed", err);
  });

  return c.json({ result: "sent", id: msg._id.toString() });
});

app.get("/users/:user/messages", async (c) => {
  const acct = c.req.param("user");
  const [user, userDomain] = acct.split("@");
  if (!user || !userDomain) {
    return c.json({ error: "invalid user format" }, 400);
  }

  const actor = await resolveActorCached(acct);
  const actorId = actor?.id ?? `https://${userDomain}/users/${user}`;
  const partnerAcct = c.req.query("with");
  const [partnerUser, partnerDomain] = partnerAcct?.split("@") ?? [];
  const partnerActorObj = partnerAcct
    ? await resolveActorCached(partnerAcct)
    : null;
  let partnerActor = partnerActorObj?.id;
  if (!partnerActor && partnerUser && partnerDomain) {
    partnerActor = `https://${partnerDomain}/users/${partnerUser}`;
  }

  const condition = partnerAcct
    ? {
      $or: [
        { from: partnerAcct, to: { $in: [actorId, acct] } },
        {
          from: acct,
          to: {
            $in: partnerActor ? [partnerActor, partnerAcct] : [partnerAcct],
          },
        },
      ],
    }
    : { to: { $in: [actorId, acct] } };

  const list = await EncryptedMessage.find(condition).sort({ createdAt: 1 })
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

app.get("/users/:user/publicMessages", async (c) => {
  const acct = c.req.param("user");
  const [user, userDomain] = acct.split("@");
  if (!user || !userDomain) {
    return c.json({ error: "invalid user format" }, 400);
  }

  const actor = await resolveActorCached(acct);
  const actorId = actor?.id ?? `https://${userDomain}/users/${user}`;
  const partnerAcct = c.req.query("with");
  const [partnerUser, partnerDomain] = partnerAcct?.split("@") ?? [];
  const partnerActorObj = partnerAcct
    ? await resolveActorCached(partnerAcct)
    : null;
  let partnerActor = partnerActorObj?.id;
  if (!partnerActor && partnerUser && partnerDomain) {
    partnerActor = `https://${partnerDomain}/users/${partnerUser}`;
  }

  const condition = partnerAcct
    ? {
      $or: [
        { from: partnerAcct, to: { $in: [actorId, acct] } },
        {
          from: acct,
          to: {
            $in: partnerActor ? [partnerActor, partnerAcct] : [partnerAcct],
          },
        },
      ],
    }
    : { to: { $in: [actorId, acct] } };

  const list = await PublicMessage.find(condition).sort({ createdAt: 1 })
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
