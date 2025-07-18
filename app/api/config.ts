import { Hono } from "hono";
import { getEnv } from "../../shared/config.ts";

const app = new Hono();

app.get("/config", (c) => {
  const env = getEnv(c);
  const host = env["OAUTH_HOST"] ?? env["ROOT_DOMAIN"] ?? null;
  const clientId = env["OAUTH_CLIENT_ID"] ?? null;
  const clientSecret = env["OAUTH_CLIENT_SECRET"] ?? null;
  let firebaseConfig: Record<string, string> | null = null;
  if (env["FIREBASE_CLIENT_CONFIG"]) {
    try {
      firebaseConfig = JSON.parse(env["FIREBASE_CLIENT_CONFIG"]);
    } catch {
      firebaseConfig = null;
    }
  } else {
    const keys = [
      "FIREBASE_API_KEY",
      "FIREBASE_AUTH_DOMAIN",
      "FIREBASE_PROJECT_ID",
      "FIREBASE_STORAGE_BUCKET",
      "FIREBASE_MESSAGING_SENDER_ID",
      "FIREBASE_APP_ID",
    ];
    if (keys.every((k) => env[k])) {
      firebaseConfig = {
        apiKey: env["FIREBASE_API_KEY"],
        authDomain: env["FIREBASE_AUTH_DOMAIN"],
        projectId: env["FIREBASE_PROJECT_ID"],
        storageBucket: env["FIREBASE_STORAGE_BUCKET"],
        messagingSenderId: env["FIREBASE_MESSAGING_SENDER_ID"],
        appId: env["FIREBASE_APP_ID"],
      };
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
