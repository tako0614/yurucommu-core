import { createEffect, createSignal, onMount, Show } from "solid-js";
import { ErrorBoundary } from "solid-js";
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
import { Spinner, Toaster, ToastProvider } from "./components/ui/index.ts";
import { accounts as accountsAtom, activeAccountId } from "./states/account.ts";

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

  // デバッグ: accounts や activeAccountId の変化をログに出す
  const [accs] = useAtom(accountsAtom);
  const [actId] = useAtom(activeAccountId);
  createEffect(() => {
    try {
      console.debug("[DEBUG] accounts.length=", accs()?.length ?? 0, accs());
      console.debug("[DEBUG] activeAccountId=", actId());
      console.debug("[DEBUG] localStorage active id=", localStorage.getItem("takos-active-account-id"));
    } catch (e) {
      console.debug("[DEBUG] error reading debug state", e);
    }
  });

  // 初期ロード中フラグ（ログイン状態確定までのフラッシュ防止）
  const [initializing, setInitializing] = createSignal(true);

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
    } finally {
      setInitializing(false);
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
    <ToastProvider>
      <Toaster />
      <Show
        when={!initializing()}
        fallback={
          <div class="min-h-dvh grid place-items-center text-gray-200">
            <div class="flex items-center gap-3 text-sm">
              <Spinner />
              <span>読み込み中...</span>
            </div>
          </div>
        }
      >
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
          <ErrorBoundary
            fallback={(e) => (
              <div class="p-6 text-rose-200">
                <p class="font-semibold">画面の表示でエラーが発生しました。</p>
                <p class="mt-1 text-rose-300/90 text-sm overflow-wrap-anywhere">
                  {String(e)}
                </p>
              </div>
            )}
          >
            <Application />
          </ErrorBoundary>
        </Show>
      </Show>
    </ToastProvider>
  );
}

export default App;
