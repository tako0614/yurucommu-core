import { Hono } from "hono";
import { getEnv } from "./utils/env_store.ts";

const app = new Hono();

app.get("/config", (c) => {
  const env = getEnv(c);
  const host = env["OAUTH_HOST"] ?? env["ROOT_DOMAIN"] ?? null;
  const clientId = env["OAUTH_CLIENT_ID"] ?? null;
  const clientSecret = env["OAUTH_CLIENT_SECRET"] ?? null;
  return c.json({
    oauthHost: host,
    oauthClientId: clientId,
    oauthClientSecret: clientSecret,
  });
});

export default app;
