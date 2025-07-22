import admin from "firebase-admin";
import { createDB } from "../db.ts";
import type { DB } from "../../shared/db.ts";

let initialized = false;

function init(env: Record<string, string>) {
  if (initialized) return;
  const saKeys = [
    "FIREBASE_PROJECT_ID",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY",
  ];
  if (!saKeys.every((k) => env[k])) return;
  const cred = {
    projectId: env["FIREBASE_PROJECT_ID"],
    clientEmail: env["FIREBASE_CLIENT_EMAIL"],
    privateKey: env["FIREBASE_PRIVATE_KEY"],
  };
  admin.initializeApp({ credential: admin.credential.cert(cred) });
  initialized = true;
}

export async function registerToken(
  token: string,
  userName: string,
  env: Record<string, string>,
  dbInst?: DB,
) {
  init(env);
  const db = dbInst ?? createDB(env);
  const collection = (await db.getDatabase()).collection("fcmtokens");
  await collection.updateOne(
    env["DB_MODE"] === "host"
      ? { token, tenant_id: env["ACTIVITYPUB_DOMAIN"] }
      : { token },
    { $set: { token, userName } },
    { upsert: true },
  );
}

export async function unregisterToken(
  token: string,
  env: Record<string, string>,
  dbInst?: DB,
) {
  const db = dbInst ?? createDB(env);
  const collection = (await db.getDatabase()).collection("fcmtokens");
  const cond = env["DB_MODE"] === "host"
    ? { token, tenant_id: env["ACTIVITYPUB_DOMAIN"] }
    : { token };
  await collection.deleteOne(cond);
}

export async function sendNotification(
  title: string,
  body: string,
  env: Record<string, string>,
  dbInst?: DB,
) {
  init(env);
  if (!initialized) return;
  const db = dbInst ?? createDB(env);
  const collection = (await db.getDatabase()).collection("fcmtokens");
  const cond = env["DB_MODE"] === "host"
    ? { tenant_id: env["ACTIVITYPUB_DOMAIN"] }
    : {};
  const list = await collection.find<{ token: string }>(cond).toArray();
  const tokens: string[] = list.map((t) => t.token);
  if (tokens.length === 0) return;
  await admin.messaging().sendEachForMulticast({
    tokens,
    notification: { title, body },
  });
}
