import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { createDB } from "../DB/mod.ts";
import { getEnv } from "../../shared/config.ts";
import { getDomain } from "../utils/activitypub.ts";
import { getUserInfo, getUserInfoBatch } from "../services/user-info.ts";
import { formatFollowList } from "../services/follow-info.ts";
import { getActivityPubFollowCollection } from "./activitypub.ts";
import authRequired from "../utils/auth.ts";

const app = new Hono();
app.use("/users/*", authRequired);

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
      const fullUrl = `https://${domain}/users/${info.userName}`;
      const postCount = (await db.findNotes({
        $or: [
          { attributedTo: info.userName },
          { attributedTo: fullUrl },
        ],
      }, {})).length;

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
    const collection = await getActivityPubFollowCollection(
      username,
      "followers",
      "1",
      domain,
      env,
    );
    const list = Array.isArray(collection.orderedItems)
      ? collection.orderedItems as string[]
      : [];
    const data = await formatFollowList(list, domain, env);
    return c.json(data);
  } catch (error) {
    console.error("Error fetching followers:", error);
    if (error instanceof Error && error.message === "User not found") {
      return c.json({ error: "User not found" }, 404);
    }
    return c.json({ error: "Failed to fetch followers" }, 500);
  }
});

// フォロイング一覧取得
app.get("/users/:username/following", async (c) => {
  try {
    const domain = getDomain(c);
    const username = c.req.param("username");
    const env = getEnv(c);
    const collection = await getActivityPubFollowCollection(
      username,
      "following",
      "1",
      domain,
      env,
    );
    const list = Array.isArray(collection.orderedItems)
      ? collection.orderedItems as string[]
      : [];
    const data = await formatFollowList(list, domain, env);
    return c.json(data);
  } catch (error) {
    console.error("Error fetching following:", error);
    if (error instanceof Error && error.message === "User not found") {
      return c.json({ error: "User not found" }, 404);
    }
    return c.json({ error: "Failed to fetch following" }, 500);
  }
});

export default app;
