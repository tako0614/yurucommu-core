import { initializeApp } from "firebase/app";
import {
  getMessaging,
  getToken,
  type Messaging,
  onMessage,
} from "firebase/messaging";
import { apiFetch } from "./config.ts";

let firebaseConfig: Record<string, unknown> | null = null;
let vapidKey: string | null = null;

async function loadConfig(): Promise<Record<string, unknown> | null> {
  if (firebaseConfig) return firebaseConfig;
  try {
    const res = await apiFetch("/api/fcm/config");
    if (res.ok) {
      const data = await res.json();
      firebaseConfig = data.firebase ?? null;
      vapidKey = data.vapidKey ?? null;
    }
  } catch {
    /* ignore */
  }
  return firebaseConfig;
}

let messaging: Messaging | null = null;

async function ensureMessaging(): Promise<Messaging> {
  if (messaging) return messaging;
  const config = await loadConfig();
  if (!config) throw new Error("firebase config not loaded");
  const app = initializeApp(config as Record<string, string>);
  messaging = getMessaging(app);
  const reg = await navigator.serviceWorker.register(
    "/firebase-messaging-sw.js",
  );
  reg.active?.postMessage({ type: "config", config });
  return messaging;
}

export async function requestFcmToken(): Promise<string | null> {
  try {
    const msg = await ensureMessaging();
    const token = await getToken(msg, {
      vapidKey: vapidKey ?? undefined,
      serviceWorkerRegistration:
        await navigator.serviceWorker.getRegistration() ?? undefined,
    });
    return token;
  } catch (err) {
    console.error("FCMトークンの取得に失敗しました", err);
    return null;
  }
}

export async function onForegroundMessage(handler: (payload: unknown) => void) {
  const msg = await ensureMessaging();
  onMessage(msg, handler);
}
