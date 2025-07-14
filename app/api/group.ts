import { Hono } from "hono";
import Group from "./models/group.ts";
import { findObjects, saveObject } from "./services/unified_store.ts";
import {
  createAcceptActivity,
  createAnnounceActivity,
  createGroupActor,
  deliverActivityPubObjectFromUrl,
  extractAttachments,
  getDomain,
  jsonResponse,
  verifyHttpSignature,
} from "./utils/activitypub.ts";

function buildGroupActivity(
  obj: {
    _id: unknown;
    type: string;
    content: string;
    published: unknown;
    extra: Record<string, unknown>;
  },
  domain: string,
  name: string,
) {
  return {
    id: `https://${domain}/objects/${obj._id}`,
    type: obj.type,
    attributedTo: `https://${domain}/communities/${name}`,
    content: obj.content,
    published: obj.published instanceof Date
      ? obj.published.toISOString()
      : obj.published,
    ...obj.extra,
  };
}

const app = new Hono();

app.get("/communities/:name", async (c) => {
  const name = c.req.param("name");
  const group = await Group.findOne({ name }).lean();
  if (!group) return jsonResponse(c, { error: "Not found" }, 404);
  const domain = getDomain(c);
  const actor = createGroupActor(domain, {
    name: group.name,
    description: group.description,
    avatar: group.avatar,
    publicKey: group.publicKey,
    sharedInbox: `https://${domain}/inbox`,
  });
  return jsonResponse(c, actor, 200, "application/activity+json");
});

app.post("/communities/:name/inbox", async (c) => {
  const name = c.req.param("name");
  const group = await Group.findOne({ name });
  if (!group) return jsonResponse(c, { error: "Not found" }, 404);
  const bodyText = await c.req.text();
  const verified = await verifyHttpSignature(c.req.raw, bodyText);
  if (!verified) return jsonResponse(c, { error: "Invalid signature" }, 401);
  const activity = JSON.parse(bodyText);
  const domain = getDomain(c);

  if (activity.type === "Follow" && typeof activity.actor === "string") {
    const actor = activity.actor;
    if (group.banned.includes(actor)) {
      return jsonResponse(c, { error: "Forbidden" }, 403);
    }
    if (group.isPrivate) {
      await Group.updateOne({ name }, {
        $addToSet: { pendingFollowers: actor },
      });
    } else {
      await Group.updateOne({ name }, { $addToSet: { followers: actor } });
      const accept = createAcceptActivity(
        domain,
        `https://${domain}/communities/${name}`,
        activity,
      );
      deliverActivityPubObjectFromUrl(
        [actor],
        accept,
        {
          id: `https://${domain}/communities/${name}`,
          privateKey: group.privateKey,
        },
      ).catch((err) => {
        console.error("Delivery failed:", err);
      });
    }
    return jsonResponse(c, { status: "ok" }, 200, "application/activity+json");
  }

  if (activity.type === "Create" && typeof activity.object === "object") {
    const actor = typeof activity.actor === "string" ? activity.actor : "";
    if (!group.followers.includes(actor) || group.banned.includes(actor)) {
      return jsonResponse(c, { error: "Forbidden" }, 403);
    }
    const obj = activity.object as Record<string, unknown>;
    const attachments = extractAttachments(obj);
    const extra: Record<string, unknown> = {};
    if (attachments.length > 0) extra.attachments = attachments;
    const stored = await saveObject(c.get("env") as Record<string, string>, {
      type: (obj.type as string) ?? "Note",
      attributedTo: `!${name}`,
      content: (obj.content as string) ?? "",
      to: Array.isArray(obj.to) ? obj.to : [],
      cc: Array.isArray(obj.cc) ? obj.cc : [],
      published: obj.published && typeof obj.published === "string"
        ? new Date(obj.published)
        : new Date(),
      raw: obj,
      extra,
      actor_id: `https://${domain}/communities/${name}`,
      aud: {
        to: Array.isArray(obj.to) ? obj.to : [],
        cc: Array.isArray(obj.cc) ? obj.cc : [],
      },
    });
    const announce = createAnnounceActivity(
      domain,
      `https://${domain}/communities/${name}`,
      `https://${domain}/objects/${stored._id}`,
    );
    deliverActivityPubObjectFromUrl(
      group.followers,
      announce,
      {
        id: `https://${domain}/communities/${name}`,
        privateKey: group.privateKey,
      },
    ).catch((err) => {
      console.error("Delivery failed:", err);
    });
    return jsonResponse(c, { status: "ok" }, 200, "application/activity+json");
  }

  return jsonResponse(c, { status: "ok" }, 200, "application/activity+json");
});

app.get("/communities/:name/outbox", async (c) => {
  const name = c.req.param("name");
  const domain = getDomain(c);
  const page = parseInt(c.req.query("page") || "0");
  const objects = await findObjects({ attributedTo: `!${name}` }, {
    published: -1,
  });
  const baseId = `https://${domain}/communities/${name}/outbox`;

  const PAGE_SIZE = 20;
  if (page) {
    const start = (page - 1) * PAGE_SIZE;
    const items = objects.slice(start, start + PAGE_SIZE);
    const next = start + PAGE_SIZE < objects.length
      ? `${baseId}?page=${page + 1}`
      : null;
    const prev = page > 1 ? `${baseId}?page=${page - 1}` : null;
    return jsonResponse(
      c,
      {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: `${baseId}?page=${page}`,
        type: "OrderedCollectionPage",
        partOf: baseId,
        orderedItems: items.map((n) =>
          buildGroupActivity({ ...n, content: n.content ?? "" }, domain, name)
        ),
        next,
        prev,
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
      totalItems: objects.length,
      first: `${baseId}?page=1`,
    },
    200,
    "application/activity+json",
  );
});

app.get("/communities/:name/followers", async (c) => {
  const name = c.req.param("name");
  const page = parseInt(c.req.query("page") || "0");
  const group = await Group.findOne({ name }).lean();
  if (!group) return jsonResponse(c, { error: "Not found" }, 404);
  const domain = getDomain(c);
  const list = group.followers ?? [];
  const baseId = `https://${domain}/communities/${name}/followers`;
  const PAGE_SIZE = 50;
  if (page) {
    const start = (page - 1) * PAGE_SIZE;
    const items = list.slice(start, start + PAGE_SIZE);
    const next = start + PAGE_SIZE < list.length
      ? `${baseId}?page=${page + 1}`
      : null;
    const prev = page > 1 ? `${baseId}?page=${page - 1}` : null;
    return jsonResponse(
      c,
      {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: `${baseId}?page=${page}`,
        type: "OrderedCollectionPage",
        partOf: baseId,
        orderedItems: items,
        next,
        prev,
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
