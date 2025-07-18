import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import authRequired from "./utils/auth.ts";
import { getEnv } from "./utils/env_store.ts";
import { registerToken, unregisterToken } from "./services/fcm.ts";

const app = new Hono();

app.use("/fcm/*", authRequired);

app.get("/fcm/config", (c) => {
  const env = getEnv(c);
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
  if (!firebaseConfig) return c.json({});
  return c.json({
    firebase: firebaseConfig,
    vapidKey: env["FIREBASE_VAPID_KEY"] ?? null,
  });
});

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
