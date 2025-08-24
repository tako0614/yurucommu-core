import { Hono } from "hono";
import { getEnv } from "../../shared/config.ts";
import { parseFirebaseClientConfig } from "../../shared/firebase_config.ts";

const app = new Hono();

app.get("/config", (c) => {
  const env = getEnv(c);
  const host = env["OAUTH_HOST"] ?? null;
  const clientId = env["OAUTH_CLIENT_ID"] ?? null;
  const clientSecret = env["OAUTH_CLIENT_SECRET"] ?? null;
  const firebaseConfig = parseFirebaseClientConfig(env);
  const vapidKey = env["FIREBASE_VAPID_KEY"] ?? null;
  const adsenseClient = env["ADSENSE_CLIENT"] ?? null;
  const adsenseSlot = env["ADSENSE_SLOT"] ?? null;
  const adsenseAccount = env["ADSENSE_ACCOUNT"] ?? null;
  const domain = env["ACTIVITYPUB_DOMAIN"] ?? null;
  const groupConfig = {
    membershipPolicies: ["open", "approval"],
    visibilities: ["public", "private"],
  };
  return c.json({
    oauthHost: host,
    oauthClientId: clientId,
    oauthClientSecret: clientSecret,
    firebase: firebaseConfig,
    vapidKey,
    adsenseClient,
    adsenseSlot,
    adsenseAccount,
    domain,
    groupConfig,
  });
});

export default app;
