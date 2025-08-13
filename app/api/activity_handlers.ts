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
import { decodeMLSMessage } from "../shared/mls_message.ts";

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

export type ActivityHandler = (
  activity: Record<string, unknown>,
  username: string,
  c: unknown,
) => Promise<void>;

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
  });
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
        objTypes.includes("PrivateMessage");
      if (isMLS && typeof obj.content === "string") {
        const mediaType = typeof obj.mediaType === "string"
          ? obj.mediaType
          : "message/mls";
        const encoding = typeof obj.encoding === "string"
          ? obj.encoding
          : "base64";
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
        const decoded = decodeMLSMessage(obj.content);
        if (decoded) {
          let bodyObj: Record<string, unknown> | null = null;
          try {
            bodyObj = JSON.parse(
              new TextDecoder().decode(decoded.body),
            ) as Record<string, unknown>;
          } catch {
            bodyObj = null;
          }
          if (
            bodyObj &&
            (bodyObj.type === "remove" || bodyObj.type === "welcome")
          ) {
            const msg = await db.createHandshakeMessage({
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
              message: obj.content,
              createdAt: msg.createdAt,
            };
            sendToUser(selfHandle, { type: "publicMessage", payload: newMsg });
            return;
          }
        }
        const msg = await db.createEncryptedMessage({
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
        const newMsg = {
          id: String(msg._id),
          roomId: msg.roomId,
          from,
          to: recipients,
          content: obj.content,
          mediaType: msg.mediaType,
          encoding: msg.encoding,
          createdAt: msg.createdAt,
        };
        if (
          bodyObj &&
          bodyObj.type === "joinAck" &&
          typeof bodyObj.roomId === "string" &&
          typeof bodyObj.deviceId === "string"
        ) {
          await db.markInviteAcked(
            bodyObj.roomId,
            from,
            bodyObj.deviceId,
          );
        }
        sendToUser(selfHandle, { type: "encryptedMessage", payload: newMsg });
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
    const actor = typeof activity.actor === "string"
      ? iriToHandle(activity.actor)
      : username;
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
