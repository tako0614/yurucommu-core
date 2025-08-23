import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import authRequired from "../utils/auth.ts";
import { getEnv } from "../../shared/config.ts";
import { createDB } from "../DB/mod.ts";
import { sendToUser } from "./ws.ts";
import { getUserInfo } from "../services/user-info.ts";

// DM 用のシンプルな REST エンドポイント

const app = new Hono();
app.use("/dm/*", authRequired);

app.post(
  "/dm",
  zValidator(
    "json",
    z.object({
      from: z.string(),
      to: z.string(),
      type: z.string(),
      content: z.string().optional(),
      attachments: z.array(
        z.object({
          url: z.string(),
          mediaType: z.string().optional(),
        }).passthrough(),
      ).optional(),
    }),
  ),
  async (c) => {
    const { from, to, type, content, attachments } = c.req.valid("json") as {
      from: string;
      to: string;
      type: string;
      content?: string;
      attachments?: Record<string, unknown>[];
    };
    const env = getEnv(c);
    const db = createDB(env);
    const domain = env["ACTIVITYPUB_DOMAIN"] ?? "";
    const [fromInfo, toInfo] = await Promise.all([
      getUserInfo(from, domain, env).catch(() => null),
      getUserInfo(to, domain, env).catch(() => null),
    ]);
    const payload = await db.saveDMMessage(
      from,
      to,
      type,
      content,
      attachments,
    );
    await Promise.all([
      db.createDirectMessage({
        owner: from,
        id: to,
        name: toInfo?.displayName || toInfo?.userName || to,
        icon: toInfo?.authorAvatar,
        members: [from, to],
      }),
      db.createDirectMessage({
        owner: to,
        id: from,
        name: fromInfo?.displayName || fromInfo?.userName || from,
        icon: fromInfo?.authorAvatar,
        members: [from, to],
      }),
    ]);
    sendToUser(to, { type: "dm", payload });
    sendToUser(from, { type: "dm", payload });
    return c.json(payload);
  },
);

app.get(
  "/dm",
  zValidator(
    "query",
    z.object({ user1: z.string(), user2: z.string() }),
  ),
  async (c) => {
    const { user1, user2 } = c.req.valid("query") as {
      user1: string;
      user2: string;
    };
    const db = createDB(getEnv(c));
    const messages = await db.listDMsBetween(user1, user2);
    return c.json(messages);
  },
);

export default app;
