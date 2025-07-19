import { initializeApp } from "firebase/app";
import { getMessaging, onBackgroundMessage } from "firebase/messaging/sw";

let messaging: ReturnType<typeof getMessaging> | null = null;

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "config") {
    const app = initializeApp(event.data.config as Record<string, string>);
    messaging = getMessaging(app);
    onBackgroundMessage(messaging, (payload) => {
      const title = payload.notification?.title ?? "通知";
      const options = { body: payload.notification?.body };
      self.registration.showNotification(title, options);
    });
  }
});
