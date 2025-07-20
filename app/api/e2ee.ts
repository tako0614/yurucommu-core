import { Hono } from "hono";
import {
  createKeyPackage,
  deleteKeyPackage,
  deleteKeyPackagesByUser,
  findKeyPackage,
  listKeyPackages,
} from "./repositories/key_package.ts";
import {
  deleteEncryptedKeyPair,
  findEncryptedKeyPair,
  upsertEncryptedKeyPair,
} from "./repositories/encrypted_keypair.ts";
import {
  createEncryptedMessage,
  findEncryptedMessages,
} from "./repositories/encrypted_message.ts";
import {
  createPublicMessage,
  findPublicMessages,
} from "./repositories/public_message.ts";
import { createDB } from "./db.ts";
import authRequired from "./utils/auth.ts";
import { getEnv } from "../../shared/config.ts";
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
import {
  findRemoteActorByUrl,
  upsertRemoteActor,
} from "./repositories/remote_actor.ts";

async function resolveActorCached(
  acct: string,
  env: Record<string, string>,
) {
  const [name, host] = acct.split("@");
  if (!name || !host) return null;

  const cached = await findRemoteActorByUrl(
    acct.startsWith("http") ? acct : "",
  );

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
      await upsertRemoteActor({
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
    const list = await listKeyPackages(getEnv(c), username);
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
  const doc = await findKeyPackage(getEnv(c), user, keyId);
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
  const pkg = await createKeyPackage(
    getEnv(c),
    user,
    content,
    mediaType,
    encoding,
  );
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
  await deleteKeyPackage(getEnv(c), user, keyId);
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
  const doc = await findEncryptedKeyPair(user);
  if (!doc) return c.json({ content: null });
  return c.json({ content: doc.content });
});

app.post("/users/:user/encryptedKeyPair", authRequired, async (c) => {
  const user = c.req.param("user");
  const { content } = await c.req.json();
  if (typeof content !== "string") {
    return c.json({ error: "invalid body" }, 400);
  }
  await upsertEncryptedKeyPair(user, content);
  return c.json({ result: "ok" });
});

app.delete("/users/:user/encryptedKeyPair", authRequired, async (c) => {
  const user = c.req.param("user");
  await deleteEncryptedKeyPair(user);
  return c.json({ result: "removed" });
});

app.post("/users/:user/resetKeys", authRequired, async (c) => {
  const user = c.req.param("user");
  const domain = getDomain(c);
  const actorId = `https://${domain}/users/${user}`;
  const keyPkgs = await listKeyPackages(getEnv(c), user);
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
  await deleteKeyPackagesByUser(getEnv(c), user);
  await deleteEncryptedKeyPair(user);
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
    const msg = await createEncryptedMessage({
      from: acct,
      to,
      content,
      mediaType,
      encoding,
    });
    const domain = getDomain(c);
    const env = getEnv(c);
    const db = createDB(env);
    const actorId = `https://${domain}/users/${sender}`;
    const object = await db.saveMessage(
      domain,
      sender,
      content,
      { mediaType: msg.mediaType, encoding: msg.encoding },
      { to, cc: [] },
    );

    const privateMessage = buildActivityFromStored(
      {
        ...object.toObject(),
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

    return c.json({ result: "sent", id: msg._id.toString() });
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
    const msg = await createPublicMessage(getEnv(c), {
      from: acct,
      to,
      content,
      mediaType,
      encoding,
    });
    const domain = getDomain(c);
    const env = getEnv(c);
    const db = createDB(env);
    const actorId = `https://${domain}/users/${sender}`;
    const object = await db.saveMessage(
      domain,
      sender,
      content,
      { mediaType: msg.mediaType, encoding: msg.encoding },
      { to, cc: [] },
    );

    const publicMessage = buildActivityFromStored(
      {
        ...object.toObject(),
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

    return c.json({ result: "sent", id: msg._id.toString() });
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
  const list = await findEncryptedMessages(condition, {
    before: before ?? undefined,
    after: after ?? undefined,
    limit,
  });
  list.reverse();
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
  const list = await findPublicMessages(getEnv(c), condition, {
    before: before ?? undefined,
    after: after ?? undefined,
    limit,
  });
  list.reverse();
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
