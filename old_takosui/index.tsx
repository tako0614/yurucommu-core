import { render } from "solid-js/web";
import App from "./App";
import { Router } from "@solidjs/router";
import "./styles/loading.css";
import { subscribeToTopic, getFCMToken, onPushNotificationOpened, getLatestNotificationData, onPushNotificationReceived } from '../src-tauri/tauri-plugin-fcm/guest-js/index.ts';
import { requestPermission, isPermissionGranted, sendNotification } from '@tauri-apps/plugin-notification'
import { createSignal, onMount } from "solid-js";
const root = document.getElementById("root");



function Test() {
  const [token, setToken] = createSignal<string | null>(null);
  const [copied, setCopied] = createSignal(false);

  async function getAndSetFCMToken() {
    const tokenResponse = await getFCMToken()
    setToken(tokenResponse);
  }

  onMount(async () => {

  })

  function copyToClipboard() {
    if (!token()) return;
    
    navigator.clipboard.writeText(token()!)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(err => {
        console.error('Failed to copy token: ', err);
      });
  }

  async function sendTestNotification(
    title: string,
    body: string
  ) {
    let permissionGranted = await isPermissionGranted();

    // If not we need to request it
    if (!permissionGranted) {
      const permission = await requestPermission();
      permissionGranted = permission === 'granted';
    }

    // Once permission has been granted we can send the notification
    if (permissionGranted) {
      sendNotification({
        title: title,
        body: body,
      });
    }
  }
  return (
    <>
      <div class="p-4 mb-4 bg-gray-50 rounded-lg border border-gray-200">
        <div class="flex items-center justify-between">
          <p class="text-sm text-gray-500">FCM Token:</p>
          {token() && (
            <button 
              onClick={copyToClipboard}
              class="px-2 py-1 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors"
            >
              {copied() ? 'Copied!' : 'Copy'}
            </button>
          )}
        </div>
        <p class="font-mono text-xs break-all whitespace-normal">{token() || "No token generated"}</p>
      </div>
      <div class="flex gap-2">
        <button 
          onClick={getAndSetFCMToken} 
          class="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
        >
          Get FCM Token
        </button>
        <button 
          onClick={() => {
            sendTestNotification(
              "Test Notification",
              "This is a test notification sent from the web app.")
          }}
          class="px-4 py-2 bg-purple-500 text-white rounded-md hover:bg-purple-600 transition-colors"
        >
          Send Test Notification
        </button>
      </div>
    </>
  )
}

const routes = [
  {
    path: "/",
    component: () => <App />,
  },
  {
    path: "/login",
    component: () => <App />,
  },
  {
    path: "/home",
    component: () => <App page="home" />,
  },
  {
    path: "/home/:roomId",
    component: () => <App page="home" />,
  },
  {
    path: "/talk",
    component: () => <App page="talk" />,
  },
  {
    path: "/talk/:roomId",
    component: () => <App page="talk" />,
  },
  {
    path: "/friend",
    component: () => <App page="friend" />,
  },
  {
    path: "/friend/:roomId",
    component: () => <App page="friend" />,
  },
  {
    path: "/notification",
    component: () => <App page="notification" />,
  },
  {
    path: "/notification/:roomId",
    component: () => <App page="notification" />,
  }
];

render(() => <Router>{routes}</Router>, root!);

export default App;