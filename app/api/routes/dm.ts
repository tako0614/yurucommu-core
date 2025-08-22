import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import authRequired from "../utils/auth.ts";
import { getEnv } from "../../shared/config.ts";
import { createDB } from "../DB/mod.ts";
import { sendToUser } from "./ws.ts";

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
      content: z.string(),
    }),
  ),
  async (c) => {
    const { from, to, content } = c.req.valid("json") as {
      from: string;
      to: string;
      content: string;
    };
    const db = createDB(getEnv(c));
    const doc = await db.saveDMMessage(from, to, content) as { _id: string };
    const payload = { id: doc._id, from, to, content };
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
