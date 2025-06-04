import { onMount, Show } from "solid-js";
import { useAtom } from "solid-jotai";
import { loginState } from "./states/session.ts";
import { LoginForm } from "./components/LoginForm.tsx";
import { Aplication } from "./components/Aplication.tsx";
import "./App.css";
import "./stylesheet.css";

function App() {
  const [isLoggedIn, setIsLoggedIn] = useAtom(loginState);

  // アプリケーション初期化時にログイン状態を確認
  onMount(async () => {
    try {
      const res = await fetch("/api/status");
      if (res.ok) {
        const data = await res.json();
        setIsLoggedIn(data.login);
      } else {
        setIsLoggedIn(false);
      }
    } catch (err) {
      console.error("Failed to fetch login status:", err);
      setIsLoggedIn(false);
    }
  });

  return (
    <Show
      when={isLoggedIn()}
      fallback={<LoginForm onLoginSuccess={() => setIsLoggedIn(true)} />}
    >
      <Aplication />
    </Show>
  );
}

export default App;
