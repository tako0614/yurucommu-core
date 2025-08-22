import { initializeApp } from "firebase/app";
import {
  getMessaging,
  getToken,
  type Messaging,
  onMessage,
} from "firebase/messaging";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { apiFetch } from "./config.ts";

const swUrl = new URL("../firebase-messaging-sw.ts", import.meta.url).href;

let firebaseConfig: Record<string, unknown> | null = null;
let vapidKey: string | null = null;
const isTauri = typeof window !== "undefined" && "__TAURI_IPC__" in window;

function isValidVapidKey(key: string): boolean {
  try {
    const base64 = key.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
    const bin = atob(padded);
    return bin.length === 65;
  } catch {
    return false;
  }
}

async function loadConfig(): Promise<Record<string, unknown> | null> {
  if (firebaseConfig) return firebaseConfig;
  try {
    const res = await apiFetch("/api/config");
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
  // During local development Vite serves TS files directly and the browser
  // may try to fetch the `.ts` service worker script which can fail under
  // some host/config setups (CORS, unknown content type). Skip registering
  // the service worker in dev to avoid that error. In Tauri or production
  // we register normally.
  if (!import.meta.env.DEV && !isTauri && 'serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.register(swUrl, {
      type: "module",
    });
    reg.active?.postMessage({ type: "config", config });
  }
  return messaging;
}

export async function requestFcmToken(): Promise<string | null> {
  if (isTauri) {
    try {
      const token = await invoke<string>(
        "plugin:push-notifications|execute",
      );
      return token;
    } catch (err) {
      console.error("FCMトークンの取得に失敗しました", err);
      return null;
    }
  }
  try {
    const msg = await ensureMessaging();
    if (vapidKey && !isValidVapidKey(vapidKey)) {
      console.error("VAPIDキーが不正です");
      return null;
    }
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
  if (isTauri) {
    listen("push", ({ payload }) => {
      handler(payload);
    });
    return;
  }
  const msg = await ensureMessaging();
  onMessage(msg, handler);
}
