import { Hono } from "hono";
import { getEnv } from "./utils/env_store.ts";

const app = new Hono();

app.get("/config", (c) => {
  const env = getEnv(c);
  const host = env["OAUTH_HOST"] ?? env["ROOT_DOMAIN"] ?? null;
  return c.json({ oauthHost: host });
});

export default app;
