import type { Context } from "hono";
import { createDB } from "./DB/mod.ts";
import {
  createAcceptActivity,
  deliverActivityPubObject,
  extractAttachments,
  getDomain,
} from "./utils/activitypub.ts";
import { broadcast, sendToUser } from "./routes/ws.ts";
import { formatUserInfoForPost, getUserInfo } from "./services/user-info.ts";
import { extractBasicCredentialIdentity } from "./utils/basic_credential.ts";
// MLS関連データは検証せずそのまま保持する

function iriToHandle(iri: string): string {
  try {
    const u = new URL(iri);
    const segments = u.pathname.split("/").filter(Boolean);
    const name = segments[segments.length - 1];
    return `${name}@${u.hostname}`;
  } catch {
    return iri;
  }
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export type ActivityHandler = (
  activity: Record<string, unknown>,
  username: string,
  c: unknown,
) => Promise<unknown>;

async function saveObject(
  env: Record<string, string>,
  obj: Record<string, unknown>,
  actor: string,
): Promise<Record<string, unknown>> {
  // 外部ユーザーの情報を抽出
  let actorInfo = {};
  if (typeof actor === "string" && actor.startsWith("http")) {
    // ActivityPubオブジェクトから追加のactor情報を試みる
    if (obj.attributedTo && typeof obj.attributedTo === "object") {
      const actorObj = obj.attributedTo as Record<string, unknown>;
      actorInfo = {
        name: actorObj.name,
        preferredUsername: actorObj.preferredUsername,
        icon: typeof actorObj.icon === "object" && actorObj.icon !== null
          ? (actorObj.icon as Record<string, unknown>).url
          : actorObj.icon,
        summary: actorObj.summary,
      };
    }
  }

  const attachments = extractAttachments(obj);
  const extra: Record<string, unknown> = {
    ...(obj.extra ?? {}),
    actorInfo: Object.keys(actorInfo).length > 0 ? actorInfo : undefined,
  };
  if (attachments.length > 0) extra.attachments = attachments;

  const db = createDB(env);
  return await db.saveObject({
    type: obj.type ?? "Note",
    attributedTo: typeof obj.attributedTo === "string"
      ? obj.attributedTo
      : actor,
    content: obj.content,
    to: Array.isArray(obj.to) ? obj.to : [],
    cc: Array.isArray(obj.cc) ? obj.cc : [],
    published: obj.published && typeof obj.published === "string"
      ? new Date(obj.published)
      : new Date(),
    raw: obj,
    extra,
  }) as unknown as Record<string, unknown>;
}

export const activityHandlers: Record<string, ActivityHandler> = {
  async Create(
    activity: Record<string, unknown>,
    username: string,
    c: unknown,
  ) {
    if (typeof activity.object === "object" && activity.object !== null) {
      const obj = activity.object as Record<string, unknown>;
      const objTypes = Array.isArray(obj.type) ? obj.type : [obj.type];
      const isMLS = objTypes.includes("PublicMessage") ||
        objTypes.includes("PrivateMessage") ||
        objTypes.includes("Welcome");
      if (isMLS && typeof obj.content === "string") {
        const mediaType = typeof obj.mediaType === "string"
          ? obj.mediaType
          : "message/mls";
        const encoding = typeof obj.encoding === "string"
          ? obj.encoding
          : "base64";
        // mediaType / encoding の仕様チェック: 期待値以外は保存せずエラー扱い
        if (mediaType !== "message/mls" || encoding !== "base64") {
          console.error(
            "Unsupported MLS message format",
            { mediaType, encoding, types: objTypes },
          );
          return; // 仕様外メッセージは保存しない
        }
        const toRaw = Array.isArray(activity.to)
          ? activity.to
          : activity.to
          ? [activity.to]
          : [];
        const objToRaw = Array.isArray(obj.to)
          ? obj.to
          : obj.to
          ? [obj.to]
          : [];
        // 宛先リストにコレクション URI (as:Public や /followers) が含まれている場合は拒否
        const allRecipientRaw = [...toRaw, ...objToRaw].filter((
          v,
        ): v is string => typeof v === "string");
        const hasCollectionRecipient = allRecipientRaw.some((iri) => {
          if (iri === "as:Public") return true;
          try {
            const u = new URL(iri);
            const parts = u.pathname.split("/").filter(Boolean);
            if (parts.includes("followers")) return true;
          } catch {
            // 非URLの文字列もチェック（as:Public 以外の拡張が来る可能性）
            if (typeof iri === "string" && iri.includes("/followers")) {
              return true;
            }
          }
          return false;
        });
        if (hasCollectionRecipient) {
          // c が Hono の Context ならエラーレスポンスを返す
          if (c && typeof (c as Context).json === "function") {
            return (c as Context).json({ error: "invalid recipients" }, 400);
          }
          console.error("Rejected MLS message due to collection recipient", {
            recipients: allRecipientRaw,
          });
          return;
        }
        const recipients = [...toRaw, ...objToRaw]
          .filter((v): v is string => typeof v === "string")
          .map(iriToHandle);
        const from = typeof activity.actor === "string"
          ? iriToHandle(activity.actor)
          : username;
        const env = (c as { get: (k: string) => unknown }).get(
          "env",
        ) as Record<string, string>;
        const db = createDB(env);
        const domain = getDomain(c as Context);
        const selfHandle = `${username}@${domain}`;
        const roomId = typeof obj.roomId === "string" ? obj.roomId : undefined;

        if (objTypes.includes("PrivateMessage")) {
          const msg = await db.createEncryptedMessage({
            roomId,
            from,
            to: recipients,
            content: obj.content,
            mediaType,
            encoding,
          }) as {
            _id: unknown;
            roomId?: string;
            from: string;
            to: string[];
            content: string;
            mediaType: string;
            encoding: string;
            createdAt: unknown;
          };
          // WSはトリガーのみ（本文等は送らない）
          const newMsg = {
            id: String(msg._id),
            roomId: msg.roomId,
            from,
            to: recipients,
            createdAt: msg.createdAt,
          };
          sendToUser(selfHandle, { type: "encryptedMessage", payload: newMsg });
        } else {
          const msg = await db.createHandshakeMessage({
            roomId,
            sender: from,
            recipients,
            message: obj.content,
          }) as {
            _id: unknown;
            roomId?: string;
            sender: string;
            recipients: string[];
            message: string;
            createdAt: unknown;
          };
          const newMsg = {
            id: String(msg._id),
            roomId: msg.roomId,
            sender: from,
            recipients,
            createdAt: msg.createdAt,
          };
          // Handshake系（Commit/Proposal/Welcome）は WS では "handshake" 種別で通知
          sendToUser(selfHandle, { type: "handshake", payload: newMsg });
          // Welcome オブジェクトを受信した場合はサーバー側で通知を作成（ローカル受信者のみ）
          if (objTypes.includes("Welcome")) {
            if (roomId) {
              const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
              await db.savePendingInvite(roomId, username, "", expiresAt);
              sendToUser(selfHandle, {
                type: "pendingInvite",
                payload: { roomId, from },
              });
            }
            try {
              const acc = await db.findAccountByUserName(username);
              if (acc && acc._id) {
                await db.createNotification(
                  String(acc._id),
                  "会話招待",
                  JSON.stringify({
                    kind: "chat-invite",
                    roomId: msg.roomId,
                    sender: from,
                  }),
                  "chat-invite",
                );
                sendToUser(selfHandle, { type: "notification" });
              }
            } catch (e) {
              console.error("failed to create welcome notification", e);
            }
          }
        }
        return;
      }

      const actor = typeof activity.actor === "string"
        ? activity.actor
        : username;
      const env = (c as { get: (k: string) => unknown }).get("env") as Record<
        string,
        string
      >;
      const saved = await saveObject(
        env,
        obj,
        actor,
      );
      const domain = getDomain(c as Context);
      const userInfo = await getUserInfo(
        (saved.actor_id as string) ?? actor,
        domain,
        env,
      );
      const formatted = formatUserInfoForPost(
        userInfo,
        saved,
      );
      broadcast({
        type: "newPost",
        payload: { timeline: "latest", post: formatted },
      });
      sendToUser(`${username}@${domain}`, {
        type: "newPost",
        payload: { timeline: "following", post: formatted },
      });
    }
  },

  async Follow(
    activity: Record<string, unknown>,
    username: string,
    c: unknown,
  ) {
    if (typeof activity.actor !== "string") return;
    const env = (c as { get: (k: string) => unknown }).get("env") as Record<
      string,
      string
    >;
    const db = createDB(env);
    await db.addFollowerByName(username, activity.actor);
    await db.follow(username, activity.actor);
    const domain = getDomain(c as Context);
    const accept = createAcceptActivity(
      domain,
      `https://${domain}/users/${username}`,
      activity,
    );
    deliverActivityPubObject(
      [activity.actor],
      accept,
      username,
      domain,
      env,
    ).catch(
      (err) => {
        console.error("Delivery failed:", err);
      },
    );
  },

  async Add(
    activity: Record<string, unknown>,
    username: string,
    c: unknown,
  ) {
    if (typeof activity.object !== "object" || activity.object === null) {
      return;
    }
    const obj = activity.object as Record<string, unknown>;
    const objTypes = Array.isArray(obj.type) ? obj.type : [obj.type];
    if (!objTypes.includes("KeyPackage") || typeof obj.content !== "string") {
      return;
    }
    const env = (c as { get: (k: string) => unknown }).get("env") as Record<
      string,
      string
    >;
    const db = createDB(env);
    const actorUrl = typeof activity.actor === "string"
      ? activity.actor
      : undefined;
    const actor = actorUrl ? iriToHandle(actorUrl) : username;
    const mediaType = typeof obj.mediaType === "string"
      ? obj.mediaType
      : "message/mls";
    const encoding = typeof obj.encoding === "string" ? obj.encoding : "base64";
    const groupInfo = typeof obj.groupInfo === "string"
      ? obj.groupInfo
      : undefined;
    const expiresAt = typeof obj.expiresAt === "string"
      ? new Date(obj.expiresAt)
      : obj.expiresAt instanceof Date
      ? obj.expiresAt
      : undefined;
    const deviceId = typeof obj.deviceId === "string"
      ? obj.deviceId
      : undefined;
    const version = typeof obj.version === "string" ? obj.version : undefined;
    const cipherSuite = typeof obj.cipherSuite === "number"
      ? obj.cipherSuite
      : typeof (obj as { cipher_suite?: number }).cipher_suite === "number"
      ? (obj as { cipher_suite: number }).cipher_suite
      : undefined;
    const generator = typeof obj.generator === "string"
      ? obj.generator
      : undefined;
    const keyId = typeof obj.id === "string"
      ? obj.id.split("/").pop()
      : undefined;
    // BasicCredential.identity と actor の URL を照合
    let identity: string | null = null;
    try {
      identity = extractBasicCredentialIdentity(b64ToBytes(obj.content));
    } catch (err) {
      console.error("KeyPackage verification failed", err);
      return;
    }
    if (!identity || identity !== actorUrl) {
      console.error("KeyPackage identity mismatch", identity, actorUrl);
      return;
    }
    await db.createKeyPackage(
      actor,
      obj.content,
      mediaType,
      encoding,
      groupInfo,
      expiresAt,
      deviceId,
      version,
      cipherSuite,
      generator,
      keyId,
    );
    await db.cleanupKeyPackages(actor);
  },

  async Remove(
    activity: Record<string, unknown>,
    username: string,
    c: unknown,
  ) {
    if (typeof activity.object !== "string") return;
    const keyId = activity.object.split("/").pop();
    if (!keyId) return;
    const env = (c as { get: (k: string) => unknown }).get("env") as Record<
      string,
      string
    >;
    const db = createDB(env);
    const actor = typeof activity.actor === "string"
      ? iriToHandle(activity.actor)
      : username;
    await db.deleteKeyPackage(actor, keyId);
    await db.cleanupKeyPackages(actor);
  },

  async Delete(
    activity: Record<string, unknown>,
    username: string,
    c: unknown,
  ) {
    if (typeof activity.object !== "string") return;
    const keyId = activity.object.split("/").pop();
    if (!keyId) return;
    const env = (c as { get: (k: string) => unknown }).get("env") as Record<
      string,
      string
    >;
    const db = createDB(env);
    const actor = typeof activity.actor === "string"
      ? iriToHandle(activity.actor)
      : username;
    await db.deleteKeyPackage(actor, keyId);
    await db.cleanupKeyPackages(actor);
  },
};
