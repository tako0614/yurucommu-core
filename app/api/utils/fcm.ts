import { App, cert, initializeApp } from "npm:firebase-admin/app";
import { getMessaging } from "npm:firebase-admin/messaging";

let app: App | null = null;

function getApp(serviceAccount: Record<string, unknown>): App {
  if (!app) {
    app = initializeApp({ credential: cert(serviceAccount) });
  }
  return app;
}

export async function sendFCM(
  serviceAccount: Record<string, unknown>,
  token: string,
  data: Record<string, unknown>,
): Promise<void> {
  const messaging = getMessaging(getApp(serviceAccount));
  const json = JSON.stringify(data);
  const CHUNK_SIZE = 3500; // FCM data payload limit is 4096 bytes
  const msgData: Record<string, string> = {};
  if (json.length <= CHUNK_SIZE) {
    msgData.payload = json;
  } else {
    for (let i = 0, idx = 0; i < json.length; i += CHUNK_SIZE, idx++) {
      msgData[`payload${idx}`] = json.slice(i, i + CHUNK_SIZE);
    }
  }
  await messaging.send({ token, data: msgData });
}
