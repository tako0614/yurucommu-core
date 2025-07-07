import { Hono } from "hono";
import { getDomain } from "./utils/activitypub.ts";
import { getUserInfo, getUserInfoBatch } from "./services/user-info.ts";
import authRequired from "./utils/auth.ts";

const app = new Hono();
app.use("*", authRequired);

// 単一ユーザー情報取得API
app.get("/user-info/:identifier", async (c) => {
  try {
    const domain = getDomain(c);
    const identifier = c.req.param("identifier");

    if (!identifier) {
      return c.json({ error: "User identifier is required" }, 400);
    }

    const userInfo = await getUserInfo(identifier, domain);

    return c.json(userInfo);
  } catch (error) {
    console.error("Error fetching user info:", error);
    return c.json({ error: "Failed to fetch user info" }, 500);
  }
});

// 複数ユーザー情報バッチ取得API
app.post("/user-info/batch", async (c) => {
  try {
    const domain = getDomain(c);
    const { identifiers } = await c.req.json();

    if (!Array.isArray(identifiers) || identifiers.length === 0) {
      return c.json({ error: "Valid identifiers array is required" }, 400);
    }

    // 最大100件に制限
    if (identifiers.length > 100) {
      return c.json({ error: "Too many identifiers (max 100)" }, 400);
    }

    const userInfos = await getUserInfoBatch(identifiers, domain);

    return c.json(userInfos);
  } catch (error) {
    console.error("Error fetching user info batch:", error);
    return c.json({ error: "Failed to fetch user info batch" }, 500);
  }
});

export default app;
