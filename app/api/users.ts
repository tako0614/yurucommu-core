import { Hono } from "hono";
import Account from "./models/account.ts";
import { findObjects } from "./services/unified_store.ts";
import {
  createFollowActivity,
  createUndoFollowActivity,
  getDomain,
} from "./utils/activitypub.ts";
import {
  formatUserInfoForPost,
  getUserInfoBatch,
} from "./services/user-info.ts";
import authRequired from "./utils/auth.ts";

const app = new Hono();
app.use("*", authRequired);

// ユーザー検索
app.get("/users/search", async (c) => {
  try {
    const query = c.req.query("q");
    if (!query || typeof query !== "string") {
      return c.json({ error: "Search query is required" }, 400);
    }

    const domain = getDomain(c);
    const users = await Account.find({
      $or: [
        { userName: { $regex: query, $options: "i" } },
        { displayName: { $regex: query, $options: "i" } },
      ],
    }).limit(20).lean();

    const formatted = users.map((user) => ({
      userName: user.userName,
      displayName: user.displayName,
      avatarInitial: user.avatarInitial || "",
      domain,
      followersCount: user.followers?.length || 0,
      followingCount: user.following?.length || 0,
    }));

    return c.json(formatted);
  } catch (error) {
    console.error("Error searching users:", error);
    return c.json({ error: "Failed to search users" }, 500);
  }
});

// ユーザー詳細取得
app.get("/users/:username", async (c) => {
  try {
    const domain = getDomain(c);
    const username = c.req.param("username");
    const user = await Account.findOne({ userName: username }).lean();

    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    // ユーザーの投稿数を取得
    const env = getEnv(c);
    const postCount = (
      await findObjects(env, { attributedTo: username, type: "Note" })
    ).length;

    return c.json({
      userName: user.userName,
      displayName: user.displayName,
      avatarInitial: user.avatarInitial || "",
      domain,
      followersCount: user.followers?.length || 0,
      followingCount: user.following?.length || 0,
      postCount,
    });
  } catch (error) {
    console.error("Error fetching user:", error);
    return c.json({ error: "Failed to fetch user" }, 500);
  }
});

// フォロー
app.post("/users/:username/follow", async (c) => {
  try {
    const domain = getDomain(c);
    const targetUsername = c.req.param("username");
    const { followerUsername } = await c.req.json();

    if (typeof followerUsername !== "string") {
      return c.json({ error: "Follower username is required" }, 400);
    }

    if (targetUsername === followerUsername) {
      return c.json({ error: "Cannot follow yourself" }, 400);
    }

    // フォロー対象のユーザーを確認
    const targetUser = await Account.findOne({ userName: targetUsername });
    if (!targetUser) {
      return c.json({ error: "Target user not found" }, 404);
    }

    // フォロワーのユーザーを確認
    const followerUser = await Account.findOne({ userName: followerUsername });
    if (!followerUser) {
      return c.json({ error: "Follower user not found" }, 404);
    }

    // 既にフォローしているかチェック
    const isAlreadyFollowing = followerUser.following?.includes(
      `https://${domain}/users/${targetUsername}`,
    ) || false;
    if (isAlreadyFollowing) {
      return c.json({ error: "Already following this user" }, 409);
    }

    // フォロー関係を更新
    await Account.updateOne(
      { userName: followerUsername },
      { $addToSet: { following: `https://${domain}/users/${targetUsername}` } },
    );

    await Account.updateOne(
      { userName: targetUsername },
      {
        $addToSet: { followers: `https://${domain}/users/${followerUsername}` },
      },
    );

    // ActivityPub Follow アクティビティを作成・配信
    const _followActivity = createFollowActivity(
      domain,
      `https://${domain}/users/${followerUsername}`,
      `https://${domain}/users/${targetUsername}`,
    );

    // 現在はローカルユーザーのみサポート（リモートユーザー対応は将来実装）
    // ActivityPub Follow アクティビティはすでに作成済み

    return c.json({ success: true, message: "Successfully followed user" });
  } catch (error) {
    console.error("Error following user:", error);
    return c.json({ error: "Failed to follow user" }, 500);
  }
});

// アンフォロー
app.post("/users/:username/unfollow", async (c) => {
  try {
    const domain = getDomain(c);
    const targetUsername = c.req.param("username");
    const { followerUsername } = await c.req.json();

    if (typeof followerUsername !== "string") {
      return c.json({ error: "Follower username is required" }, 400);
    }

    // フォロー関係を削除
    await Account.updateOne(
      { userName: followerUsername },
      { $pull: { following: `https://${domain}/users/${targetUsername}` } },
    );

    await Account.updateOne(
      { userName: targetUsername },
      { $pull: { followers: `https://${domain}/users/${followerUsername}` } },
    );

    // ActivityPub Undo Follow アクティビティを作成・配信
    const _undoFollowActivity = createUndoFollowActivity(
      domain,
      `https://${domain}/users/${followerUsername}`,
      `https://${domain}/users/${targetUsername}`,
    );

    // 現在はローカルユーザーのみサポート（リモートユーザー対応は将来実装）
    // ActivityPub Undo Follow アクティビティはすでに作成済み

    return c.json({ success: true, message: "Successfully unfollowed user" });
  } catch (error) {
    console.error("Error unfollowing user:", error);
    return c.json({ error: "Failed to unfollow user" }, 500);
  }
});

// フォロワー一覧取得
app.get("/users/:username/followers", async (c) => {
  try {
    const domain = getDomain(c);
    const username = c.req.param("username");
    const user = await Account.findOne({ userName: username }).lean();

    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    const followers = user.followers || [];
    const followerData = [];

    for (const followerUrl of followers) {
      try {
        // ローカルユーザーの場合
        if (followerUrl.includes(domain)) {
          const followerUsername = followerUrl.split("/").pop();
          const followerUser = await Account.findOne({
            userName: followerUsername,
          }).lean();
          if (followerUser) {
            followerData.push({
              userName: followerUser.userName,
              displayName: followerUser.displayName,
              avatarInitial: followerUser.avatarInitial || "",
              domain,
            });
          }
        } else {
          // リモートユーザーの場合（簡易実装）
          const followerUsername = followerUrl.split("/").pop();
          const followerDomain = new URL(followerUrl).host;
          followerData.push({
            userName: followerUsername,
            displayName: followerUsername,
            avatarInitial: "",
            domain: followerDomain,
          });
        }
      } catch (error) {
        console.error("Error processing follower:", error);
        continue;
      }
    }

    return c.json(followerData);
  } catch (error) {
    console.error("Error fetching followers:", error);
    return c.json({ error: "Failed to fetch followers" }, 500);
  }
});

// フォロイング一覧取得
app.get("/users/:username/following", async (c) => {
  try {
    const domain = getDomain(c);
    const username = c.req.param("username");
    const user = await Account.findOne({ userName: username }).lean();

    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    const following = user.following || [];
    const followingData = [];

    for (const followingUrl of following) {
      try {
        // ローカルユーザーの場合
        if (followingUrl.includes(domain)) {
          const followingUsername = followingUrl.split("/").pop();
          const followingUser = await Account.findOne({
            userName: followingUsername,
          }).lean();
          if (followingUser) {
            followingData.push({
              userName: followingUser.userName,
              displayName: followingUser.displayName,
              avatarInitial: followingUser.avatarInitial || "",
              domain,
            });
          }
        } else {
          // リモートユーザーの場合（簡易実装）
          const followingUsername = followingUrl.split("/").pop();
          const followingDomain = new URL(followingUrl).host;
          followingData.push({
            userName: followingUsername,
            displayName: followingUsername,
            avatarInitial: "",
            domain: followingDomain,
          });
        }
      } catch (error) {
        console.error("Error processing following:", error);
        continue;
      }
    }

    return c.json(followingData);
  } catch (error) {
    console.error("Error fetching following:", error);
    return c.json({ error: "Failed to fetch following" }, 500);
  }
});

// フォロー中ユーザーの投稿取得
app.get("/users/:username/timeline", async (c) => {
  try {
    const domain = getDomain(c);
    const username = c.req.param("username");
    const user = await Account.findOne({ userName: username }).lean();

    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    const following = user.following || [];
    const followingUsernames = following
      .filter((url: string | string[]) => url.includes(domain))
      .map((url: string) => url.split("/").pop())
      .filter(Boolean);

    // フォロー中ユーザーの投稿を取得
    const env = getEnv(c);
    const posts = await findObjects(
      env,
      {
        type: "Note",
        attributedTo: { $in: followingUsernames },
      },
      { published: -1 },
    );
    const limited = posts.slice(0, 50);

    // ユーザー情報をバッチで取得
    const identifiers = limited.map((post) => post.attributedTo as string);
    const userInfos = await getUserInfoBatch(identifiers, domain);

    const formatted = limited.map(
      (post: Record<string, unknown>, index: number) => {
        const userInfo = userInfos[index];
        return formatUserInfoForPost(userInfo, post);
      },
    );

    return c.json(formatted);
  } catch (error) {
    console.error("Error fetching timeline:", error);
    return c.json({ error: "Failed to fetch timeline" }, 500);
  }
});

export default app;
