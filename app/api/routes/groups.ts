import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import authRequired from "../utils/auth.ts";
import Invite from "../models/takos/invite.ts";
import Approval from "../models/takos/approval.ts";
import {
  createAcceptActivity,
  deliverActivityPubObject,
  getDomain,
  resolveActorFromAcct,
  sendActivityPubObject,
} from "../utils/activitypub.ts";
import { parseActivityRequest } from "../utils/inbox.ts";
import { getEnv } from "../../shared/config.ts";
import { createDB } from "../DB/mod.ts";
import type { GroupDoc } from "../../shared/types.ts";

const app = new Hono();

type ActivityPubObject = unknown; // minimal placeholder for mixed fields

function isOwnedGroup(
  group: GroupDoc & { tenant_id?: string },
  domain: string,
  name: string,
): boolean {
  const tenant = (group as { tenant_id?: string }).tenant_id;
  if (tenant && tenant !== domain) return false;
  const id = `https://${domain}/groups/${group.groupName}`;
  return id === `https://${domain}/groups/${name}`;
}

app.use("/api/groups/*", authRequired);

app.get("/api/groups", async (c) => {
  const member = c.req.query("member");
  if (!member) return c.json({ error: "member is required" }, 400);
  const env = getEnv(c);
  const db = createDB(env);
  const groups = await db.listGroups(member) as GroupDoc[];
  const domain = getDomain(c);
  const formatted = groups.map((g) => {
    const icon = typeof g.icon === "string"
      ? g.icon
      : g.icon && typeof (g.icon as { url?: string }).url === "string"
      ? (g.icon as { url: string }).url
      : undefined;
    return {
      id: `https://${domain}/groups/${g.groupName}`,
      name: g.groupName,
      icon,
    };
  });
  return c.json(formatted);
});

app.get("/api/groups/:name/messages", async (c) => {
  const name = c.req.param("name");
  const env = getEnv(c);
  const db = createDB(env);
  const domain = getDomain(c);
  const groupId = `https://${domain}/groups/${name}`;
  const limit = Number(c.req.query("limit") ?? "0");
  const before = c.req.query("before");
  const after = c.req.query("after");
  let msgs = await db.findMessages({ "aud.to": groupId }) as {
    _id?: string;
    actor_id?: string;
    attributedTo?: string;
    content?: string;
    extra?: Record<string, unknown>;
    url?: string;
    mediaType?: string;
    published?: Date;
  }[];
  if (before) {
    const b = new Date(before);
    msgs = msgs.filter((m) =>
      new Date(String(m.published)).getTime() < b.getTime()
    );
  }
  if (after) {
    const a = new Date(after);
    msgs = msgs.filter((m) =>
      new Date(String(m.published)).getTime() > a.getTime()
    );
  }
  msgs.sort((a, b) => {
    return new Date(String(a.published)).getTime() -
      new Date(String(b.published)).getTime();
  });
  if (limit > 0 && msgs.length > limit) {
    msgs = msgs.slice(msgs.length - limit);
  }
  const formatted = msgs.map((m) => ({
    id: m._id ?? "",
    from: m.actor_id ?? m.attributedTo ?? "",
    to: groupId,
    type: typeof m.extra?.type === "string" ? m.extra.type as string : "note",
    content: typeof m.content === "string" ? m.content : "",
    attachments: Array.isArray(m.extra?.attachments)
      ? m.extra.attachments as Record<string, unknown>[]
      : undefined,
    url: typeof m.url === "string" ? m.url : undefined,
    mediaType: typeof m.mediaType === "string" ? m.mediaType : undefined,
    key: typeof m.extra?.key === "string" ? m.extra.key as string : undefined,
    iv: typeof m.extra?.iv === "string" ? m.extra.iv as string : undefined,
    preview: (m.extra?.preview && typeof m.extra.preview === "object")
      ? m.extra.preview as Record<string, unknown>
      : undefined,
    createdAt: m.published ?? new Date(),
  }));
  return c.json(formatted);
});

app.post(
  "/api/groups",
  zValidator(
    "json",
    z.object({
      // allow missing/empty and fill defaults server-side to avoid Zod too_small errors
      groupName: z.string().optional(),
      displayName: z.string().optional(),
      summary: z.string().optional(),
      membershipPolicy: z.string().optional(),
      visibility: z.string().optional(),
      allowInvites: z.boolean().optional(),
      member: z.string(),
      invites: z.array(
        z.string().regex(/^[^@\s]+@[^@\s]+$/),
      ).optional(),
    }),
  ),
  async (c) => {
    const body = c.req.valid("json") as Record<string, unknown>;
    const env = getEnv(c);
    const db = createDB(env);
    // sanitize inputs and provide sensible defaults when missing/empty
    const rawGroupName = typeof body.groupName === "string"
      ? body.groupName.trim()
      : "";
    let groupName = rawGroupName;
    const provided = rawGroupName.length > 0;

    if (!provided) {
      // generate a fallback unique-ish groupName when not provided
      let attempts = 0;
      let exists = null as unknown;
      do {
        groupName = `group-${crypto.randomUUID().slice(0, 8)}`;
        // check existence
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore: lean() return typing
        exists = await db.findGroupByName(groupName);
        attempts++;
      } while (exists && attempts < 5);
      if (exists) {
        return c.json({ error: "groupName collision, try again" }, 500);
      }
    } else {
      // user provided a name — if it exists, fail with 400 to avoid silently changing it
      const exists = await db.findGroupByName(groupName);
      if (exists) return c.json({ error: "既に存在します" }, 400);
    }

    let displayName = typeof body.displayName === "string"
      ? body.displayName.trim()
      : "";
    if (!displayName) {
      // fallback to groupName if displayName not provided
      displayName = groupName;
    }

    const summary = typeof body.summary === "string" ? body.summary : undefined;
    const membershipPolicy = typeof body.membershipPolicy === "string"
      ? body.membershipPolicy
      : undefined;
    const visibility = typeof body.visibility === "string"
      ? body.visibility
      : undefined;
    const allowInvites = typeof body.allowInvites === "boolean"
      ? body.allowInvites
      : undefined;
    const member = typeof body.member === "string" ? body.member : "";
    if (!member) return c.json({ error: "member is required" }, 400);
    await db.createGroup({
      groupName,
      displayName,
      summary,
      membershipPolicy,
      visibility,
      allowInvites,
      followers: [member],
    });
    const domain = getDomain(c);
    const groupId = `https://${domain}/groups/${groupName}`;
    // 追加: 初期招待（invites があれば送信）
    const rawInv = Array.isArray((body as { invites?: unknown }).invites)
      ? (body as { invites: string[] }).invites
      : [];
    const failed: string[] = [];
    if (rawInv.length > 0) {
      const creator = member;
      const candidates = [
        ...new Set(rawInv.filter((x) => x && x.includes("@"))),
      ];
      for (const cand of candidates) {
        if (cand.toLowerCase() === creator.toLowerCase()) continue; // 自分自身は招待しない
        let actor: { id?: string } | null = null;
        try {
          actor = await resolveActorFromAcct(cand);
        } catch (err) {
          console.error("招待先アカウントの解決に失敗しました", err);
          failed.push(cand);
          continue;
        }
        if (!actor?.id) {
          failed.push(cand);
          continue;
        }
        const target = actor.id;
        const activity = {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: `https://${domain}/activities/${crypto.randomUUID()}`,
          type: "Invite" as const,
          actor: groupId,
          object: target,
          target: groupId,
          to: [target],
        };
        try {
          await deliverActivityPubObject(
            [target],
            activity,
            "system",
            domain,
            env,
          );
        } catch (err) {
          console.error("招待の配信に失敗しました", err);
          failed.push(cand);
          continue;
        }
        const inv = new Invite({
          groupName,
          actor: cand,
          inviter: groupId,
        });
        try {
          await inv.save();
        } catch (err) {
          console.error("招待の保存に失敗しました", err);
          failed.push(cand);
        }
      }
    }
    if (failed.length > 0) {
      return c.json({
        id: groupId,
        error: "一部または全ての招待に失敗しました",
        failedInvites: failed,
      }, 500);
    }
    return c.json({ id: groupId }, 201);
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
      membershipPolicy: z.string().optional(),
      visibility: z.string().optional(),
      allowInvites: z.boolean().optional(),
    }),
  ),
  async (c) => {
    const name = c.req.param("name");
    const update = c.req.valid("json") as Record<string, unknown>;
    const env = getEnv(c);
    const db = createDB(env);
    const group = await db.updateGroupByName(name, update);
    if (!group) return c.json({ error: "見つかりません" }, 404);
    return c.json({ ok: true });
  },
);

app.patch(
  "/api/groups/:name/actor",
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
    const domain = getDomain(c);
    const env = getEnv(c);
    const db = createDB(env);
    const group = await db.findGroupByName(name) as
      | (GroupDoc & { tenant_id?: string })
      | null;
    if (!group) return c.json({ error: "見つかりません" }, 404);
    if (!isOwnedGroup(group, domain, name)) {
      return c.json({ error: "他ホストのグループです" }, 403);
    }
    const update = c.req.valid("json") as Record<string, unknown>;
    const updated = await db.updateGroupByName(name, update);
    if (!updated) return c.json({ error: "見つかりません" }, 404);
    const actor: Record<string, unknown> = {
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Group",
      id: `https://${domain}/groups/${name}`,
      name: updated.displayName,
      preferredUsername: name,
      summary: updated.summary,
    };
    if (updated.icon) actor.icon = updated.icon;
    if (updated.image) actor.image = updated.image;
    const activity = {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `https://${domain}/activities/${crypto.randomUUID()}`,
      type: "Update" as const,
      actor: actor.id,
      to: [`https://${domain}/groups/${name}/followers`],
      object: actor,
    };
    const targets = await Promise.all(
      updated.followers.map(async (f: string) => {
        if (f.startsWith("http")) return f;
        const actor = await resolveActorFromAcct(f).catch(() => null);
        return actor?.id ?? null;
      }),
    );
    await deliverActivityPubObject(
      targets.filter((t): t is string => typeof t === "string"),
      activity,
      "system",
      domain,
      env,
    );
    return c.json({ ok: true });
  },
);

app.post(
  "/api/groups/:name/invite",
  zValidator(
    "json",
    z.object({
      acct: z.string().regex(/^[^@\s]+@[^@\s]+$/),
    }),
  ),
  async (c) => {
    const name = c.req.param("name");
    const { acct } = c.req.valid("json") as { acct: string };
    const env = getEnv(c);
    const db = createDB(env);
    const group = await db.findGroupByName(name) as GroupDoc | null;
    if (!group) return c.json({ error: "見つかりません" }, 404);
    if (group.allowInvites === false) {
      return c.json({ error: "招待が禁止されています" }, 400);
    }
    const domain = getDomain(c);
    const groupId = `https://${domain}/groups/${name}`;
    const actor = await resolveActorFromAcct(acct).catch(() => null);
    if (!actor?.id) {
      return c.json({ error: "acct 解決に失敗しました" }, 400);
    }
    const target = actor.id;
    const activity = {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `https://${domain}/activities/${crypto.randomUUID()}`,
      type: "Invite" as const,
      actor: groupId,
      object: target,
      target: groupId,
      to: [target],
    };
    await deliverActivityPubObject([target], activity, "system", domain, env);
    const inv = new Invite({
      groupName: name,
      actor: acct,
      inviter: groupId,
    });
    await inv.save().catch(() => {});
    const [user, host] = acct.split("@");
    if (host === domain) {
      const acc = await db.findAccountByUserName(user);
      if (acc) {
        await db.createNotification(
          acc._id!,
          "グループ招待",
          `${group.displayName ?? name} に招待されました`,
          "group-invite",
        );
      }
    }
    return c.json({ ok: true });
  },
);

app.post(
  "/api/groups/:name/approvals",
  zValidator(
    "json",
    z.object({ actor: z.string().url(), accept: z.boolean() }),
  ),
  async (c) => {
    const name = c.req.param("name");
    const { actor, accept } = c.req.valid("json") as {
      actor: string;
      accept: boolean;
    };
    const domain = getDomain(c);
    const groupId = `https://${domain}/groups/${name}`;
    const env = getEnv(c);
    const db = createDB(env);
    const group = await db.findGroupByName(name) as
      | (GroupDoc & { tenant_id?: string })
      | null;
    if (!group) return c.json({ error: "見つかりません" }, 404);
    if (!isOwnedGroup(group, domain, name)) {
      return c.json({ error: "他ホストのグループです" }, 403);
    }
    const approval = await Approval.findOne({
      groupName: name,
      actor,
    });
    if (!approval) return c.json({ error: "見つかりません" }, 404);
    if (accept) {
      if (!group.followers.includes(actor)) {
        await db.addGroupFollower(name, actor);
      }
      const acc = createAcceptActivity(domain, groupId, approval.activity);
      await deliverActivityPubObject([actor], acc, "system", domain, env);
    } else {
      const reject = {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: `https://${domain}/activities/${crypto.randomUUID()}`,
        type: "Reject" as const,
        actor: groupId,
        object: approval.activity,
        to: [actor],
      };
      await deliverActivityPubObject(
        [actor],
        reject,
        "system",
        domain,
        env,
      );
    }
    await approval.deleteOne();
    return c.json({ ok: true });
  },
);

app.get("/groups/:name", async (c) => {
  const name = c.req.param("name");
  const env = getEnv(c);
  const db = createDB(env);
  const group = await db.findGroupByName(name) as GroupDoc | null;
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
  const env = getEnv(c);
  const db = createDB(env);
  const group = await db.findGroupByName(name) as GroupDoc | null;
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
  const env = getEnv(c);
  const db = createDB(env);
  const group = await db.findGroupByName(name) as GroupDoc | null;
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
  const env = getEnv(c);
  const db = createDB(env);
  const group = await db.findGroupByName(name) as GroupDoc | null;
  if (!group) return c.json({ error: "Not Found" }, 404);
  const domain = getDomain(c);
  const parsed = await parseActivityRequest(c);
  if (!parsed) return c.json({ error: "署名エラー" }, 401);
  const { activity } = parsed;
  const groupId = `https://${domain}/groups/${name}`;

  if (
    activity.type === "Invite" &&
    typeof (activity as { target?: unknown }).target === "string" &&
    (activity as { target: string }).target === groupId
  ) {
    const invited = typeof activity.object === "string" ? activity.object : "";
    const inviter = typeof activity.actor === "string" ? activity.actor : "";
    if (invited) {
      await Invite.findOneAndUpdate(
        { groupName: name, actor: invited },
        { inviter },
        { upsert: true },
      ).catch(() => {});
    }
    return c.json({ ok: true });
  }

  if (
    activity.type === "Join" &&
    typeof activity.actor === "string" &&
    typeof activity.object === "string" &&
    activity.object === groupId
  ) {
    if (group.membershipPolicy === "approval") {
      await Approval.findOneAndUpdate(
        { groupName: name, actor: activity.actor },
        { activity },
        { upsert: true },
      ).catch(() => {});
      return c.json({ ok: true });
    }
    if (!group.followers.includes(activity.actor)) {
      await db.addGroupFollower(name, activity.actor);
    }
    await Invite.findOneAndUpdate(
      { groupName: name, actor: activity.actor },
      { accepted: true },
    ).catch(() => {});
    const accept = createAcceptActivity(domain, groupId, activity);
    await deliverActivityPubObject(
      [activity.actor],
      accept,
      "system",
      domain,
      env,
    );
    return c.json({ ok: true });
  }

  if (activity.type === "Follow" && typeof activity.actor === "string") {
    if (group.membershipPolicy === "approval") {
      await Approval.findOneAndUpdate(
        { groupName: name, actor: activity.actor },
        { activity },
        { upsert: true },
      ).catch(() => {});
      return c.json({ ok: true });
    }
    if (!group.followers.includes(activity.actor)) {
      await db.addGroupFollower(name, activity.actor);
    }
    await Invite.findOneAndUpdate(
      { groupName: name, actor: activity.actor },
      { accepted: true },
    ).catch(() => {});
    const accept = createAcceptActivity(domain, groupId, activity);
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

    const getSet = (v: unknown): string[] =>
      Array.isArray(v)
        ? v.filter((x): x is string => typeof x === "string")
        : [];
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
    const allRecipients = new Set<string>([
      ...activityRecipients,
      ...objectRecipients,
    ]);
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
    await db.pushGroupOutbox(name, announceBase);

    // fan-out: bto 相当は配送前に剥離し、各メンバーに個別配送
    // 受信側の相互運用のため sharedInbox があればそれを利用（utils 側が解決）
    await Promise.all(
      group.followers.map((recipient: string) =>
        sendActivityPubObject(recipient, announceBase, "system", domain, env)
          .catch(
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
    (activity.object as { object?: string }).object ===
      `https://${domain}/groups/${name}` &&
    typeof activity.actor === "string"
  ) {
    const actor = activity.actor;
    const localPrefix = `https://${domain}/@`;
    if (
      isOwnedGroup(group, domain, name) &&
      actor.startsWith(localPrefix)
    ) {
      const localMembers = group.followers.filter((f) =>
        f.startsWith(localPrefix)
      );
      if (localMembers.length <= 1) {
        return c.json({ error: "最後のメンバーは退出できません" }, 400);
      }
    }
    await db.removeGroupFollower(name, actor);
    return c.json({ ok: true });
  }

  return c.json({ error: "Unsupported" }, 400);
});

export default app;
