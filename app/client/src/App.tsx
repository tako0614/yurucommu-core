import { onMount, Show } from "solid-js";
import { useAtom } from "solid-jotai";
import { loginState } from "./states/session.ts";
import { LoginForm } from "./components/LoginForm.tsx";
import { Aplication } from "./components/Aplication.tsx";
import { WebSocketProvider } from "./components/WebSocketProvider.tsx";
import "./App.css";
import "./stylesheet.css";

function App() {
  const [isLoggedIn, setIsLoggedIn] = useAtom(loginState);

  // アプリケーション初期化時にログイン状態を確認
  onMount(async () => {
    try {
      const res = await fetch("/api/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events: [{
            eventId: "sessions:status",
            identifier: "takos",
            payload: {},
          }],
        }),
      });
      const results = await res.json();
      setIsLoggedIn(results[0]?.result?.login ?? false);
    } catch (err) {
      console.error("Failed to fetch login status:", err);
      setIsLoggedIn(false);
    }
  });

  return (
    <WebSocketProvider>
      <Show
        when={isLoggedIn()}
        fallback={<LoginForm onLoginSuccess={() => setIsLoggedIn(true)} />}
      >
        <Aplication />
      </Show>
    </WebSocketProvider>
  );
}

export default App;
