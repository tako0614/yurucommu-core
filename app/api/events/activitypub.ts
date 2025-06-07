import { z } from "zod";
import { eventManager } from "../eventManager.ts";
import { ActivityPubActor, ActivityPubObject, Follow } from "../models/activitypub.ts";
import { Account } from "../models/account.ts";
import { deliverActivity, getActor } from "../utils/activitypub.ts";
import { getCookie } from "hono/cookie";
import { Session } from "../models/sessions.ts";

async function requireAuth(c: any) {
  const sessionToken = getCookie(c, "session_token");
  if (!sessionToken) throw new Error("認証されていません");
  const session = await Session.findOne({ token: sessionToken, expiresAt: { $gt: new Date() } });
  if (!session) throw new Error("セッションが無効です");
  return session;
}

// ActivityPub オブジェクト送信
eventManager.add(
  "takos",
  "activitypub:send",
  z.object({ userId: z.string(), activity: z.object({}).passthrough() }),
  async (c, { userId, activity }) => {
    await requireAuth(c);
    const account = await Account.findById(userId);
    if (!account) throw new Error("アカウントが見つかりません");
    if (!activity.id) {
      activity.id = `https://${c.env.ACTIVITYPUB_DOMAIN}/activities/${crypto.randomUUID()}`;
    }
    activity.actor = account.activityPubActor.id;
    activity.published = activity.published || new Date().toISOString();

    await ActivityPubObject.create({
      id: activity.id,
      type: activity.type,
      actor: activity.actor,
      object: activity.object,
      target: activity.target,
      to: activity.to,
      cc: activity.cc,
      published: new Date(activity.published),
      content: activity.content,
      summary: activity.summary,
      rawObject: activity,
      isLocal: true,
      userId: account._id.toString(),
    });

    const deliveryTargets = new Set<string>();
    [...(activity.to || []), ...(activity.cc || [])].forEach((target) => {
      if (typeof target === "string" && !target.startsWith(`https://${c.env.ACTIVITYPUB_DOMAIN}/`)) {
        deliveryTargets.add(target);
      }
    });
    for (const target of deliveryTargets) {
      const targetActor = await getActor(target, c.env.ACTIVITYPUB_DOMAIN);
      if (targetActor && targetActor.inbox) {
        await deliverActivity(
          activity,
          targetActor.inbox,
          `${account.activityPubActor.id}#main-key`,
          account.privateKeyPem,
        );
      }
    }

    return { id: activity.id };
  },
);

// ActivityPub オブジェクト読み取り
eventManager.add(
  "takos",
  "activitypub:read",
  z.object({ id: z.string() }),
  async (_c, { id }) => {
    const activity = await ActivityPubObject.findOne({ id });
    if (!activity) throw new Error("アクティビティが見つかりません");
    return activity.rawObject;
  },
);

// ActivityPub オブジェクト削除
eventManager.add(
  "takos",
  "activitypub:delete",
  z.object({ id: z.string() }),
  async (c, { id }) => {
    await requireAuth(c);
    const activity = await ActivityPubObject.findOneAndDelete({ id, isLocal: true });
    if (!activity) throw new Error("アクティビティが見つかりません");
    const account = await Account.findById(activity.userId);
    if (account) {
      const delAct = {
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Delete",
        id: `https://${c.env.ACTIVITYPUB_DOMAIN}/activities/${crypto.randomUUID()}`,
        actor: account.activityPubActor.id,
        object: {
          type: "Tombstone",
          id: activity.id,
          formerType: activity.type,
          deleted: new Date().toISOString(),
        },
        published: new Date().toISOString(),
      };
      // 配信省略
    }
    return { message: "deleted" };
  },
);

// ActivityPub オブジェクト一覧
eventManager.add(
  "takos",
  "activitypub:list",
  z.object({ userId: z.string().optional(), page: z.number().optional(), limit: z.number().optional() }),
  async (_c, { userId, page = 1, limit = 20 }) => {
    const skip = (page - 1) * limit;
    const query: Record<string, unknown> = {};
    if (userId) query.userId = userId;
    const activities = await ActivityPubObject.find(query)
      .sort({ published: -1 })
      .skip(skip)
      .limit(limit)
      .select("id type actor published");
    return activities.map((a) => a.id);
  },
);

// アクター読み取り
eventManager.add(
  "takos",
  "activitypub:actor:read",
  z.object({ userId: z.string() }),
  async (_c, { userId }) => {
    const account = await Account.findById(userId);
    if (!account) throw new Error("アカウントが見つかりません");
    return account.activityPubActor;
  },
);

// アクター更新
eventManager.add(
  "takos",
  "activitypub:actor:update",
  z.object({ userId: z.string(), key: z.string(), value: z.any() }),
  async (c, { userId, key, value }) => {
    await requireAuth(c);
    const account = await Account.findById(userId);
    if (!account) throw new Error("アカウントが見つかりません");
    (account as any).activityPubActor[key] = value;
    account.markModified("activityPubActor");
    await account.save();
    return { message: "updated" };
  },
);

// フォロー
eventManager.add(
  "takos",
  "activitypub:follow",
  z.object({ followerId: z.string(), followeeId: z.string() }),
  async (c, { followerId, followeeId }) => {
    await requireAuth(c);
    const followerAccount = await Account.findById(followerId);
    if (!followerAccount) throw new Error("フォロワーアカウントが見つかりません");
    const followActivity = {
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Follow",
      id: `https://${c.env.ACTIVITYPUB_DOMAIN}/activities/${crypto.randomUUID()}`,
      actor: followerAccount.activityPubActor.id,
      object: followeeId,
      published: new Date().toISOString(),
    };
    await ActivityPubObject.create({
      id: followActivity.id,
      type: followActivity.type,
      actor: followActivity.actor,
      object: followActivity.object,
      published: new Date(followActivity.published),
      rawObject: followActivity,
      isLocal: true,
      userId: followerAccount._id.toString(),
    });
    await Follow.create({
      follower: followerAccount.activityPubActor.id,
      following: followeeId,
      accepted: false,
      activityId: followActivity.id,
    });
    const targetActor = await getActor(followeeId, c.env.ACTIVITYPUB_DOMAIN);
    if (targetActor && targetActor.inbox) {
      await deliverActivity(
        followActivity,
        targetActor.inbox,
        `${followerAccount.activityPubActor.id}#main-key`,
        followerAccount.privateKeyPem,
      );
    }
    return { id: followActivity.id };
  },
);

// アンフォロー
eventManager.add(
  "takos",
  "activitypub:unfollow",
  z.object({ followerId: z.string(), followeeId: z.string() }),
  async (c, { followerId, followeeId }) => {
    await requireAuth(c);
    const followerAccount = await Account.findById(followerId);
    if (!followerAccount) throw new Error("フォロワーアカウントが見つかりません");
    const existingFollow = await Follow.findOne({
      follower: followerAccount.activityPubActor.id,
      following: followeeId,
    });
    if (!existingFollow) throw new Error("フォロー関係が見つかりません");
    const undoActivity = {
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Undo",
      id: `https://${c.env.ACTIVITYPUB_DOMAIN}/activities/${crypto.randomUUID()}`,
      actor: followerAccount.activityPubActor.id,
      object: {
        type: "Follow",
        id: existingFollow.activityId,
        actor: followerAccount.activityPubActor.id,
        object: followeeId,
      },
      published: new Date().toISOString(),
    };
    await Follow.deleteOne({ _id: existingFollow._id });
    const targetActor = await getActor(followeeId, c.env.ACTIVITYPUB_DOMAIN);
    if (targetActor && targetActor.inbox) {
      await deliverActivity(
        undoActivity,
        targetActor.inbox,
        `${followerAccount.activityPubActor.id}#main-key`,
        followerAccount.privateKeyPem,
      );
    }
    return { id: undoActivity.id };
  },
);

// フォロワー一覧
eventManager.add(
  "takos",
  "activitypub:followers",
  z.object({ actorId: z.string() }),
  async (_c, { actorId }) => {
    const followers = await Follow.find({ following: actorId, accepted: true }).select("follower");
    return followers.map((f) => f.follower);
  },
);

// フォロー中一覧
eventManager.add(
  "takos",
  "activitypub:following",
  z.object({ actorId: z.string() }),
  async (_c, { actorId }) => {
    const following = await Follow.find({ follower: actorId, accepted: true }).select("following");
    return following.map((f) => f.following);
  },
);

