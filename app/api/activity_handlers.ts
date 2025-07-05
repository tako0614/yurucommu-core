import Account from "./models/account.ts";
import ActivityPubObject from "./models/activitypub_object.ts";
import {
  createAcceptActivity,
  deliverActivityPubObject,
  getDomain,
} from "./utils/activitypub.ts";

export type ActivityHandler = (
  activity: Record<string, unknown>,
  username: string,
  c: unknown,
) => Promise<void>;

async function saveObject(
  obj: Record<string, unknown>,
  actor: string,
) {
  // 外部ユーザーの情報を抽出
  let actorInfo = {};
  if (typeof actor === "string" && actor.startsWith("http")) {
    // ActivityPubオブジェクトから追加のactor情報を試みる
    if (obj.attributedTo && typeof obj.attributedTo === "object") {
      const actorObj = obj.attributedTo as Record<string, unknown>;
      actorInfo = {
        name: actorObj.name,
        preferredUsername: actorObj.preferredUsername,
        icon: typeof actorObj.icon === "object" && actorObj.icon !== null ? 
              (actorObj.icon as Record<string, unknown>).url : 
              actorObj.icon,
        summary: actorObj.summary,
      };
    }
  }

  await ActivityPubObject.create({
    type: obj.type ?? "Note",
    attributedTo: typeof obj.attributedTo === "string"
      ? obj.attributedTo
      : actor,
    content: obj.content,
    to: Array.isArray(obj.to) ? obj.to : [],
    cc: Array.isArray(obj.cc) ? obj.cc : [],
    published: obj.published && typeof obj.published === "string" ? 
               new Date(obj.published) : new Date(),
    raw: obj,
    extra: { 
      ...(obj.extra ?? {}),
      actorInfo: Object.keys(actorInfo).length > 0 ? actorInfo : undefined,
    },
  });
}

export const activityHandlers: Record<string, ActivityHandler> = {
  async Create(
    activity: Record<string, unknown>,
    username: string,
    _c: unknown,
  ) {
    if (typeof activity.object === "object" && activity.object !== null) {
      const actor = typeof activity.actor === "string"
        ? activity.actor
        : username;
      await saveObject(activity.object as Record<string, unknown>, actor);
    }
  },

  async Follow(
    activity: Record<string, unknown>,
    username: string,
    c: unknown,
  ) {
    if (typeof activity.actor !== "string") return;
    await Account.updateOne(
      { userName: username },
      { $addToSet: { followers: activity.actor } },
    );
    const domain = getDomain(c as { req: { url: string; }; });
    const accept = createAcceptActivity(
      domain,
      `https://${domain}/users/${username}`,
      activity,
    );
    deliverActivityPubObject([activity.actor], accept, username).catch(
      (err) => {
        console.error("Delivery failed:", err);
      },
    );
  },
};
