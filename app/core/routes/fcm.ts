import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import authRequired from "../utils/auth.ts";
import { getEnv } from "@takos/config";
import { registerToken, unregisterToken } from "../services/fcm.ts";

const app = new Hono();

app.use("/fcm/*", authRequired);

app.post(
  "/fcm/token",
  zValidator("json", z.object({ token: z.string(), userName: z.string() })),
  async (c) => {
    const { token, userName } = c.req.valid("json") as {
      token: string;
      userName: string;
    };
    const env = getEnv(c);
    await registerToken(token, userName, env);
    return c.json({ success: true });
  },
);

app.delete(
  "/fcm/token",
  zValidator("json", z.object({ token: z.string() })),
  async (c) => {
    const { token } = c.req.valid("json") as { token: string };
    const env = getEnv(c);
    await unregisterToken(token, env);
    return c.json({ success: true });
  },
);

export default app;
