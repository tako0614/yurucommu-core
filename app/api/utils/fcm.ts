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
  await messaging.send({ token, data: data as Record<string, string> });
}
