import { Hono } from "hono";
import Group from "./models/group.ts";
import ActivityPubObject from "./models/activitypub_object.ts";
import {
  createAcceptActivity,
  createAnnounceActivity,
  createGroupActor,
  deliverActivityPubObject,
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
    attributedTo: `https://${domain}/groups/${name}`,
    content: obj.content,
    published: obj.published instanceof Date
      ? obj.published.toISOString()
      : obj.published,
    ...obj.extra,
  };
}

const app = new Hono();

app.get("/groups/:name", async (c) => {
  const name = c.req.param("name");
  const group = await Group.findOne({ name }).lean();
  if (!group) return jsonResponse(c, { error: "Not found" }, 404);
  const domain = getDomain(c);
  const actor = createGroupActor(domain, {
    name: group.name,
    description: group.description,
  });
  return jsonResponse(c, actor, 200, "application/activity+json");
});

app.post("/groups/:name/inbox", async (c) => {
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
    if (group.isPrivate) {
      await Group.updateOne({ name }, {
        $addToSet: { pendingFollowers: actor },
      });
    } else {
      await Group.updateOne({ name }, { $addToSet: { followers: actor } });
      const accept = createAcceptActivity(
        domain,
        `https://${domain}/groups/${name}`,
        activity,
      );
      deliverActivityPubObject([actor], accept, "system").catch((err) => {
        console.error("Delivery failed:", err);
      });
    }
    return jsonResponse(c, { status: "ok" }, 200, "application/activity+json");
  }

  if (activity.type === "Create" && typeof activity.object === "object") {
    const actor = typeof activity.actor === "string" ? activity.actor : "";
    if (!group.followers.includes(actor)) {
      return jsonResponse(c, { error: "Forbidden" }, 403);
    }
    const obj = activity.object as Record<string, unknown>;
    const stored = await ActivityPubObject.create({
      type: (obj.type as string) ?? "Note",
      attributedTo: `!${name}`,
      content: (obj.content as string) ?? "",
      to: Array.isArray(obj.to) ? obj.to : [],
      cc: Array.isArray(obj.cc) ? obj.cc : [],
      published: obj.published && typeof obj.published === "string"
        ? new Date(obj.published)
        : new Date(),
      raw: obj,
      extra: {},
    });
    const announce = createAnnounceActivity(
      domain,
      `https://${domain}/groups/${name}`,
      `https://${domain}/objects/${stored._id}`,
    );
    deliverActivityPubObject(group.followers, announce, "system").catch(
      (err) => {
        console.error("Delivery failed:", err);
      },
    );
    return jsonResponse(c, { status: "ok" }, 200, "application/activity+json");
  }

  return jsonResponse(c, { status: "ok" }, 200, "application/activity+json");
});

app.get("/groups/:name/outbox", async (c) => {
  const name = c.req.param("name");
  const domain = getDomain(c);
  const objects = await ActivityPubObject.find({ attributedTo: `!${name}` })
    .sort({
      published: -1,
    }).lean();
  const outbox = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `https://${domain}/groups/${name}/outbox`,
    type: "OrderedCollection",
    totalItems: objects.length,
    orderedItems: objects.map((n) =>
      buildGroupActivity(
        { ...n, content: n.content ?? "" },
        domain,
        name,
      )
    ),
  };
  return jsonResponse(c, outbox, 200, "application/activity+json");
});

app.get("/groups/:name/followers", async (c) => {
  const name = c.req.param("name");
  const group = await Group.findOne({ name }).lean();
  if (!group) return jsonResponse(c, { error: "Not found" }, 404);
  const domain = getDomain(c);
  const list = group.followers ?? [];
  const baseId = `https://${domain}/groups/${name}/followers`;
  return jsonResponse(
    c,
    {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: baseId,
      type: "OrderedCollection",
      totalItems: list.length,
      orderedItems: list,
    },
    200,
    "application/activity+json",
  );
});

export default app;
