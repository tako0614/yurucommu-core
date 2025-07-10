import { createEffect, onMount, Show } from "solid-js";
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

  // アプリケーション初期化時にログイン状態を確認
  onMount(async () => {
    try {
      const res = await apiFetch("/api/session/status");
      const result = await res.json();
      setIsLoggedIn(result.login ?? false);
    } catch (err) {
      console.error("Failed to fetch login status:", err);
      setIsLoggedIn(false);
    }

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

  return (
    <Show
      when={isLoggedIn()}
      fallback={<LoginForm onLoginSuccess={() => setIsLoggedIn(true)} />}
    >
      <Show
        when={encryptionKey()}
        fallback={<EncryptionKeyForm onComplete={() => {}} />}
      >
        <Application />
      </Show>
    </Show>
  );
}

export default App;
