import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { createDB } from "../DB/mod.ts";
import { getEnv } from "../../shared/config.ts";
import { getDomain } from "../utils/activitypub.ts";
import { getUserInfo, getUserInfoBatch } from "../services/user-info.ts";
import authRequired from "../utils/auth.ts";

const app = new Hono();
app.use("/users/*", authRequired);

// ユーザー検索
app.get("/users/search", async (c) => {
  try {
    const query = c.req.query("q");
    if (!query || typeof query !== "string") {
      return c.json({ error: "Search query is required" }, 400);
    }

    const domain = getDomain(c);
    const regex = new RegExp(query, "i");
    const db = createDB(getEnv(c));
    const users = await db.searchAccounts(regex, 20);

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
app.get("/users/:identifier", async (c) => {
  try {
    const domain = getDomain(c);
    const identifier = c.req.param("identifier");
    const env = getEnv(c);
    const db = createDB(env);

    const info = await getUserInfo(identifier, domain, env);

    const user = info.isLocal
      ? await db.findAccountByUserName(info.userName)
      : null;

    if (user) {
      // ユーザーの投稿数を取得
      const postCount =
        (await db.findNotes({ attributedTo: info.userName }, {})).length;

      return c.json({
        userName: info.userName,
        displayName: info.displayName,
        avatarInitial: info.authorAvatar || user.avatarInitial || "",
        domain: info.domain,
        followersCount: user.followers?.length || 0,
        followingCount: user.following?.length || 0,
        postCount,
      });
    }

    return c.json({
      userName: info.userName,
      displayName: info.displayName,
      avatarInitial: info.authorAvatar,
      domain: info.domain,
      followersCount: 0,
      followingCount: 0,
      postCount: 0,
    });
  } catch (error) {
    console.error("Error fetching user:", error);
    return c.json({ error: "Failed to fetch user" }, 500);
  }
});

// ユーザー情報バッチ取得
app.post(
  "/users/batch",
  zValidator("json", z.object({ identifiers: z.array(z.string()).min(1) })),
  async (c) => {
    try {
      const domain = getDomain(c);
      const { identifiers } = c.req.valid("json") as { identifiers: string[] };

      if (identifiers.length > 100) {
        return c.json({ error: "Too many identifiers (max 100)" }, 400);
      }

      const infos = await getUserInfoBatch(identifiers, domain, getEnv(c));
      return c.json(infos);
    } catch (error) {
      console.error("Error fetching user info batch:", error);
      return c.json({ error: "Failed to fetch user info batch" }, 500);
    }
  },
);

// フォロワー一覧取得
app.get("/users/:username/followers", async (c) => {
  try {
    const domain = getDomain(c);
    const username = c.req.param("username");
    const env = getEnv(c);
    const user = await createDB(env).findAccountByUserName(username);

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
          const followerUser = await createDB(env).findAccountByUserName(
            followerUsername ?? "",
          );
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
    const env = getEnv(c);
    const user = await createDB(env).findAccountByUserName(username);

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
          const followingUser = await createDB(env).findAccountByUserName(
            followingUsername ?? "",
          );
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

export default app;
