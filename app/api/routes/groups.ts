import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import authRequired from "../utils/auth.ts";
import Group from "../models/takos/group.ts";
import {
  createAcceptActivity,
  deliverActivityPubObject,
  getDomain,
} from "../utils/activitypub.ts";
import { parseActivityRequest } from "../utils/inbox.ts";
import { getEnv } from "../../shared/config.ts";

const app = new Hono();

app.use("/api/groups/*", authRequired);

app.post(
  "/api/groups",
  zValidator(
    "json",
    z.object({
      groupName: z.string().min(1),
      displayName: z.string().min(1),
      summary: z.string().optional(),
    }),
  ),
  async (c) => {
    const { groupName, displayName, summary } = c.req.valid("json") as {
      groupName: string;
      displayName: string;
      summary?: string;
    };
    const exists = await Group.findOne({ groupName }).lean();
    if (exists) return c.json({ error: "既に存在します" }, 400);
    const group = new Group({ groupName, displayName, summary });
    await group.save();
    const domain = getDomain(c);
    return c.json({ id: `https://${domain}/groups/${groupName}` }, 201);
  },
);

app.patch(
  "/api/groups/:name",
  zValidator(
    "json",
    z.object({
      displayName: z.string().optional(),
      summary: z.string().optional(),
      icon: z.any().optional(),
      image: z.any().optional(),
    }),
  ),
  async (c) => {
    const name = c.req.param("name");
    const update = c.req.valid("json") as Record<string, unknown>;
    const group = await Group.findOneAndUpdate({ groupName: name }, update, {
      new: true,
    });
    if (!group) return c.json({ error: "見つかりません" }, 404);
    return c.json({ ok: true });
  },
);

app.get("/groups/:name", async (c) => {
  const name = c.req.param("name");
  const group = await Group.findOne({ groupName: name }).lean();
  if (!group) return c.json({ error: "Not Found" }, 404);
  const domain = getDomain(c);
  const actor = {
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Group",
    id: `https://${domain}/groups/${name}`,
    name: group.displayName,
    preferredUsername: name,
    summary: group.summary,
    inbox: `https://${domain}/groups/${name}/inbox`,
    outbox: `https://${domain}/groups/${name}/outbox`,
    followers: `https://${domain}/groups/${name}/followers`,
  };
  if (group.icon) actor.icon = group.icon;
  if (group.image) actor.image = group.image;
  return c.json(actor, 200, "application/activity+json");
});

app.get("/groups/:name/followers", async (c) => {
  const name = c.req.param("name");
  const group = await Group.findOne({ groupName: name }).lean();
  if (!group) return c.json({ error: "Not Found" }, 404);
  const domain = getDomain(c);
  return c.json(
    {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `https://${domain}/groups/${name}/followers`,
      type: "OrderedCollection",
      totalItems: group.followers.length,
      orderedItems: group.followers,
    },
    200,
    "application/activity+json",
  );
});

app.get("/groups/:name/outbox", async (c) => {
  const name = c.req.param("name");
  const group = await Group.findOne({ groupName: name }).lean();
  if (!group) return c.json({ error: "Not Found" }, 404);
  const domain = getDomain(c);
  return c.json(
    {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `https://${domain}/groups/${name}/outbox`,
      type: "OrderedCollection",
      totalItems: group.outbox.length,
      orderedItems: group.outbox,
    },
    200,
    "application/activity+json",
  );
});

app.post("/groups/:name/inbox", async (c) => {
  const name = c.req.param("name");
  const group = await Group.findOne({ groupName: name });
  if (!group) return c.json({ error: "Not Found" }, 404);
  const domain = getDomain(c);
  const env = getEnv(c);
  const parsed = await parseActivityRequest(c);
  if (!parsed) return c.json({ error: "署名エラー" }, 401);
  const { activity } = parsed;

  if (activity.type === "Follow" && typeof activity.actor === "string") {
    if (!group.followers.includes(activity.actor)) {
      group.followers.push(activity.actor);
      await group.save();
    }
    const accept = createAcceptActivity(
      domain,
      `https://${domain}/groups/${name}`,
      activity,
    );
    await deliverActivityPubObject(
      [activity.actor],
      accept,
      "system",
      domain,
      env,
    );
    return c.json({ ok: true });
  }

  if (activity.type === "Create" && activity.object) {
    const actor = typeof activity.actor === "string" ? activity.actor : "";
    if (actor && !group.followers.includes(actor)) {
      return c.json({ error: "フォロワーではありません" }, 403);
    }
    const announce = {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `https://${domain}/activities/${crypto.randomUUID()}`,
      type: "Announce",
      actor: `https://${domain}/groups/${name}`,
      object: activity.object,
      to: [`https://${domain}/groups/${name}/followers`],
    };
    group.outbox.push(announce);
    await group.save();
    await deliverActivityPubObject(
      group.followers,
      announce,
      "system",
      domain,
      env,
    );
    return c.json({ ok: true });
  }

  return c.json({ error: "Unsupported" }, 400);
});

export default app;
