import { Hono } from "hono";
import { Env } from "./index.ts";
import {
  ActivityPubActor,
  ActivityPubObject,
  Follow,
} from "./models/activitypub.ts";
import { Account } from "./models/account.ts";
import { deliverActivity, getActor } from "./utils/activitypub.ts";
import { getCookie } from "hono/cookie";
import { Session } from "./models/sessions.ts";

const app = new Hono<{ Bindings: Env }>();

// 認証ミドルウェア
app.use("*", async (c, next) => {
  const sessionToken = getCookie(c, "session_token");
  if (!sessionToken) {
    return c.json({ success: false, error: "認証されていません" }, 401);
  }
  const session = await Session.findOne({
    token: sessionToken,
    expiresAt: { $gt: new Date() },
  });
  if (!session) {
    return c.json({ success: false, error: "セッションが無効です" }, 401);
  }
  await next();
});

// ActivityPub オブジェクト送信
app.post("/send", async (c) => {
  try {
    const { userId, activity } = await c.req.json();

    const account = await Account.findById(userId);
    if (!account) {
      return c.json(
        { success: false, error: "アカウントが見つかりません" },
        404,
      );
    }

    // アクティビティにIDを割り当て
    if (!activity.id) {
      activity.id =
        `https://${c.env.ACTIVITYPUB_DOMAIN}/activities/${crypto.randomUUID()}`;
    }
    activity.actor = account.activityPubActor.id;
    activity.published = activity.published || new Date().toISOString();

    // データベースに保存
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

    // 配信先を計算して配信
    const deliveryTargets = new Set<string>();
    [...(activity.to || []), ...(activity.cc || [])].forEach((target) => {
      if (
        typeof target === "string" &&
        !target.startsWith(`https://${c.env.ACTIVITYPUB_DOMAIN}/`)
      ) {
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

    return c.json({ success: true, id: activity.id });
  } catch (error) {
    console.error("Send activity error:", error);
    return c.json({
      success: false,
      error: "アクティビティの送信に失敗しました",
    }, 500);
  }
});

// ActivityPub オブジェクト読み取り
app.get("/read/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const activity = await ActivityPubObject.findOne({ id });

    if (!activity) {
      return c.json(
        { success: false, error: "アクティビティが見つかりません" },
        404,
      );
    }

    return c.json({ success: true, data: activity.rawObject });
  } catch (error) {
    console.error("Read activity error:", error);
    return c.json({
      success: false,
      error: "アクティビティの読み取りに失敗しました",
    }, 500);
  }
});

// ActivityPub オブジェクト削除
app.delete("/delete/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const activity = await ActivityPubObject.findOneAndDelete({
      id,
      isLocal: true,
    });

    if (!activity) {
      return c.json(
        { success: false, error: "アクティビティが見つかりません" },
        404,
      );
    } // Delete アクティビティを作成して配信
    const account = await Account.findById(activity.userId);
    if (account) {
      const _deleteActivity = {
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Delete",
        id:
          `https://${c.env.ACTIVITYPUB_DOMAIN}/activities/${crypto.randomUUID()}`,
        actor: account.activityPubActor.id,
        object: {
          type: "Tombstone",
          id: activity.id,
          formerType: activity.type,
          deleted: new Date().toISOString(),
        },
        published: new Date().toISOString(),
      };

      // 配信処理（省略）
    }

    return c.json({ success: true, message: "アクティビティを削除しました" });
  } catch (error) {
    console.error("Delete activity error:", error);
    return c.json({
      success: false,
      error: "アクティビティの削除に失敗しました",
    }, 500);
  }
});

// ActivityPub オブジェクト一覧
app.get("/list", async (c) => {
  try {
    const userId = c.req.query("userId");
    const page = parseInt(c.req.query("page") || "1");
    const limit = parseInt(c.req.query("limit") || "20");
    const skip = (page - 1) * limit;
    const query: Record<string, unknown> = {};
    if (userId) {
      query.userId = userId;
    }

    const activities = await ActivityPubObject.find(query)
      .sort({ published: -1 })
      .skip(skip)
      .limit(limit)
      .select("id type actor published");

    return c.json({
      success: true,
      data: activities.map((a) => a.id),
    });
  } catch (error) {
    console.error("List activities error:", error);
    return c.json({
      success: false,
      error: "アクティビティ一覧の取得に失敗しました",
    }, 500);
  }
});

// アクター読み取り
app.get("/actor/read/:userId", async (c) => {
  try {
    const userId = c.req.param("userId");
    const account = await Account.findById(userId);

    if (!account) {
      return c.json(
        { success: false, error: "アカウントが見つかりません" },
        404,
      );
    }

    return c.json({ success: true, data: account.activityPubActor });
  } catch (error) {
    console.error("Read actor error:", error);
    return c.json(
      { success: false, error: "アクターの読み取りに失敗しました" },
      500,
    );
  }
});

// アクター更新
app.put("/actor/update/:userId", async (c) => {
  try {
    const userId = c.req.param("userId");
    const { key, value } = await c.req.json();

    const account = await Account.findById(userId);
    if (!account) {
      return c.json(
        { success: false, error: "アカウントが見つかりません" },
        404,
      );
    }

    // ActivityPub アクターの特定フィールドを更新
    account.activityPubActor[key] = value;
    account.markModified("activityPubActor");
    await account.save();

    return c.json({ success: true, message: "アクターを更新しました" });
  } catch (error) {
    console.error("Update actor error:", error);
    return c.json(
      { success: false, error: "アクターの更新に失敗しました" },
      500,
    );
  }
});

// フォロー
app.post("/follow", async (c) => {
  try {
    const { followerId, followeeId } = await c.req.json();

    const followerAccount = await Account.findById(followerId);
    if (!followerAccount) {
      return c.json({
        success: false,
        error: "フォロワーアカウントが見つかりません",
      }, 404);
    }

    // フォローアクティビティを作成
    const followActivity = {
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Follow",
      id:
        `https://${c.env.ACTIVITYPUB_DOMAIN}/activities/${crypto.randomUUID()}`,
      actor: followerAccount.activityPubActor.id,
      object: followeeId,
      published: new Date().toISOString(),
    };

    // データベースに保存
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

    // フォロー関係を作成
    await Follow.create({
      follower: followerAccount.activityPubActor.id,
      following: followeeId,
      accepted: false,
      activityId: followActivity.id,
    }); // フォロー先のInboxに配信
    const targetActor = await getActor(followeeId, c.env.ACTIVITYPUB_DOMAIN);
    if (targetActor && targetActor.inbox) {
      await deliverActivity(
        followActivity,
        targetActor.inbox,
        `${followerAccount.activityPubActor.id}#main-key`,
        followerAccount.privateKeyPem,
      );
    }

    return c.json({ success: true, id: followActivity.id });
  } catch (error) {
    console.error("Follow error:", error);
    return c.json({ success: false, error: "フォローに失敗しました" }, 500);
  }
});

// アンフォロー
app.post("/unfollow", async (c) => {
  try {
    const { followerId, followeeId } = await c.req.json();

    const followerAccount = await Account.findById(followerId);
    if (!followerAccount) {
      return c.json({
        success: false,
        error: "フォロワーアカウントが見つかりません",
      }, 404);
    }

    // 既存のフォロー関係を取得
    const existingFollow = await Follow.findOne({
      follower: followerAccount.activityPubActor.id,
      following: followeeId,
    });

    if (!existingFollow) {
      return c.json(
        { success: false, error: "フォロー関係が見つかりません" },
        404,
      );
    }

    // Undo アクティビティを作成
    const undoActivity = {
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Undo",
      id:
        `https://${c.env.ACTIVITYPUB_DOMAIN}/activities/${crypto.randomUUID()}`,
      actor: followerAccount.activityPubActor.id,
      object: {
        type: "Follow",
        id: existingFollow.activityId,
        actor: followerAccount.activityPubActor.id,
        object: followeeId,
      },
      published: new Date().toISOString(),
    };

    // フォロー関係を削除
    await Follow.deleteOne({ _id: existingFollow._id }); // Undo アクティビティを配信
    const targetActor = await getActor(followeeId, c.env.ACTIVITYPUB_DOMAIN);
    if (targetActor && targetActor.inbox) {
      await deliverActivity(
        undoActivity,
        targetActor.inbox,
        `${followerAccount.activityPubActor.id}#main-key`,
        followerAccount.privateKeyPem,
      );
    }

    return c.json({ success: true, id: undoActivity.id });
  } catch (error) {
    console.error("Unfollow error:", error);
    return c.json({ success: false, error: "アンフォローに失敗しました" }, 500);
  }
});

// フォロワー一覧
app.get("/followers/:actorId", async (c) => {
  try {
    const actorId = c.req.param("actorId");

    const followers = await Follow.find({
      following: actorId,
      accepted: true,
    }).select("follower");

    return c.json({
      success: true,
      data: followers.map((f) => f.follower),
    });
  } catch (error) {
    console.error("List followers error:", error);
    return c.json({
      success: false,
      error: "フォロワー一覧の取得に失敗しました",
    }, 500);
  }
});

// フォロー中一覧
app.get("/following/:actorId", async (c) => {
  try {
    const actorId = c.req.param("actorId");

    const following = await Follow.find({
      follower: actorId,
      accepted: true,
    }).select("following");

    return c.json({
      success: true,
      data: following.map((f) => f.following),
    });
  } catch (error) {
    console.error("List following error:", error);
    return c.json({
      success: false,
      error: "フォロー中一覧の取得に失敗しました",
    }, 500);
  }
});


export default app;
