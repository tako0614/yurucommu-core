import { dirname, fromFileUrl, join } from "@std/path";
import { loadConfig } from "../shared/config.ts";
import { getEnvPath } from "../shared/args.ts";

// コマンドライン引数から .env のパスを取得
const envPath = getEnvPath();
const defaultEnvPath = join(dirname(fromFileUrl(import.meta.url)), ".env");
const hostEnv = await loadConfig({ envPath: envPath ?? defaultEnvPath });

export const takosEnv: Record<string, string> = {
  DB_MODE: "host",
  MONGO_URI: hostEnv["MONGO_URI"],
  ROOT_DOMAIN: hostEnv["ROOT_DOMAIN"] ?? "",
  hashedPassword: "",
  salt: "",
  ACTIVITYPUB_DOMAIN: "",
  host: `https://${hostEnv["ROOT_DOMAIN"]}`,
  OAUTH_CLIENT_ID: "",
  OAUTH_CLIENT_SECRET: "",
  OBJECT_STORAGE_PROVIDER: "gridfs",
  LOCAL_STORAGE_DIR: "uploads",
  GRIDFS_BUCKET: "uploads",
  FIREBASE_CLIENT_EMAIL: hostEnv["FIREBASE_CLIENT_EMAIL"],
  FIREBASE_PRIVATE_KEY: hostEnv["FIREBASE_PRIVATE_KEY"],
  FIREBASE_API_KEY: hostEnv["FIREBASE_API_KEY"],
  FIREBASE_AUTH_DOMAIN: hostEnv["FIREBASE_AUTH_DOMAIN"],
  FIREBASE_PROJECT_ID: hostEnv["FIREBASE_PROJECT_ID"],
  FIREBASE_STORAGE_BUCKET: hostEnv["FIREBASE_STORAGE_BUCKET"],
  FIREBASE_MESSAGING_SENDER_ID: hostEnv["FIREBASE_MESSAGING_SENDER_ID"],
  FIREBASE_APP_ID: hostEnv["FIREBASE_APP_ID"],
  FIREBASE_VAPID_KEY: hostEnv["FIREBASE_VAPID_KEY"],
  RELAY_POLL_INTERVAL: "300000",
  ADSENSE_CLIENT: hostEnv["ADSENSE_CLIENT"],
  ADSENSE_SLOT: hostEnv["ADSENSE_SLOT"],
  ADSENSE_ACCOUNT: hostEnv["ADSENSE_ACCOUNT"],
};
