import { Hono } from "hono";
import { getEnv } from "./utils/env_store.ts";

const app = new Hono();

app.get("/config", (c) => {
  const env = getEnv(c);
  const host = env["OAUTH_HOST"] ?? env["ROOT_DOMAIN"] ?? null;
  const clientId = env["OAUTH_CLIENT_ID"] ?? null;
  const clientSecret = env["OAUTH_CLIENT_SECRET"] ?? null;
  let firebaseConfig: unknown = null;
  if (env["FIREBASE_CLIENT_CONFIG"]) {
    try {
      firebaseConfig = JSON.parse(env["FIREBASE_CLIENT_CONFIG"]);
    } catch {
      firebaseConfig = null;
    }
  }
  return c.json({
    oauthHost: host,
    oauthClientId: clientId,
    oauthClientSecret: clientSecret,
    firebaseConfig,
  });
});

export default app;
