let messaging;
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "config") {
    importScripts(
      "/lib/firebase-app-compat.js",
    );
    importScripts(
      "/lib/firebase-messaging-compat.js",
    );
    firebase.initializeApp(event.data.config);
    messaging = firebase.messaging();
    messaging.onBackgroundMessage((payload) => {
      const title = payload.notification?.title || "通知";
      const options = { body: payload.notification?.body };
      self.registration.showNotification(title, options);
    });
  }
});
