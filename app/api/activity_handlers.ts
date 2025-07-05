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
  await ActivityPubObject.create({
    type: obj.type ?? "Note",
    attributedTo: typeof obj.attributedTo === "string"
      ? obj.attributedTo
      : actor,
    content: obj.content,
    to: Array.isArray(obj.to) ? obj.to : [],
    cc: Array.isArray(obj.cc) ? obj.cc : [],
    published: obj.published ? new Date(obj.published) : new Date(),
    raw: obj,
    extra: obj.extra ?? {},
  });
}

export const activityHandlers: Record<string, ActivityHandler> = {
  async Create(
    activity: Record<string, unknown>,
    username: string,
    _c: unknown,
  ) {
    if (typeof activity.object === "object") {
      const actor = typeof activity.actor === "string"
        ? activity.actor
        : username;
      await saveObject(activity.object, actor);
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
    const domain = getDomain(c);
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
