/* @refresh reload */

// <reference types="virtual:pwa-register" />

import { render } from "solid-js/web";
import { onForegroundMessage, requestFcmToken } from "./utils/firebase.ts";
import { apiFetch } from "./utils/config.ts";

import App from "./App.tsx";

// register FCM token for the currently active account (if any)
requestFcmToken().then(async (token) => {
  if (!token) return;
  try {
    const activeId = localStorage.getItem("takos-active-account-id");
    if (!activeId) return; // no active account, skip registering
    const res = await apiFetch(`/api/accounts/${activeId}`);
    if (!res.ok) return;
    const data = await res.json();
    const userName = data.userName as string | undefined;
    if (!userName) return;
    await apiFetch("/api/fcm/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, userName }),
    });
  } catch (err) {
    console.error("FCM token registration failed", err);
  }
});

onForegroundMessage((payload) => {
  console.log("onMessage", payload);
});

render(() => <App />, document.getElementById("root")!);
