/* @refresh reload */

// <reference types="virtual:pwa-register" />

import { render } from "solid-js/web";
import { onForegroundMessage, requestFcmToken } from "./utils/firebase.ts";
import { apiFetch } from "./utils/config.ts";

import App from "./App.tsx";

requestFcmToken().then((token) => {
  if (token) {
    apiFetch("/api/fcm/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, userName: "system" }),
    });
  }
});

onForegroundMessage((payload) => {
  console.log("onMessage", payload);
});

render(() => <App />, document.getElementById("root")!);
