import { createEffect, createSignal, onMount, Show } from "solid-js";
import { useAtom } from "solid-jotai";
import { loginState } from "./states/session.ts";
import { languageState, microblogPostLimitState } from "./states/settings.ts";
import { LoginForm } from "./components/LoginForm.tsx";
import { Application } from "./components/Application.tsx";
import { OnboardingForm } from "./components/OnboardingForm.tsx";
import { SystemSetupForm } from "./components/SystemSetupForm.tsx";
import { apiFetch } from "./utils/config.ts";
import { useInitialLoad } from "./utils/initialLoad.ts";
import { usePathRouter } from "./utils/router.ts";
import "./App.css";

function App() {
  const [isLoggedIn, setIsLoggedIn] = useAtom(loginState);
  const [language, setLanguage] = useAtom(languageState);
  const [postLimit, setPostLimit] = useAtom(microblogPostLimitState);
  const [showSetup, setShowSetup] = createSignal(false);
  const [showSystemSetup, setShowSystemSetup] = createSignal(false);

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

  // システム初期設定の表示可否を判定（ログイン前でも実行）
  createEffect(async () => {
    try {
      const st = await apiFetch("/api/system/setup/status");
      if (st.ok) {
        const data = await st.json();
        setShowSystemSetup(!data.configured);
      } else {
        setShowSystemSetup(false);
      }
    } catch {
      setShowSystemSetup(false);
    }
  });

  // ログイン後にのみオンボーディング（アカウント作成）の表示可否を判定
  createEffect(async () => {
    if (isLoggedIn()) {
      try {
        const st = await apiFetch("/api/onboarding/status");
        if (st.ok) {
          const data = await st.json();
          setShowSetup(!data.configured);
        } else {
          setShowSetup(false);
        }
      } catch {
        setShowSetup(false);
      }
    } else {
      setShowSetup(false);
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
    <>
      <Show when={!isLoggedIn() && showSystemSetup()}>
        <SystemSetupForm onSuccess={() => setShowSystemSetup(false)} />
      </Show>
      <Show when={!isLoggedIn() && !showSystemSetup()}>
        <LoginForm onLoginSuccess={() => setIsLoggedIn(true)} />
      </Show>
      <Show when={isLoggedIn() && showSetup()}>
        <OnboardingForm onSuccess={() => setShowSetup(false)} />
      </Show>
      <Show when={isLoggedIn() && !showSetup()}>
        <Application />
      </Show>
    </>
  );
}

export default App;
