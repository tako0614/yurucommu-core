import { Hono } from "hono";
import { getEnv } from "../../shared/config.ts";
import { parseFirebaseClientConfig } from "../../shared/firebase_config.ts";

const app = new Hono();

app.get("/config", (c) => {
  const env = getEnv(c);
  const host = env["OAUTH_HOST"] ?? env["ROOT_DOMAIN"] ?? null;
  const clientId = env["OAUTH_CLIENT_ID"] ?? null;
  const clientSecret = env["OAUTH_CLIENT_SECRET"] ?? null;
  const firebaseConfig = parseFirebaseClientConfig(env);
  return c.json({
    oauthHost: host,
    oauthClientId: clientId,
    oauthClientSecret: clientSecret,
    firebaseConfig,
  });
});

export default app;
