import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import authRequired from "../utils/auth.ts";
import Invite from "../../takos/models/takos/invite.ts";
import Approval from "../../takos/models/takos/approval.ts";
import type { Document } from "mongoose";
import {
  createAcceptActivity,
  deliverActivityPubObject,
  ensurePem,
  getDomain,
  resolveActorFromAcct,
  sendActivityPubObject,
} from "../utils/activitypub.ts";
import { parseActivityRequest } from "../utils/inbox.ts";
import { getEnv } from "@takos/config";
import { getDB } from "../db/mod.ts";
import type { GroupDoc } from "@takos/types";
import { generateKeyPair } from "@takos/crypto";

const app = new Hono();

type ActivityPubObject = unknown; // minimal placeholder for mixed fields

function isOwnedGroup(
  group: GroupDoc,
  domain: string,
  name: string,
): boolean {
  const id = `https://${domain}/groups/${group.groupName}`;
  return id === `https://${domain}/groups/${name}`;
}

app.use("/api/groups/*", authRequired);

app.get("/api/groups", async (c) => {
  const member = c.req.query("member");
  if (!member) return c.json({ error: "member is required" }, 400);
  const username = member.split("@")[0];
  const db = getDB(c);
  const groups = await db.listGroups(username);
  return c.json(groups);
});

app.get("/api/groups/:name/messages", async (c) => {
  const name = c.req.param("name");
  const db = getDB(c);
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
      invitePolicy: z.string().optional(),
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
    const db = getDB(c);
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
    const invitePolicy = typeof body.invitePolicy === "string"
      ? body.invitePolicy
      : undefined;
    const visibility = typeof body.visibility === "string"
      ? body.visibility
      : undefined;
    const allowInvites = typeof body.allowInvites === "boolean"
      ? body.allowInvites
      : undefined;
    const member = typeof body.member === "string" ? body.member : "";
    if (!member) return c.json({ error: "member is required" }, 400);
    const keys = await generateKeyPair();
    await db.createGroup({
      groupName,
      displayName,
      summary,
      membershipPolicy,
      invitePolicy,
      visibility,
      allowInvites,
      privateKey: keys.privateKey,
      publicKey: keys.publicKey,
    });
    const domain = getDomain(c);
    const groupId = `https://${domain}/groups/${groupName}`;
    // 作成者をローカルのアクターIDに変換し、フォロワーとして登録
    const actorId = `https://${domain}/users/${member.split("@")[0]}`;
    await db.addGroupFollower(groupName, actorId);
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
            { actorId: groupId, privateKey: keys.privateKey },
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
          actor: target,
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
      invitePolicy: z.string().optional(),
      visibility: z.string().optional(),
      allowInvites: z.boolean().optional(),
    }),
  ),
  async (c) => {
    const name = c.req.param("name");
    const update = c.req.valid("json") as Record<string, unknown>;
    const db = getDB(c);
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
    const db = getDB(c);
    const group = await db.findGroupByName(name) as
      | GroupDoc
      | null;
    if (!group) return c.json({ error: "見つかりません" }, 404);
    if (!isOwnedGroup(group, domain, name)) {
      return c.json({ error: "他ホストのグループです" }, 403);
    }
    const update = c.req.valid("json") as Record<string, unknown>;
    const updated = await db.updateGroupByName(name, update);
    if (!updated) return c.json({ error: "見つかりません" }, 404);
    if (!updated.privateKey) {
      return c.json({ error: "内部エラー: privateKey がありません" }, 500);
    }
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
      { actorId: actor.id as string, privateKey: updated.privateKey },
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
      inviter: z.string().regex(/^[^@\s]+@[^@\s]+$/),
      ttl: z.number().int().positive(),
      uses: z.number().int().positive(),
    }),
  ),
  async (c) => {
    const name = c.req.param("name");
    const { acct, inviter, ttl, uses } = c.req.valid("json") as {
      acct: string;
      inviter: string;
      ttl: number;
      uses: number;
    };
    const env = getEnv(c);
    const db = getDB(c);
    const group = await db.findGroupByName(name) as GroupDoc | null;
    if (!group) return c.json({ error: "見つかりません" }, 404);
    const policy = group.invitePolicy ??
      (group.allowInvites ? "members" : "none");
    if (policy === "none") {
      return c.json({ error: "招待が禁止されています" }, 403);
    }
    if (!group.privateKey) {
      return c.json({ error: "内部エラー: privateKey がありません" }, 500);
    }
    const domain = getDomain(c);
    const groupId = `https://${domain}/groups/${name}`;
    const actor = await resolveActorFromAcct(acct).catch(() => null);
    if (!actor?.id) {
      return c.json({ error: "acct 解決に失敗しました" }, 400);
    }
    const inviterActor = await resolveActorFromAcct(inviter).catch(() => null);
    const inviterId = inviterActor?.id ?? "";
    if (!inviterId) {
      return c.json({ error: "inviter 解決に失敗しました" }, 400);
    }
    if (policy === "members" && !group.followers.includes(inviterId)) {
      return c.json({ error: "招待権限がありません" }, 403);
    }
    if (policy === "admins" && group.followers[0] !== inviterId) {
      return c.json({ error: "招待権限がありません" }, 403);
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
    await deliverActivityPubObject(
      [target],
      activity,
      { actorId: groupId, privateKey: group.privateKey },
      domain,
      env,
    );
    const expiresAt = new Date(Date.now() + ttl * 1000);
    const inv = new Invite({
      groupName: name,
      actor: target,
      inviter: inviterId,
      expiresAt,
      remainingUses: uses,
    });
    await inv.save().catch(() => {});
    const [user, host] = acct.split("@");
    if (host === domain) {
      const acc = await db.findAccountByUserName(user);
      if (acc) {
        await db.createNotification(
          acc._id!,
          "グループ招待",
          // store structured message so client can show action buttons
          JSON.stringify({
            kind: "group-invite",
            groupName: name,
            groupId: `https://${domain}/groups/${name}`,
            displayName: group.displayName ?? name,
            inviter: inviterId,
          }),
          "group-invite",
        );
      }
    }
    return c.json({ ok: true });
  },
);

app.post(
  "/api/groups/:name/join",
  zValidator(
    "json",
    z.object({ member: z.string() }),
  ),
  async (c) => {
    const name = c.req.param("name");
    const { member } = c.req.valid("json") as { member: string };
    const domain = getDomain(c);
    const env = getEnv(c);
    const [user, host] = member.split("@");
    if (!user || !host) {
      return c.json({ error: "member の形式が正しくありません" }, 400);
    }
    const db = getDB(c);
    const group = await db.findGroupByName(name) as GroupDoc | null;
    if (!group) return c.json({ error: "見つかりません" }, 404);
    if (host !== domain) {
      return c.json({ error: "リモートユーザーは未対応です" }, 400);
    }
    const actorId = `https://${domain}/users/${user}`;
    if (group.membershipPolicy === "inviteOnly") {
      const inv = await Invite.findOne({ groupName: name, actor: actorId });
      const now = new Date();
      if (
        !inv ||
        (inv.expiresAt && inv.expiresAt < now) ||
        (typeof inv.remainingUses === "number" && inv.remainingUses <= 0)
      ) {
        return c.json({ error: "招待が必要です" }, 400);
      }
    }
    const groupId = `https://${domain}/groups/${name}`;
    const join = {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `https://${domain}/activities/${crypto.randomUUID()}`,
      type: "Join" as const,
      actor: actorId,
      object: groupId,
      to: [groupId],
    };
    try {
      await sendActivityPubObject(
        `${groupId}/inbox`,
        join,
        user,
        domain,
        env,
      );
    } catch (_err) {
      return c.json({ error: "送信に失敗しました" }, 500);
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
    const db = getDB(c);
    const group = await db.findGroupByName(name) as
      | GroupDoc
      | null;
    if (!group) return c.json({ error: "見つかりません" }, 404);
    if (!isOwnedGroup(group, domain, name)) {
      return c.json({ error: "他ホストのグループです" }, 403);
    }
    if (!group.privateKey) {
      return c.json({ error: "内部エラー: privateKey がありません" }, 500);
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
      await deliverActivityPubObject(
        [actor],
        acc,
        { actorId: groupId, privateKey: group.privateKey },
        domain,
        env,
      );
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
        { actorId: groupId, privateKey: group.privateKey },
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
  const db = getDB(c);
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
    publicKey: {
      id: `https://${domain}/groups/${name}#main-key`,
      owner: `https://${domain}/groups/${name}`,
      publicKeyPem: ensurePem(group.publicKey, "PUBLIC KEY"),
    },
  };
  if (group.icon) actor.icon = group.icon;
  if (group.image) actor.image = group.image;
  return c.json(actor, 200, { "content-type": "application/activity+json" });
});

app.get("/groups/:name/followers", async (c) => {
  const name = c.req.param("name");
  const db = getDB(c);
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
  const db = getDB(c);
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
  const db = getDB(c);
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
    const policy = group.invitePolicy ??
      (group.allowInvites ? "members" : "none");
    let allowed = true;
    if (policy === "none") allowed = false;
    else if (policy === "members") {
      allowed = group.followers.includes(inviter);
    } else if (policy === "admins") {
      allowed = group.followers[0] === inviter;
    }
    if (!allowed) {
      if (group.privateKey) {
        const reject = {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: `https://${domain}/activities/${crypto.randomUUID()}`,
          type: "Reject" as const,
          actor: groupId,
          object: activity,
          to: [inviter],
        };
        await deliverActivityPubObject(
          [inviter],
          reject,
          { actorId: groupId, privateKey: group.privateKey },
          domain,
          env,
        ).catch(() => {});
      }
      return c.json({ error: "権限がありません" }, 403);
    }
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
    let inv: (Document & { expiresAt?: Date; remainingUses?: number }) | null =
      null;
    if (group.membershipPolicy === "inviteOnly") {
      inv = await Invite.findOne({
        groupName: name,
        actor: activity.actor,
      });
      const now = new Date();
      if (
        !inv ||
        (inv.expiresAt && inv.expiresAt < now) ||
        (typeof inv.remainingUses === "number" && inv.remainingUses <= 0)
      ) {
        if (group.privateKey) {
          const reject = {
            "@context": "https://www.w3.org/ns/activitystreams",
            id: `https://${domain}/activities/${crypto.randomUUID()}`,
            type: "Reject" as const,
            actor: groupId,
            object: activity,
            to: [activity.actor],
          };
          await deliverActivityPubObject(
            [activity.actor],
            reject,
            { actorId: groupId, privateKey: group.privateKey },
            domain,
            env,
          ).catch(() => {});
        }
        return c.json({ error: "招待が必要です" }, 403);
      }
    }
    if (!group.followers.includes(activity.actor)) {
      await db.addGroupFollower(name, activity.actor);
    }
    if (inv) {
      const uses = inv.remainingUses ?? 1;
      if (uses <= 1) {
        await inv.deleteOne();
      } else {
        inv.remainingUses = uses - 1;
        await inv.save().catch(() => {});
      }
    }
    const accept = createAcceptActivity(domain, groupId, activity);
    if (!group.privateKey) {
      return c.json({ error: "内部エラー: privateKey がありません" }, 500);
    }
    await deliverActivityPubObject(
      [activity.actor],
      accept,
      { actorId: groupId, privateKey: group.privateKey },
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
    let inv: (Document & { expiresAt?: Date; remainingUses?: number }) | null =
      null;
    if (group.membershipPolicy === "inviteOnly") {
      inv = await Invite.findOne({
        groupName: name,
        actor: activity.actor,
      });
      const now = new Date();
      if (
        !inv ||
        (inv.expiresAt && inv.expiresAt < now) ||
        (typeof inv.remainingUses === "number" && inv.remainingUses <= 0)
      ) {
        if (group.privateKey) {
          const reject = {
            "@context": "https://www.w3.org/ns/activitystreams",
            id: `https://${domain}/activities/${crypto.randomUUID()}`,
            type: "Reject" as const,
            actor: groupId,
            object: activity,
            to: [activity.actor],
          };
          await deliverActivityPubObject(
            [activity.actor],
            reject,
            { actorId: groupId, privateKey: group.privateKey },
            domain,
            env,
          ).catch(() => {});
        }
        return c.json({ error: "招待が必要です" }, 403);
      }
    }
    if (!group.followers.includes(activity.actor)) {
      await db.addGroupFollower(name, activity.actor);
    }
    if (inv) {
      const uses = inv.remainingUses ?? 1;
      if (uses <= 1) {
        await inv.deleteOne();
      } else {
        inv.remainingUses = uses - 1;
        await inv.save().catch(() => {});
      }
    }
    const accept = createAcceptActivity(domain, groupId, activity);
    if (!group.privateKey) {
      return c.json({ error: "内部エラー: privateKey がありません" }, 500);
    }
    await deliverActivityPubObject(
      [activity.actor],
      accept,
      { actorId: groupId, privateKey: group.privateKey },
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
    if (!group.privateKey) {
      return c.json({ error: "内部エラー: privateKey がありません" }, 500);
    }
    const gpKey: string = group.privateKey;
    await Promise.all(
      group.followers.map((recipient: string) =>
        sendActivityPubObject(
          recipient,
          announceBase,
          { actorId: groupId, privateKey: gpKey },
          domain,
          env,
        )
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
    const localPrefix = `https://${domain}/users/`;
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
