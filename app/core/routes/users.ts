import { type Context, Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { getDB } from "../db/mod.ts";
import { getDomain } from "../utils/activitypub.ts";
import { getUserInfo, getUserInfoBatch } from "../services/user-info.ts";
import {
  formatFollowList,
  UserNotFoundError,
} from "../services/follow-info.ts";
import { getActivityPubFollowCollection } from "./activitypub.ts";
import authRequired from "../utils/auth.ts";

const app = new Hono();
const auth = (c: Context, next: () => Promise<void>) =>
  authRequired(getDB(c))(c, next);
app.use("/users/*", auth);

// ユーザー詳細取得
app.get("/users/:acct", async (c) => {
  try {
    const domain = getDomain(c);
    const acct = c.req.param("acct");
    const db = getDB(c);

    const info = await getUserInfo(db, acct, domain);

    const user = info.isLocal
      ? await db.accounts.findByUserName(info.userName)
      : null;

    if (user) {
      // ユーザーの投稿数を取得
      const fullUrl = `https://${domain}/users/${info.userName}`;
      const postCount = (await db.posts.findNotes({
        attributedTo: fullUrl,
      }, {})).length;

      return c.json({
        userName: info.userName,
        displayName: info.displayName,
        avatarInitial: info.authorAvatar || user.avatarInitial ||
          "/api/image/people.png",
        domain: info.domain,
        followersCount: user.followers?.length || 0,
        followingCount: user.following?.length || 0,
        postCount,
      });
    }

    return c.json({
      userName: info.userName,
      displayName: info.displayName,
      avatarInitial: info.authorAvatar || "/api/image/people.png",
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
  zValidator("json", z.object({ accts: z.array(z.string()).min(1) })),
  async (c) => {
    try {
      const domain = getDomain(c);
      const { accts } = c.req.valid("json") as { accts: string[] };

      if (accts.length > 100) {
        return c.json({ error: "Too many accts (max 100)" }, 400);
      }

      const infos = await getUserInfoBatch(getDB(c), accts, domain);
      return c.json(infos);
    } catch (error) {
      console.error("Error fetching user info batch:", error);
      return c.json({ error: "Failed to fetch user info batch" }, 500);
    }
  },
);

// フォロワー一覧取得
app.get("/users/:username/followers", async (c) => {
  const username = c.req.param("username");
  try {
    const domain = getDomain(c);
    const db = getDB(c);
    const collection = await getActivityPubFollowCollection(
      db,
      username,
      "followers",
      "1",
      domain,
    );
    const list = Array.isArray(collection.orderedItems)
      ? collection.orderedItems as string[]
      : [];
    const data = await formatFollowList(db, list, domain);
    return c.json(data);
  } catch (error) {
    if (error instanceof UserNotFoundError) {
      console.warn("User not found", username);
      return c.json({ error: "User not found" }, 404);
    }
    console.error("Error fetching followers:", error);
    return c.json({ error: "Failed to fetch followers" }, 500);
  }
});

// フォロイング一覧取得
app.get("/users/:username/following", async (c) => {
  const username = c.req.param("username");
  try {
    const domain = getDomain(c);
    const db = getDB(c);
    const collection = await getActivityPubFollowCollection(
      db,
      username,
      "following",
      "1",
      domain,
    );
    const list = Array.isArray(collection.orderedItems)
      ? collection.orderedItems as string[]
      : [];
    const data = await formatFollowList(db, list, domain);
    return c.json(data);
  } catch (error) {
    if (error instanceof UserNotFoundError) {
      console.warn("User not found", username);
      return c.json({ error: "User not found" }, 404);
    }
    console.error("Error fetching following:", error);
    return c.json({ error: "Failed to fetch following" }, 500);
  }
});

export default app;
