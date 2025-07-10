import { createEffect, onMount, Show, createSignal } from "solid-js";
import { useAtom } from "solid-jotai";
import { encryptionKeyState, loginState } from "./states/session.ts";
import { darkModeState, languageState } from "./states/settings.ts";
import { LoginForm } from "./components/LoginForm.tsx";
import { EncryptionKeyForm } from "./components/EncryptionKeyForm.tsx";
import { Application } from "./components/Application.tsx";
import { apiFetch } from "./utils/config.ts";
import "./App.css";
import "./stylesheet.css";

function App() {
  const [isLoggedIn, setIsLoggedIn] = useAtom(loginState);
  const [encryptionKey, setEncryptionKey] = useAtom(encryptionKeyState);
  const [darkMode, setDarkMode] = useAtom(darkModeState);
  const [language, setLanguage] = useAtom(languageState);
  const [skippedEncryptionKey, setSkippedEncryptionKey] = createSignal(false);

  // アプリケーション初期化時にログイン状態を確認
  onMount(async () => {
    const storedKey = localStorage.getItem("encryptionKey");
    if (storedKey) {
      setEncryptionKey(storedKey);
    }

    const storedDark = localStorage.getItem("darkMode");
    if (storedDark !== null) {
      setDarkMode(storedDark === "true");
    }
    const storedLang = localStorage.getItem("language");
    if (storedLang) {
      setLanguage(storedLang);
    }

    const skipped = sessionStorage.getItem("skippedEncryptionKey");
    if (skipped === "true") {
      setSkippedEncryptionKey(true);
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
    if (darkMode()) {
      document.body.classList.add("dark");
      document.body.classList.remove("light");
    } else {
      document.body.classList.remove("dark");
      document.body.classList.add("light");
    }
    localStorage.setItem("darkMode", String(darkMode()));
  });

  createEffect(() => {
    localStorage.setItem("language", language());
  });

  const [encryptionKeyFormVisible, setEncryptionKeyFormVisible] = createSignal(false);

  const showEncryptionKeyForm = () => setEncryptionKeyFormVisible(true);
  const hideEncryptionKeyForm = () => setEncryptionKeyFormVisible(false);

  // 暗号化キー未入力時は常にフォーム表示
  createEffect(() => {
    if (isLoggedIn() && !encryptionKey() && !skippedEncryptionKey()) {
      setEncryptionKeyFormVisible(true);
    }
  });

  return (
    <Show
      when={isLoggedIn()}
      fallback={<LoginForm onLoginSuccess={() => setIsLoggedIn(true)} />}
    >
      <Application onShowEncryptionKeyForm={showEncryptionKeyForm} />
      <Show when={encryptionKeyFormVisible()}>
        <div
          style="
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0,0,0,0.7);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
          "
        >
          <EncryptionKeyForm
            onComplete={(skipped) => {
              hideEncryptionKeyForm();
              if (skipped) {
                setSkippedEncryptionKey(true);
                sessionStorage.setItem("skippedEncryptionKey", "true");
              }
            }}
          />
        </div>
      </Show>
    </Show>
  );
}

export default App;
