import { initializeApp, getApps, getApp, type FirebaseApp, type FirebaseOptions } from "firebase/app";
import {
  getMessaging,
  getToken,
  isSupported,
  onMessage,
  type Messaging,
  type MessagePayload,
} from "firebase/messaging";
import { registerPushDevice, getFirebasePublicConfig, type FirebasePublicConfig } from "./api";

let messagingPromise: Promise<Messaging | null> | null = null;
let serviceWorkerPromise: Promise<ServiceWorkerRegistration | null> | null = null;
let cachedToken: string | null = null;
let foregroundListenerAttached = false;
type FirebaseClientConfig = FirebaseOptions & { vapidKey: string };

let firebaseConfigPromise: Promise<FirebaseClientConfig | null> | null = null;

function normaliseFirebaseConfig(config: FirebasePublicConfig | null): FirebaseClientConfig | null {
  if (!config) return null;
  const {
    apiKey,
    projectId,
    appId,
    messagingSenderId,
    vapidKey,
    authDomain,
    storageBucket,
  } = config;
  const required = [apiKey, projectId, appId, messagingSenderId, vapidKey];
  if (required.some((value) => typeof value !== "string" || !value.trim())) {
    return null;
  }
  // All required values are strings now; use non-null assertions safely
  const trimmed: FirebaseClientConfig = {
    apiKey: (apiKey as string).trim(),
    projectId: (projectId as string).trim(),
    appId: (appId as string).trim(),
    messagingSenderId: (messagingSenderId as string).trim(),
    vapidKey: (vapidKey as string).trim(),
  };
  if (typeof authDomain === "string" && authDomain.trim()) {
    trimmed.authDomain = authDomain.trim();
  }
  if (typeof storageBucket === "string" && storageBucket.trim()) {
    trimmed.storageBucket = storageBucket.trim();
  }
  return trimmed;
}

async function loadFirebaseConfig(): Promise<FirebaseClientConfig | null> {
  if (!firebaseConfigPromise) {
    firebaseConfigPromise = (async () => {
      try {
        const config = await getFirebasePublicConfig();
        return normaliseFirebaseConfig(config);
      } catch (error) {
        console.warn("failed to load firebase public config", error);
        return null;
      }
    })();
  }
  const result = await firebaseConfigPromise;
  if (!result) {
    firebaseConfigPromise = null;
  }
  return result;
}

function getOrInitFirebaseApp(config: FirebaseOptions): FirebaseApp | null {
  if (getApps().length > 0) {
    try {
      return getApp();
    } catch {
      // Fall through to initialize if getApp throws.
    }
  }
  return initializeApp(config);
}

function getServiceWorkerCandidate(registration: ServiceWorkerRegistration): ServiceWorker | null {
  return registration.active || registration.waiting || registration.installing || null;
}

async function waitForActivatedWorker(
  registration: ServiceWorkerRegistration,
): Promise<ServiceWorker | null> {
  const candidate = getServiceWorkerCandidate(registration);
  if (candidate && candidate.state === "activated") {
    return candidate;
  }
  return new Promise((resolve) => {
    const tracked = new Set<ServiceWorker>();
    const timeout = setTimeout(() => {
      cleanup();
      resolve(getServiceWorkerCandidate(registration));
    }, 10000);

    function cleanup() {
      clearTimeout(timeout);
      registration.removeEventListener("updatefound", onUpdateFound);
      for (const worker of tracked) {
        worker.removeEventListener("statechange", checkAndResolve);
      }
      tracked.clear();
    }

    function attach(worker: ServiceWorker | null) {
      if (!worker || tracked.has(worker)) return;
      worker.addEventListener("statechange", checkAndResolve);
      tracked.add(worker);
    }

    function checkAndResolve() {
      const worker = getServiceWorkerCandidate(registration);
      if (worker && worker.state === "activated") {
        cleanup();
        resolve(worker);
      }
    }

    function onUpdateFound() {
      attach(registration.installing);
      attach(registration.waiting);
      checkAndResolve();
    }

    attach(candidate);
    registration.addEventListener("updatefound", onUpdateFound);
    checkAndResolve();
  });
}

async function getOrRegisterServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!serviceWorkerPromise) {
    serviceWorkerPromise = (async () => {
      try {
        const existing = await navigator.serviceWorker.getRegistration(
          "/firebase-messaging-sw.js",
        );
        if (existing) return existing;
        return await navigator.serviceWorker.register("/firebase-messaging-sw.js", {
          scope: "/",
        });
      } catch (error) {
        console.warn("failed to register firebase messaging service worker", error);
        return null;
      }
    })();
  }
  const registration = await serviceWorkerPromise;
  if (!registration) {
    serviceWorkerPromise = null;
  }
  return registration;
}

async function ensureServiceWorker(config: FirebaseOptions): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }
  const registration = await getOrRegisterServiceWorker();
  if (!registration) return null;
  const worker = await waitForActivatedWorker(registration);
  if (worker) {
    try {
      worker.postMessage({
        type: "INIT_FIREBASE_MESSAGING",
        config,
      });
    } catch (error) {
      console.warn("failed to initialise firebase messaging worker", error);
    }
  }
  return registration;
}

async function ensureMessaging(): Promise<Messaging | null> {
  if (messagingPromise) return messagingPromise;
  if (typeof window === "undefined") return null;
  messagingPromise = (async () => {
    const supported = await isSupported().catch(() => false);
    if (!supported) return null;
    const config = await loadFirebaseConfig();
    if (!config) return null;
    const { vapidKey: _vapidKey, ...firebaseOptions } = config;
    const options: FirebaseOptions = firebaseOptions;
    const app = getOrInitFirebaseApp(options);
    if (!app) return null;
    const sw = await ensureServiceWorker(options);
    if (!sw) return null;
    const messaging = getMessaging(app);
    if (!foregroundListenerAttached) {
      onMessage(messaging, (payload: MessagePayload) => {
        const title = payload.notification?.title || "新しい通知";
        const body = payload.notification?.body || "";
        if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
          try {
            new Notification(title, { body, data: payload.data });
          } catch (error) {
            console.warn("failed to display foreground notification", error);
          }
        }
      });
      foregroundListenerAttached = true;
    }
    return messaging;
  })().catch((error) => {
    console.warn("failed to initialise firebase messaging", error);
    return null;
  });
  return messagingPromise;
}

let registrationPromise: Promise<string | null> | null = null;

export async function ensureWebPushRegistration(): Promise<string | null> {
  if (registrationPromise) return registrationPromise;
  if (typeof window === "undefined") return null;
  registrationPromise = (async () => {
    const messaging = await ensureMessaging();
    if (!messaging) return null;
    if (!("Notification" in window)) return null;
    if (Notification.permission === "denied") return null;
    const permission = Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();
    if (permission !== "granted") return null;

    const config = await loadFirebaseConfig();
    if (!config) return null;
    const { vapidKey, ...firebaseOptions } = config;
    if (typeof vapidKey !== "string" || !vapidKey.trim()) return null;
    const options: FirebaseOptions = firebaseOptions;
    const sw = await ensureServiceWorker(options);
    if (!sw) return null;

    let token: string | null = null;
    try {
      token = await getToken(messaging, {
        vapidKey,
        serviceWorkerRegistration: sw,
      });
    } catch (error) {
      console.warn("failed to get web push token", error);
      token = null;
    }
    if (!token) return null;

    cachedToken = token;
    try {
      await registerPushDevice({
        token,
        platform: "web",
        device_name: navigator.userAgent.slice(0, 255),
        locale: (navigator.language || "").slice(0, 32),
      });
    } catch (error) {
      console.warn("failed to register web push token", error);
    }
    return token;
  })();
  try {
    return await registrationPromise;
  } finally {
    registrationPromise = null;
  }
}

export function getCachedWebPushToken() {
  return cachedToken;
}
