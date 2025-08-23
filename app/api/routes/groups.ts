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
import { sendActivityPubObject } from "../utils/activitypub.ts";
import { parseActivityRequest } from "../utils/inbox.ts";
import { getEnv } from "../../shared/config.ts";

const app = new Hono();

type ActivityPubObject = unknown; // minimal placeholder for mixed fields

interface GroupDoc {
  groupName: string;
  displayName?: string;
  summary?: string;
  icon?: ActivityPubObject | null;
  image?: ActivityPubObject | null;
  followers: string[];
  outbox: ActivityPubObject[];
  save: () => Promise<void>;
}

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
  const group = await Group.findOne({ groupName: name }).lean() as GroupDoc | null;
  if (!group) return c.json({ error: "Not Found" }, 404);
  const domain = getDomain(c);
  const actor: Record<string, unknown> = {
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
  return c.json(actor, 200, { "content-type": "application/activity+json" });
});

app.get("/groups/:name/followers", async (c) => {
  const name = c.req.param("name");
  const group = await Group.findOne({ groupName: name }).lean() as GroupDoc | null;
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
    { "content-type": "application/activity+json" },
  );
});

app.get("/groups/:name/outbox", async (c) => {
  const name = c.req.param("name");
  const group = await Group.findOne({ groupName: name }).lean() as GroupDoc | null;
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
    { "content-type": "application/activity+json" },
  );
});

app.post("/groups/:name/inbox", async (c) => {
  const name = c.req.param("name");
  const group = await Group.findOne({ groupName: name }) as GroupDoc | null;
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
    // docs/chat.md の要件に沿って以下を行う：
    // - Public 宛の混入を拒否
    // - 宛先に当該グループが含まれているか検証（Activity または Object）
    // - Announce は object を埋め込み（by value）で持ち、to/cc/Public は付与しない
    // - 実配送は fan-out で各メンバーの個別 inbox へ送る（bto相当は配送前に剥離）

    const groupId = `https://${domain}/groups/${name}`;
    const getSet = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    const activityRecipients = [
      ...getSet((activity as Record<string, unknown>).to),
      ...getSet((activity as Record<string, unknown>).cc),
      ...getSet((activity as Record<string, unknown>).bto),
      ...getSet((activity as Record<string, unknown>).bcc),
      ...(typeof (activity as Record<string, unknown>).audience === "string"
        ? [String((activity as Record<string, unknown>).audience)]
        : []),
    ];
    const obj = activity.object as Record<string, unknown>;
    const objectRecipients = [
      ...getSet(obj.to),
      ...getSet(obj.cc),
      ...getSet(obj.bto),
      ...getSet(obj.bcc),
      ...(typeof obj.audience === "string" ? [String(obj.audience)] : []),
    ];
    const allRecipients = new Set<string>([...activityRecipients, ...objectRecipients]);
    // Public 禁止
    if (allRecipients.has("https://www.w3.org/ns/activitystreams#Public")) {
      return c.json({ error: "Public 宛は許可されていません" }, 400);
    }
    // グループ宛であること（Activity or Object 側の何れか）
    const isToGroup = allRecipients.has(groupId);
    if (!isToGroup) {
      return c.json({ error: "宛先に当該グループが含まれていません" }, 400);
    }
    // 保存用（公開用）Outbox には宛先情報を含めない Announce を格納
    const announceBase = {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `https://${domain}/activities/${crypto.randomUUID()}`,
      type: "Announce" as const,
      actor: groupId,
      object: activity.object,
    };
    group.outbox.push(announceBase);
    await group.save();

    // fan-out: bto 相当は配送前に剥離し、各メンバーに個別配送
    // 受信側の相互運用のため sharedInbox があればそれを利用（utils 側が解決）
    await Promise.all(
      group.followers.map((recipient: string) =>
        sendActivityPubObject(recipient, announceBase, "system", domain, env).catch(
          (err) => console.error("deliver failed", recipient, err),
        )
      ),
    );
    return c.json({ ok: true });
  }

  // Undo(Follow) の取り扱い: フォロワーからの解除
  if (
    activity.type === "Undo" &&
    activity.object && typeof activity.object === "object" &&
    (activity.object as { type?: string }).type === "Follow" &&
    (activity.object as { object?: string }).object === `https://${domain}/groups/${name}` &&
    typeof activity.actor === "string"
  ) {
    const idx = group.followers.indexOf(activity.actor);
    if (idx >= 0) {
      group.followers.splice(idx, 1);
      await group.save();
    }
    return c.json({ ok: true });
  }

  return c.json({ error: "Unsupported" }, 400);
});

export default app;
