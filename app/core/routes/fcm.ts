import { type Context, Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import authRequired from "../utils/auth.ts";
import { getDB } from "../db/mod.ts";
import { registerToken, unregisterToken } from "../services/fcm.ts";

const app = new Hono();
const auth = (c: Context, next: () => Promise<void>) =>
  authRequired(getDB(c))(c, next);

app.use("/fcm/*", auth);

app.post(
  "/fcm/token",
  zValidator("json", z.object({ token: z.string(), userName: z.string() })),
  async (c) => {
    const { token, userName } = c.req.valid("json") as {
      token: string;
      userName: string;
    };
    await registerToken(getDB(c), token, userName);
    return c.json({ success: true });
  },
);

app.delete(
  "/fcm/token",
  zValidator("json", z.object({ token: z.string() })),
  async (c) => {
    const { token } = c.req.valid("json") as { token: string };
    await unregisterToken(getDB(c), token);
    return c.json({ success: true });
  },
);

export default app;
