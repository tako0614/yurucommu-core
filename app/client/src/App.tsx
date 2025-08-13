import { createEffect, onMount, Show } from "solid-js";
import { useAtom } from "solid-jotai";
import { loginState } from "./states/session.ts";
import { languageState, microblogPostLimitState } from "./states/settings.ts";
import { LoginForm } from "./components/LoginForm.tsx";
import { Application } from "./components/Application.tsx";
import { apiFetch } from "./utils/config.ts";
import { useInitialLoad } from "./utils/initialLoad.ts";
import { usePathRouter } from "./utils/router.ts";
import "./App.css";

function App() {
  const [isLoggedIn, setIsLoggedIn] = useAtom(loginState);
  const [language, setLanguage] = useAtom(languageState);
  const [postLimit, setPostLimit] = useAtom(microblogPostLimitState);

  // 共通の初期データ取得
  useInitialLoad();
  // URL パスと状態を同期
  usePathRouter();

  // アプリケーション初期化時にログイン状態を確認
  onMount(async () => {
    const storedLang = localStorage.getItem("language");
    if (storedLang) {
      setLanguage(storedLang);
    }

    const storedLimit = localStorage.getItem("microblogPostLimit");
    if (storedLimit) {
      setPostLimit(parseInt(storedLimit, 10));
    }

    try {
      const res = await apiFetch("/api/session/status");
      const result = await res.json();
      setIsLoggedIn(result.login ?? false);
    } catch (err) {
      console.error("Failed to fetch login status:", err);
      setIsLoggedIn(false);
    }
  });

  createEffect(() => {
    document.body.classList.add("dark");
    localStorage.setItem("darkMode", "true");
  });

  createEffect(() => {
    localStorage.setItem("language", language());
  });

  createEffect(() => {
    localStorage.setItem("microblogPostLimit", String(postLimit()));
  });


  return (
    <Show
      when={isLoggedIn()}
      fallback={<LoginForm onLoginSuccess={() => setIsLoggedIn(true)} />}
    >
      <Application />
    </Show>
  );
}

export default App;
