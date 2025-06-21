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
  const LIMIT = 3500; // FCM data payload limit is ~4096 bytes
  if (json.length > LIMIT) {
    throw new Error(
      `FCM payload too large: ${json.length} bytes (limit ${LIMIT})`,
    );
  }
  await messaging.send({ token, data: { payload: json } });
}
