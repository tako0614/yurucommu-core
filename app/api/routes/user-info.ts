import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { getDomain } from "../utils/activitypub.ts";
import { getUserInfo, getUserInfoBatch } from "../services/user-info.ts";
import authRequired from "../utils/auth.ts";
import { getEnv } from "../../../shared/config.ts";
const app = new Hono();
app.use("/user-info/*", authRequired);

// 単一ユーザー情報取得API
app.get(
  "/user-info/:identifier",
  zValidator(
    "param",
    z.object({
      identifier: z.string().refine((id) => {
        if (id.startsWith("http")) return true;
        if (id.includes("@")) return /^[^@]+@[^@]+$/.test(id);
        return /^[A-Za-z0-9_-]+$/.test(id);
      }),
    }),
  ),
  async (c) => {
    try {
      const domain = getDomain(c);
      const { identifier } = c.req.valid("param") as { identifier: string };

      const userInfo = await getUserInfo(identifier, domain, getEnv(c));

      return c.json(userInfo);
    } catch (error) {
      console.error("Error fetching user info:", error);
      return c.json({ error: "Failed to fetch user info" }, 500);
    }
  },
);

// 複数ユーザー情報バッチ取得API
app.post(
  "/user-info/batch",
  zValidator("json", z.object({ identifiers: z.array(z.string()).min(1) })),
  async (c) => {
    try {
      const domain = getDomain(c);
      const { identifiers } = c.req.valid("json") as { identifiers: string[] };

      // 最大100件に制限
      if (identifiers.length > 100) {
        return c.json({ error: "Too many identifiers (max 100)" }, 400);
      }

      const userInfos = await getUserInfoBatch(identifiers, domain, getEnv(c));

      return c.json(userInfos);
    } catch (error) {
      console.error("Error fetching user info batch:", error);
      return c.json({ error: "Failed to fetch user info batch" }, 500);
    }
  },
);

export default app;
