let messaging;
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "config") {
    importScripts(
      "https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js",
    );
    importScripts(
      "https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js",
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
