import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import authRequired from "../utils/auth.ts";
import {
  createAcceptActivity,
  deliverActivityPubObject,
  ensurePem,
  getDomain,
  resolveActorFromAcct,
  resolveRemoteActor,
  sendActivityPubObject,
  extractAttachments,
} from "../utils/activitypub.ts";
import { sendToUser } from "./ws.ts";
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

// 任意の Actor 指定を IRI に正規化する
// - 完全な URL: そのまま返す（/users/ でも /groups/ でも可）
// - acct 形式 name@host: WebFinger で解決を試み、失敗時は従来どおりグループ IRI にフォールバック
// - それ以外（ローカル名）: ローカルグループ IRI にフォールバック
async function toGroupId(raw: string, domain: string): Promise<string> {
  const decoded = decodeURIComponent(raw);
  // URL の場合はそのまま使用（ユーザー/グループを問わない）
  if (decoded.startsWith("http://") || decoded.startsWith("https://")) {
    return decoded;
  }
  // acct 形式を WebFinger で解決（任意の Actor に対応）
  if (decoded.includes("@")) {
    const [name, host] = decoded.split("@");
    if (name && host) {
      try {
        const actor = await resolveActorFromAcct(`${name}@${host}`);
        if (actor?.id) return actor.id;
      } catch {
        // ignore and fall back
      }
      // 解決に失敗した場合は従来動作（グループ想定）へフォールバック
      return `https://${host}/groups/${name}`;
    }
  }
  // ローカル名は従来どおりローカルグループとして解釈
  return `https://${domain}/groups/${decoded}`;
}

app.use("/api/groups/*", authRequired);

// 汎用: Actor情報取得（Group/User問わず）
app.use("/api/actors", authRequired);
app.get("/api/actors", async (c) => {
  const url = c.req.query("url");
  if (!url) return c.json({ error: "url is required" }, 400);
  try {
    const res = await fetch(url, {
      headers: {
        Accept:
          'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
      },
    });
    if (!res.ok) return c.json({ error: "fetch failed" }, res.status);
    const data = await res.json() as {
      id?: string;
      type?: string;
      name?: string;
      preferredUsername?: string;
      icon?: { url?: string } | string;
      image?: { url?: string } | string;
      summary?: string;
    };
    const iconUrl = typeof data.icon === "string"
      ? data.icon
      : (data.icon && typeof data.icon === "object" &&
          typeof data.icon.url === "string"
        ? data.icon.url
        : undefined);
    const host = (() => {
      try {
        return new URL(data.id ?? url).hostname;
      } catch {
        return "";
      }
    })();
    return c.json({
      id: data.id ?? url,
      type: data.type ?? "Actor",
      name: data.name ?? data.preferredUsername ?? url,
      preferredUsername: data.preferredUsername,
      handle: data.preferredUsername
        ? `@${data.preferredUsername}@${host}`
        : undefined,
      iconUrl: iconUrl,
      summary: data.summary,
      host,
    });
  } catch {
    return c.json({ error: "fetch failed" }, 502);
  }
});

app.get("/api/groups", async (c) => {
  const member = c.req.query("member");
  if (!member) return c.json({ error: "member is required" }, 400);
  const username = member.split("@")[0];
  const db = getDB(c);
  const groups = await db.groups.list(username);
  return c.json(groups);
});

app.get("/api/groups/:groupId/messages", async (c) => {
  const groupId = c.req.param("groupId");
  const db = getDB(c);
  const limit = Number(c.req.query("limit") ?? "0");
  const before = c.req.query("before");
  const after = c.req.query("after");

  let msgs = await db.posts.findMessages({ "aud.to": groupId }) as {
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

// グループ宛メッセージ送信（ローカルユーザー → ローカルグループ）
app.post(
  "/api/groups/:groupId/messages",
  zValidator(
    "json",
    z.object({
      from: z.string(), // acct 形式（例: alice@example.com）を期待
      type: z.enum(["note", "image", "video", "file"]).default("note"),
      content: z.string().optional(),
      url: z.string().optional(),
      mediaType: z.string().optional(),
      key: z.string().optional(),
      iv: z.string().optional(),
      preview: z.record(z.string(), z.any()).optional(),
      attachments: z.array(z.record(z.string(), z.any())).optional(),
    }),
  ),
  async (c) => {
    const raw = c.req.param("groupId");
    const domain = getDomain(c);
    const groupId = await toGroupId(raw, domain);
    // リモートグループ宛かを判定
    if (
      (() => {
        try {
          return new URL(groupId).hostname !== domain;
        } catch {
          return false;
        }
      })()
    ) {
      const body = c.req.valid("json") as Record<string, unknown>;
      const env = getEnv(c);
      const from = String(body.from ?? "");
      const [fromUser, fromHost] = from.split("@");
      if (!fromUser || !fromHost || fromHost !== domain) {
        return c.json({ error: "ローカルユーザーのみ対応" }, 400);
      }
      const type = (body.type as string) ?? "note";
      const content = typeof body.content === "string" ? body.content : "";
      const url = typeof body.url === "string" ? body.url : undefined;
      const mediaType = typeof body.mediaType === "string"
        ? body.mediaType
        : undefined;
      if (type === "note" ? !content.trim() : !(url && mediaType)) {
        return c.json({ error: "不正な入力です" }, 400);
      }
      const attachments =
        Array.isArray((body as { attachments?: unknown }).attachments)
          ? (body as { attachments: Record<string, unknown>[] }).attachments
          : undefined;
      const preview = (body as { preview?: unknown }).preview;
      const db = getDB(c);
      const extra: Record<string, unknown> = { type, group: true };
      if (attachments) extra.attachments = attachments;
      if (typeof (body as { key?: unknown }).key === "string") {
        extra.key = (body as { key: string }).key;
      }
      if (typeof (body as { iv?: unknown }).iv === "string") {
        extra.iv = (body as { iv: string }).iv;
      }
      if (preview && typeof preview === "object") {
        extra.preview = preview as Record<string, unknown>;
      }
      const saved = await db.posts.saveMessage(
        domain,
        `https://${domain}/users/${fromUser}`,
        content,
        extra,
        { to: [groupId], cc: [] },
      ) as { _id?: string; published?: Date };
      try {
        const target = await resolveRemoteActor(groupId, env);
        const asType = type === "image"
          ? "Image"
          : type === "video"
          ? "Video"
          : type === "file"
          ? "Document"
          : "Note";
        const toAsAttachments = (atts?: Record<string, unknown>[]) =>
          Array.isArray(atts)
            ? atts.map((a) => {
              const u = typeof (a as { url?: unknown }).url === "string"
                ? (a as { url: string }).url
                : "";
              const mt =
                typeof (a as { mediaType?: unknown }).mediaType === "string"
                  ? (a as { mediaType: string }).mediaType
                  : undefined;
              if (!u) return null;
              const t = mt?.startsWith("image/")
                ? "Image"
                : mt?.startsWith("video/")
                ? "Video"
                : mt?.startsWith("audio/")
                ? "Audio"
                : "Document";
              const obj: Record<string, unknown> = { type: t, url: u };
              if (mt) obj.mediaType = mt;
              const prev = (a as { preview?: unknown }).preview;
              if (prev && typeof prev === "object") {
                obj.preview = prev as Record<string, unknown>;
              }
              const k = (a as { key?: unknown }).key;
              const v = (a as { iv?: unknown }).iv;
              if (typeof k === "string") obj.key = k;
              if (typeof v === "string") obj.iv = v;
              return obj;
            }).filter(Boolean) as Record<string, unknown>[]
            : undefined;
        const object: Record<string, unknown> = {
          "@context": "https://www.w3.org/ns/activitystreams",
          type: asType,
          attributedTo: `https://${domain}/users/${fromUser}`,
          to: [groupId],
          audience: groupId,
        };
        if (asType === "Note") {
          object.content = content;
          const asAtt = toAsAttachments(attachments);
          if (asAtt && asAtt.length > 0) object.attachment = asAtt;
        } else {
          if (url) object.url = url;
          if (mediaType) object.mediaType = mediaType;
          if (content) object.name = content;
        }
        if (typeof (body as { key?: unknown }).key === "string") {
          (object as Record<string, unknown>).key =
            (body as { key: string }).key;
        }
        if (typeof (body as { iv?: unknown }).iv === "string") {
          (object as Record<string, unknown>).iv = (body as { iv: string }).iv;
        }
        if (preview && typeof preview === "object") {
          (object as Record<string, unknown>).preview = preview as Record<
            string,
            unknown
          >;
        }
        const activity = {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: `https://${domain}/activities/${crypto.randomUUID()}`,
          type: "Create" as const,
          actor: `https://${domain}/users/${fromUser}`,
          to: [groupId],
          object,
        };
        await sendActivityPubObject(
          target.sharedInbox ?? target.inbox,
          activity,
          fromUser,
          domain,
          env,
        );
      } catch (err) {
        console.error("remote group message delivery failed", err);
      }
      // 保存したメッセージの ID/日時を返す（クライアントでの表示不整合を防ぐ）
      return c.json({
        id: String((saved as { _id?: unknown })._id ?? ""),
        from: `https://${domain}/users/${fromUser}`,
        to: groupId,
        type,
        content,
        attachments,
        url,
        mediaType,
        key: typeof (body as { key?: unknown }).key === "string"
          ? (body as { key: string }).key
          : undefined,
        iv: typeof (body as { iv?: unknown }).iv === "string"
          ? (body as { iv: string }).iv
          : undefined,
        preview: preview && typeof preview === "object"
          ? preview as Record<string, unknown>
          : undefined,
        createdAt: (saved as { published?: Date }).published ?? new Date(),
      });
    }
    // ローカル（同一ドメインのグループ）
    let name = "";
    try {
      name = new URL(groupId).pathname.split("/").pop() || raw;
    } catch {
      name = raw;
    }
    const body = c.req.valid("json") as Record<string, unknown>;
    const db = getDB(c);
    const env = getEnv(c);
    const group = await db.groups.findByName(name) as GroupDoc | null;
    if (!group) return c.json({ error: "見つかりません" }, 404);

    // from は acct 形式を要求し、ローカルユーザーのみ許可
    const from = String(body.from ?? "");
    const [fromUser, fromHost] = from.split("@");
    if (!fromUser || !fromHost || fromHost !== domain) {
      return c.json({ error: "リモートユーザーは未対応です" }, 400);
    }
    const actorId = `https://${domain}/users/${fromUser}`;

    // メンバー（followers）でなければ拒否
    if (!group.followers.includes(actorId)) {
      return c.json({ error: "メンバーではありません" }, 403);
    }

    // 本文 or メディアの最低要件を確認
    const type = (body.type as string) ?? "note";
    const content = typeof body.content === "string" ? body.content : "";
    const url = typeof body.url === "string" ? body.url : undefined;
    const mediaType = typeof body.mediaType === "string"
      ? body.mediaType
      : undefined;
    if (
      type === "note" ? !content.trim() : !(url && mediaType)
    ) {
      return c.json({ error: "不正な入力です" }, 400);
    }

    // 添付の正規化
    const attachments =
      Array.isArray((body as { attachments?: unknown }).attachments)
        ? (body as { attachments: Record<string, unknown>[] }).attachments
        : undefined;
    const extra: Record<string, unknown> = { type: type, group: true };
    if (attachments) extra.attachments = attachments;
    if (typeof body.key === "string") extra.key = body.key;
    if (typeof body.iv === "string") extra.iv = body.iv;
    if (body.preview && typeof body.preview === "object") {
      extra.preview = body.preview as Record<string, unknown>;
    }

    // DB 保存（メッセージ型）
    const saved = await db.posts.saveMessage(
      domain,
      actorId,
      content,
      extra,
      { to: [groupId], cc: [] },
    ) as {
      _id?: string;
      published?: Date;
    };

    // ActivityPub Create を構築してグループ inbox へ送信
    const asType = type === "image"
      ? "Image"
      : type === "video"
      ? "Video"
      : type === "file"
      ? "Document"
      : "Note";

    // ActivityStreams の attachment 配列へ変換
    const toAsAttachments = (atts?: Record<string, unknown>[]) =>
      Array.isArray(atts)
        ? atts
          .map((a) => {
            const u = typeof (a as { url?: unknown }).url === "string"
              ? (a as { url: string }).url
              : "";
            const mt =
              typeof (a as { mediaType?: unknown }).mediaType === "string"
                ? (a as { mediaType: string }).mediaType
                : undefined;
            if (!u) return null;
            const t = mt?.startsWith("image/")
              ? "Image"
              : mt?.startsWith("video/")
              ? "Video"
              : mt?.startsWith("audio/")
              ? "Audio"
              : "Document";
            const obj: Record<string, unknown> = { type: t, url: u };
            if (mt) obj.mediaType = mt;
            const prev = (a as { preview?: unknown }).preview;
            if (prev && typeof prev === "object") {
              obj.preview = prev as Record<string, unknown>;
            }
            const key = (a as { key?: unknown }).key;
            const iv = (a as { iv?: unknown }).iv;
            if (typeof key === "string") {
              obj.key = key;
            }
            if (typeof iv === "string") obj.iv = iv;
            return obj;
          })
          .filter(Boolean) as Record<string, unknown>[]
        : undefined;

    const object: Record<string, unknown> = {
      "@context": "https://www.w3.org/ns/activitystreams",
      type: asType,
      attributedTo: actorId,
      to: [groupId],
      audience: groupId, // 受信側検証しやすくするため audience も付与
    };
    if (asType === "Note") {
      object.content = content;
      const asAtt = toAsAttachments(attachments);
      if (asAtt && asAtt.length > 0) object.attachment = asAtt;
    } else {
      if (url) object.url = url;
      if (mediaType) object.mediaType = mediaType;
      if (content) object.name = content; // キャプション相当
    }
    if (typeof body.key === "string") {
      (object as Record<string, unknown>).key = body.key;
    }
    if (typeof body.iv === "string") {
      (object as Record<string, unknown>).iv = body.iv;
    }
    if (body.preview && typeof body.preview === "object") {
      (object as Record<string, unknown>).preview = body.preview as Record<
        string,
        unknown
      >;
    }

    const activity = {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `https://${domain}/activities/${crypto.randomUUID()}`,
      type: "Create" as const,
      actor: actorId,
      to: [groupId],
      object,
    };
    try {
      await sendActivityPubObject(
        `${groupId}/inbox`,
        activity,
        fromUser,
        domain,
        env,
      );
    } catch (err) {
      console.error("group message delivery failed", err);
      // 配送失敗でも保存済みなので 202 相当で返す
    }

    return c.json({
      id: String((saved as { _id?: unknown })._id ?? ""),
      from: actorId,
      to: groupId,
      type,
      content,
      attachments,
      url,
      mediaType,
      key: typeof body.key === "string" ? body.key : undefined,
      iv: typeof body.iv === "string" ? body.iv : undefined,
      preview: body.preview && typeof body.preview === "object"
        ? body.preview as Record<string, unknown>
        : undefined,
      createdAt: (saved as { published?: Date }).published ?? new Date(),
    });
  },
);

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
        exists = await db.groups.findByName(groupName);
        attempts++;
      } while (exists && attempts < 5);
      if (exists) {
        return c.json({ error: "groupName collision, try again" }, 500);
      }
    } else {
      // user provided a name — if it exists, fail with 400 to avoid silently changing it
      const exists = await db.groups.findByName(groupName);
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
    await db.groups.create({
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
    await db.groups.addFollower(groupName, actorId);
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
        const env = getEnv(c);
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
        try {
          await db.invites.save({
            groupName,
            actor: target,
            inviter: groupId,
          });
        } catch (err) {
          console.error("招待の保存に失敗しました", err);
          failed.push(cand);
        }
        // ローカルユーザーなら通知も保存＋WS送信
        try {
          const [u, h] = cand.split("@");
          if (h === domain) {
            const acc = await db.accounts.findByUserName(u);
            if (acc) {
              await db.notifications.create(
                acc._id!,
                "グループ招待",
                JSON.stringify({
                  kind: "group-invite",
                  groupName,
                  groupId: `https://${domain}/groups/${groupName}`,
                  displayName:
                    (await db.groups.findByName(groupName))?.displayName ??
                      groupName,
                  inviter: groupId,
                }),
                "group-invite",
              );
              sendToUser(`${acc.userName}@${domain}`, { type: "notification" });
            }
          }
        } catch (_e) {
          // ignore local notification failure
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
    const group = await db.groups.updateByName(name, update);
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
    const db = getDB(c);
    const group = await db.groups.findByName(name) as
      | GroupDoc
      | null;
    if (!group) return c.json({ error: "見つかりません" }, 404);
    if (!isOwnedGroup(group, domain, name)) {
      return c.json({ error: "他ホストのグループです" }, 403);
    }
    const update = c.req.valid("json") as Record<string, unknown>;
    const updated = await db.groups.updateByName(name, update);
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
    const group = await db.groups.findByName(name) as GroupDoc | null;
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
    await db.invites.save({
      groupName: name,
      actor: target,
      inviter: inviterId,
      expiresAt,
      remainingUses: uses,
    }).catch(() => {});
    const [user, host] = acct.split("@");
    if (host === domain) {
      const acc = await db.accounts.findByUserName(user);
      if (acc) {
        await db.notifications.create(
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
        // WS で即時通知（通知画面を開いていなくても反映させる）
        try {
          sendToUser(`${acc.userName}@${domain}`, { type: "notification" });
        } catch {
          /* ignore */
        }
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
    const raw = c.req.param("name");
    const { member } = c.req.valid("json") as { member: string };
    const domain = getDomain(c);
    const env = getEnv(c);
    const [user, host] = member.split("@");
    if (!user || !host) {
      return c.json({ error: "member の形式が正しくありません" }, 400);
    }
    const decoded = decodeURIComponent(raw);
    if (
      (decoded.startsWith("http://") || decoded.startsWith("https://")) &&
      (() => {
        try {
          return new URL(decoded).hostname !== domain;
        } catch {
          return false;
        }
      })()
    ) {
      if (host !== domain) {
        return c.json({ error: "ローカルユーザーのみ対応" }, 400);
      }
      try {
        const join = {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: `https://${domain}/activities/${crypto.randomUUID()}`,
          type: "Join" as const,
          actor: `https://${domain}/users/${user}`,
          object: decoded,
          to: [decoded],
        };
        const target = await resolveRemoteActor(decoded, env);
        await sendActivityPubObject(
          target.sharedInbox ?? target.inbox,
          join,
          user,
          domain,
          env,
        );
        const db = getDB(c);
        await db.accounts.updateByUserName(user, {
          $addToSet: { groups: decoded },
        });
        return c.json({ ok: true });
      } catch (_err) {
        return c.json({ error: "送信に失敗しました" }, 500);
      }
    }
    // ローカル（グループ名 or ローカルActor URL）
    let name = raw;
    if (decoded.startsWith("http://") || decoded.startsWith("https://")) {
      try {
        const u = new URL(decoded);
        if (u.hostname === domain) name = u.pathname.split("/").pop() || raw;
      } catch { /* ignore */ }
    }
    const db = getDB(c);
    const group = await db.groups.findByName(name) as GroupDoc | null;
    if (!group) return c.json({ error: "見つかりません" }, 404);
    if (host !== domain) {
      return c.json({ error: "リモートユーザーは未対応です" }, 400);
    }
    const actorId = `https://${domain}/users/${user}`;
    if (group.membershipPolicy === "inviteOnly") {
      const inv = await db.invites.findOne({
        groupName: name,
        actor: actorId,
      }) as
        | (unknown & { expiresAt?: Date; remainingUses?: number })
        | null;
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
      await sendActivityPubObject(`${groupId}/inbox`, join, user, domain, env);
    } catch (_err) {
      return c.json({ error: "送信に失敗しました" }, 500);
    }
    return c.json({ ok: true });
  },
);

// リモートグループへ参加（ローカルユーザー → リモートGroup）
app.post(
  "/api/groups/joinRemote",
  zValidator(
    "json",
    z.object({ member: z.string(), groupId: z.string().url() }),
  ),
  async (c) => {
    const { member, groupId } = c.req.valid("json") as {
      member: string;
      groupId: string;
    };
    const [user, host] = member.split("@");
    const domain = getDomain(c);
    if (!user || !host) {
      return c.json({ error: "member の形式が正しくありません" }, 400);
    }
    if (host !== domain) {
      return c.json({ error: "ローカルユーザーのみ対応" }, 400);
    }
    const env = getEnv(c);
    try {
      const target = await resolveRemoteActor(groupId, env);
      const join = {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: `https://${domain}/activities/${crypto.randomUUID()}`,
        type: "Join" as const,
        actor: `https://${domain}/users/${user}`,
        object: groupId,
        to: [groupId],
      };
      await sendActivityPubObject(
        target.sharedInbox ?? target.inbox,
        join,
        user,
        domain,
        env,
      );
      // アカウントの groups に追加して一覧に出せるようにする
      const db = getDB(c);
      await db.accounts.updateByUserName(user, {
        $addToSet: { groups: groupId },
      });
      return c.json({ ok: true });
    } catch (err) {
      console.error("joinRemote failed", err);
      return c.json({ error: "送信に失敗しました" }, 500);
    }
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
    const group = await db.groups.findByName(name) as
      | GroupDoc
      | null;
    if (!group) return c.json({ error: "見つかりません" }, 404);
    if (!isOwnedGroup(group, domain, name)) {
      return c.json({ error: "他ホストのグループです" }, 403);
    }
    if (!group.privateKey) {
      return c.json({ error: "内部エラー: privateKey がありません" }, 500);
    }
    const approval = await db.approvals.findOne({
      groupName: name,
      actor,
    }) as unknown & { activity: unknown };
    if (!approval) return c.json({ error: "見つかりません" }, 404);
    if (accept) {
      if (!group.followers.includes(actor)) {
        await db.groups.addFollower(name, actor);
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
    await db.approvals.deleteOne({ groupName: name, actor });
    return c.json({ ok: true });
  },
);

app.get("/groups/:name", async (c) => {
  const name = c.req.param("name");
  const db = getDB(c);
  const group = await db.groups.findByName(name) as GroupDoc | null;
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
  const group = await db.groups.findByName(name) as GroupDoc | null;
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
  const group = await db.groups.findByName(name) as GroupDoc | null;
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
  const group = await db.groups.findByName(name) as GroupDoc | null;
  if (!group) return c.json({ error: "Not Found" }, 404);
  const domain = getDomain(c);
  const env = getEnv(c);
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
      await db.invites.findOneAndUpdate(
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
      await db.approvals.findOneAndUpdate(
        { groupName: name, actor: activity.actor },
        { activity },
        { upsert: true },
      ).catch(() => {});
      return c.json({ ok: true });
    }
    let inv: (unknown & { expiresAt?: Date; remainingUses?: number }) | null =
      null;
    if (group.membershipPolicy === "inviteOnly") {
      inv = await db.invites.findOne({
        groupName: name,
        actor: activity.actor,
      }) as (unknown & { expiresAt?: Date; remainingUses?: number }) | null;
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
      await db.groups.addFollower(name, activity.actor);
    }
    if (inv) {
      const uses = inv.remainingUses ?? 1;
      if (uses <= 1) {
        await db.invites.deleteOne({ groupName: name, actor: activity.actor });
      } else {
        await db.invites.findOneAndUpdate(
          { groupName: name, actor: activity.actor },
          { $inc: { remainingUses: -1 } },
        ).catch(() => {});
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
      await db.approvals.findOneAndUpdate(
        { groupName: name, actor: activity.actor },
        { activity },
        { upsert: true },
      ).catch(() => {});
      return c.json({ ok: true });
    }
    let inv: (unknown & { expiresAt?: Date; remainingUses?: number }) | null =
      null;
    if (group.membershipPolicy === "inviteOnly") {
      inv = await db.invites.findOne({
        groupName: name,
        actor: activity.actor,
      }) as (unknown & { expiresAt?: Date; remainingUses?: number }) | null;
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
      await db.groups.addFollower(name, activity.actor);
    }
    if (inv) {
      const uses = inv.remainingUses ?? 1;
      if (uses <= 1) {
        await db.invites.deleteOne({ groupName: name, actor: activity.actor });
      } else {
        await db.invites.findOneAndUpdate(
          { groupName: name, actor: activity.actor },
          { $inc: { remainingUses: -1 } },
        ).catch(() => {});
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
    // メッセージを保存（ローカル履歴用）
    const saveForHistory = async () => {
      const obj = activity.object as Record<string, unknown>;
      const objType = String((obj as { type?: unknown }).type ?? "Note");
      const type = objType === "Image"
        ? "image"
        : objType === "Video"
        ? "video"
        : objType === "Document"
        ? "file"
        : "note";
      const author = typeof (obj as { attributedTo?: unknown }).attributedTo ===
          "string"
        ? String((obj as { attributedTo: string }).attributedTo)
        : (typeof activity.actor === "string" ? activity.actor : "");
      const content = typeof (obj as { content?: unknown }).content === "string"
        ? String((obj as { content: string }).content)
        : (typeof (obj as { name?: unknown }).name === "string"
          ? String((obj as { name: string }).name)
          : "");
      const extra: Record<string, unknown> = { type, group: true };
      const atts = extractAttachments(obj);
      if (atts.length > 0) extra.attachments = atts as unknown as Record<
        string,
        unknown
      >[];
      const k = (obj as { key?: unknown }).key;
      const v = (obj as { iv?: unknown }).iv;
      const prev = (obj as { preview?: unknown }).preview;
      if (typeof k === "string") extra.key = k;
      if (typeof v === "string") extra.iv = v;
      if (prev && typeof prev === "object") extra.preview = prev as Record<
        string,
        unknown
      >;
      await db.posts.saveMessage(
        domain,
        author,
        content,
        extra,
        { to: [groupId], cc: [] },
      ).catch((err: unknown) => {
        console.error("save group message failed", err);
      });
    };

    await saveForHistory();

    // 保存用（公開用）Outbox には宛先情報を含めない Announce を格納
    const announceBase = {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `https://${domain}/activities/${crypto.randomUUID()}`,
      type: "Announce" as const,
      actor: groupId,
      object: activity.object,
    };
    await db.groups.pushOutbox(name, announceBase);

    // fan-out: bto 相当は配送前に剥離し、各メンバーに個別配送
    // 受信側の相互運用のため sharedInbox があればそれを利用（utils 側が解決）
    if (!group.privateKey) {
      return c.json({ error: "内部エラー: privateKey がありません" }, 500);
    }
    const gpKey: string = group.privateKey;
    // ここではフォロワー（Actor IRI）の配列を渡し、各自の inbox/sharedInbox 解決は
    // deliverActivityPubObject に委譲する（sendActivityPubObject は inbox URL 前提）。
    await deliverActivityPubObject(
      group.followers,
      announceBase,
      { actorId: groupId, privateKey: gpKey },
      domain,
      env,
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
    await db.groups.removeFollower(name, actor);
    return c.json({ ok: true });
  }

  return c.json({ error: "Unsupported" }, 400);
});

export { toGroupId };

export default app;
