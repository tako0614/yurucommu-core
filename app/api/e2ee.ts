import { Hono } from "hono";
import { createDB } from "./db.ts";
import authRequired from "./utils/auth.ts";
import { getEnv } from "../shared/config.ts";
import { rateLimit } from "./utils/rate_limit.ts";
import {
  type ActivityPubActor,
  buildActivityFromStored,
  createAddActivity,
  createCreateActivity,
  createDeleteActivity,
  createRemoveActivity,
  deliverActivityPubObject,
  fetchJson,
  getDomain,
  resolveActor,
} from "./utils/activitypub.ts";
import { deliverToFollowers } from "./utils/deliver.ts";

interface ActivityPubActivity {
  [key: string]: unknown;
  "@context"?: unknown;
  to?: unknown;
  cc?: unknown;
}

interface RemoteActorCache {
  actorUrl: string;
}

interface KeyPackageDoc {
  _id?: unknown;
  content: string;
  mediaType: string;
  encoding: string;
  createdAt: unknown;
}

interface EncryptedKeyPairDoc {
  content: string;
}

interface EncryptedMessageDoc {
  _id?: unknown;
  from: string;
  to: string[];
  content: string;
  mediaType: string;
  encoding: string;
  createdAt: unknown;
}

async function resolveActorCached(
  acct: string,
  env: Record<string, string>,
) {
  const [name, host] = acct.split("@");
  if (!name || !host) return null;

  const db = createDB(env);
  const cached = await db.findRemoteActorByUrl(
    acct.startsWith("http") ? acct : "",
  ) as RemoteActorCache | null;

  let actor:
    | (ActivityPubActor & { keyPackages?: string | { id?: string } })
    | null = null;
  if (cached) {
    try {
      actor = await fetchJson<
        ActivityPubActor & { keyPackages?: string | { id?: string } }
      >(
        cached.actorUrl,
        {},
        undefined,
        env,
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
      await db.upsertRemoteActor({
        actorUrl: actor.id,
        name: actor.name || "",
        preferredUsername: actor.preferredUsername || "",
        icon: actor.icon || null,
        summary: actor.summary || "",
      });
    }
  }

  return actor;
}

const app = new Hono();

app.get("/users/:user/keyPackages", async (c) => {
  const identifier = c.req.param("user");
  const domain = getDomain(c);

  const [user, host] = identifier.split("@");
  if (!host || host === domain) {
    const username = user ?? identifier;
    const db = createDB(getEnv(c));
    const list = await db.listKeyPackages(username) as KeyPackageDoc[];
    const items = list.map((doc) => ({
      id: `https://${domain}/users/${username}/keyPackage/${doc._id}`,
      type: "KeyPackage",
      content: doc.content,
      mediaType: doc.mediaType,
      encoding: doc.encoding,
      createdAt: doc.createdAt,
    }));
    return c.json({ type: "Collection", items });
  }

  const acct = identifier;

  const actor = await resolveActorCached(
    acct,
    getEnv(c),
  );
  if (!actor) return c.json({ type: "Collection", items: [] });
  const kpUrl = typeof actor.keyPackages === "string"
    ? actor.keyPackages
    : actor.keyPackages?.id;
  if (!kpUrl) return c.json({ type: "Collection", items: [] });

  try {
    const col = await fetchJson<{ items?: unknown[] }>(
      kpUrl,
      {},
      undefined,
      getEnv(c),
    );
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
  const domain = getDomain(c);
  const db = createDB(getEnv(c));
  const doc = await db.findKeyPackage(user, keyId) as KeyPackageDoc | null;
  if (!doc) return c.body("Not Found", 404);
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

app.post("/users/:user/keyPackages", authRequired, async (c) => {
  const user = c.req.param("user");
  const { content, mediaType, encoding } = await c.req.json();
  if (typeof content !== "string") {
    return c.json({ error: "content is required" }, 400);
  }
  const db = createDB(getEnv(c));
  const pkg = await db.createKeyPackage(
    user,
    content,
    mediaType,
    encoding,
  ) as KeyPackageDoc;
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
  await deliverToFollowers(getEnv(c), user, addActivity, domain);
  return c.json({ result: "ok", keyId: String(pkg._id) });
});

app.delete("/users/:user/keyPackages/:keyId", authRequired, async (c) => {
  const user = c.req.param("user");
  const keyId = c.req.param("keyId");
  const domain = getDomain(c);
  const db = createDB(getEnv(c));
  await db.deleteKeyPackage(user, keyId);
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
  await deliverToFollowers(getEnv(c), user, removeActivity, domain);
  await deliverToFollowers(getEnv(c), user, deleteActivity, domain);
  return c.json({ result: "removed" });
});

app.get("/users/:user/encryptedKeyPair", async (c) => {
  const user = c.req.param("user");
  const db = createDB(getEnv(c));
  const doc = await db.findEncryptedKeyPair(user) as EncryptedKeyPairDoc | null;
  if (!doc) return c.json({ content: null });
  return c.json({ content: doc.content });
});

app.post("/users/:user/encryptedKeyPair", authRequired, async (c) => {
  const user = c.req.param("user");
  const { content } = await c.req.json();
  if (typeof content !== "string") {
    return c.json({ error: "invalid body" }, 400);
  }
  const db = createDB(getEnv(c));
  await db.upsertEncryptedKeyPair(user, content);
  return c.json({ result: "ok" });
});

app.delete("/users/:user/encryptedKeyPair", authRequired, async (c) => {
  const user = c.req.param("user");
  const db = createDB(getEnv(c));
  await db.deleteEncryptedKeyPair(user);
  return c.json({ result: "removed" });
});

app.post("/users/:user/resetKeys", authRequired, async (c) => {
  const user = c.req.param("user");
  const domain = getDomain(c);
  const actorId = `https://${domain}/users/${user}`;
  const db = createDB(getEnv(c));
  const keyPkgs = await db.listKeyPackages(user) as KeyPackageDoc[];
  for (const pkg of keyPkgs) {
    const removeActivity = createRemoveActivity(
      domain,
      actorId,
      `https://${domain}/users/${user}/keyPackage/${pkg._id}`,
    );
    const deleteActivity = createDeleteActivity(
      domain,
      actorId,
      `https://${domain}/users/${user}/keyPackage/${pkg._id}`,
    );
    await deliverToFollowers(getEnv(c), user, removeActivity, domain);
    await deliverToFollowers(getEnv(c), user, deleteActivity, domain);
  }
  await db.deleteKeyPackagesByUser(user);
  await db.deleteEncryptedKeyPair(user);
  return c.json({ result: "reset" });
});

app.post(
  "/users/:user/messages",
  authRequired,
  rateLimit({ windowMs: 60_000, limit: 20 }),
  async (c) => {
    const acct = c.req.param("user");
    const [sender, senderDomain] = acct.split("@");
    if (!sender || !senderDomain) {
      return c.json({ error: "invalid user format" }, 400);
    }
    const { to, content, mediaType, encoding } = await c.req.json();
    if (!Array.isArray(to) || typeof content !== "string") {
      return c.json({ error: "invalid body" }, 400);
    }
    const env = getEnv(c);
    const db = createDB(env);
    const msg = await db.createEncryptedMessage({
      from: acct,
      to,
      content,
      mediaType,
      encoding,
    }) as EncryptedMessageDoc;
    const domain = getDomain(c);
    const actorId = `https://${domain}/users/${sender}`;
    const object = await db.saveMessage(
      domain,
      sender,
      content,
      { mediaType: msg.mediaType, encoding: msg.encoding },
      { to, cc: [] },
    );

    const saved = object as { toObject(): Record<string, unknown> };

    const privateMessage = buildActivityFromStored(
      {
        ...saved.toObject(),
        type: "PrivateMessage",
      } as {
        _id: unknown;
        type: string;
        content: string;
        published: unknown;
        extra: Record<string, unknown>;
      },
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
    deliverActivityPubObject(to, activity, sender, domain, getEnv(c)).catch(
      (err) => {
        console.error("deliver failed", err);
      },
    );

    return c.json({ result: "sent", id: String(msg._id) });
  },
);

app.post(
  "/users/:user/publicMessages",
  authRequired,
  rateLimit({ windowMs: 60_000, limit: 20 }),
  async (c) => {
    const acct = c.req.param("user");
    const [sender, senderDomain] = acct.split("@");
    if (!sender || !senderDomain) {
      return c.json({ error: "invalid user format" }, 400);
    }
    const { to, content, mediaType, encoding } = await c.req.json();
    if (!Array.isArray(to) || typeof content !== "string") {
      return c.json({ error: "invalid body" }, 400);
    }
    const env = getEnv(c);
    const db = createDB(env);
    const msg = await db.createPublicMessage({
      from: acct,
      to,
      content,
      mediaType,
      encoding,
    }) as EncryptedMessageDoc;
    const domain = getDomain(c);
    const actorId = `https://${domain}/users/${sender}`;
    const object = await db.saveMessage(
      domain,
      sender,
      content,
      { mediaType: msg.mediaType, encoding: msg.encoding },
      { to, cc: [] },
    );

    const savedPub = object as { toObject(): Record<string, unknown> };

    const publicMessage = buildActivityFromStored(
      {
        ...savedPub.toObject(),
        type: "PublicMessage",
      } as {
        _id: unknown;
        type: string;
        content: string;
        published: unknown;
        extra: Record<string, unknown>;
      },
      domain,
      sender,
      false,
    );
    (publicMessage as ActivityPubActivity)["@context"] = [
      "https://www.w3.org/ns/activitystreams",
      "https://purl.archive.org/socialweb/mls",
    ];

    const activity = createCreateActivity(domain, actorId, publicMessage);
    (activity as ActivityPubActivity)["@context"] = [
      "https://www.w3.org/ns/activitystreams",
      "https://purl.archive.org/socialweb/mls",
    ];
    (activity as ActivityPubActivity).to = to;
    (activity as ActivityPubActivity).cc = [];
    deliverActivityPubObject(to, activity, sender, domain, getEnv(c)).catch(
      (err) => {
        console.error("deliver failed", err);
      },
    );

    return c.json({ result: "sent", id: String(msg._id) });
  },
);

app.get("/users/:user/messages", authRequired, async (c) => {
  const acct = c.req.param("user");
  const [user, userDomain] = acct.split("@");
  if (!user || !userDomain) {
    return c.json({ error: "invalid user format" }, 400);
  }

  const actor = await resolveActorCached(
    acct,
    getEnv(c),
  );
  const actorId = actor?.id ?? `https://${userDomain}/users/${user}`;
  const partnerAcct = c.req.query("with");
  const [partnerUser, partnerDomain] = partnerAcct?.split("@") ?? [];
  const partnerActorObj = partnerAcct
    ? await resolveActorCached(
      partnerAcct,
      getEnv(c),
    )
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

  const limit = Math.min(
    parseInt(c.req.query("limit") ?? "50", 10) || 50,
    100,
  );
  const before = c.req.query("before");
  const after = c.req.query("after");
  const db = createDB(getEnv(c));
  const list = await db.findEncryptedMessages(condition, {
    before: before ?? undefined,
    after: after ?? undefined,
    limit,
  }) as EncryptedMessageDoc[];
  list.reverse();
  const messages = list.map((doc) => ({
    id: String(doc._id),
    from: doc.from,
    to: doc.to,
    content: doc.content,
    mediaType: doc.mediaType,
    encoding: doc.encoding,
    createdAt: doc.createdAt,
  }));
  return c.json(messages);
});

app.get("/users/:user/publicMessages", authRequired, async (c) => {
  const acct = c.req.param("user");
  const [user, userDomain] = acct.split("@");
  if (!user || !userDomain) {
    return c.json({ error: "invalid user format" }, 400);
  }

  const actor = await resolveActorCached(
    acct,
    getEnv(c),
  );
  const actorId = actor?.id ?? `https://${userDomain}/users/${user}`;
  const partnerAcct = c.req.query("with");
  const [partnerUser, partnerDomain] = partnerAcct?.split("@") ?? [];
  const partnerActorObj = partnerAcct
    ? await resolveActorCached(
      partnerAcct,
      getEnv(c),
    )
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

  const limit = Math.min(
    parseInt(c.req.query("limit") ?? "50", 10) || 50,
    100,
  );
  const before = c.req.query("before");
  const after = c.req.query("after");
  const db = createDB(getEnv(c));
  const list = await db.findPublicMessages(condition, {
    before: before ?? undefined,
    after: after ?? undefined,
    limit,
  }) as EncryptedMessageDoc[];
  list.reverse();
  const messages = list.map((doc) => ({
    id: String(doc._id),
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
