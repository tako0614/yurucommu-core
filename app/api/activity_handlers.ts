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
    if (typeof activity.object !== "object" || activity.object === null) {
      return;
    }
    const obj = activity.object as Record<string, unknown>;
    const toList = Array.isArray(obj.to)
      ? obj.to
      : typeof obj.to === "string"
      ? [obj.to]
      : [];
    const extra = typeof obj.extra === "object" && obj.extra !== null
      ? obj.extra as Record<string, unknown>
      : {};

    // extra.dm が true の場合は DM とみなす
    if (extra.dm === true) {
      const target = toList[0];
      const isCollection = (url: string): boolean => {
        if (url === "https://www.w3.org/ns/activitystreams#Public") return true;
        try {
          const path = new URL(url).pathname;
          return path.endsWith("/followers") ||
            path.endsWith("/following") ||
            path.endsWith("/outbox") ||
            path.endsWith("/collections") ||
            path.endsWith("/liked") ||
            path.endsWith("/likes");
        } catch {
          return false;
        }
      };
      if (isCollection(target)) return;

      const actor = typeof activity.actor === "string"
        ? activity.actor
        : username;
      const env = (c as { get: (k: string) => unknown }).get("env") as Record<
        string,
        string
      >;
      const domain = getDomain(c as Context);
      const db = createDB(env);
      const msg = await db.saveMessage(
        domain,
        actor,
        typeof obj.content === "string" ? obj.content : "",
        extra,
        { to: toList, cc: Array.isArray(obj.cc) ? obj.cc : [] },
      ) as { _id: unknown };

      const fromHandle = iriToHandle(actor);
      const toHandle = iriToHandle(target);
      const payload = {
        id: String(msg._id),
        from: fromHandle,
        to: toHandle,
        content: typeof obj.content === "string" ? obj.content : "",
      };
      sendToUser(toHandle, { type: "dm", payload });
      sendToUser(fromHandle, { type: "dm", payload });

      const targetHost = (() => {
        try {
          return new URL(target).hostname;
        } catch {
          return "";
        }
      })();
      if (targetHost && targetHost !== domain) {
        deliverActivityPubObject([target], activity, actor, domain, env).catch(
          (err) => {
            console.error("Delivery failed:", err);
          },
        );
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
};
