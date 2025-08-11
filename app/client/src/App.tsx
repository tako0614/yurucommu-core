import { createEffect, createSignal, onMount, Show } from "solid-js";
import { useAtom } from "solid-jotai";
import { encryptionKeyState, loginState } from "./states/session.ts";
import { languageState, microblogPostLimitState } from "./states/settings.ts";
import { LoginForm } from "./components/LoginForm.tsx";
import { EncryptionKeyForm } from "./components/EncryptionKeyForm.tsx";
import { Application } from "./components/Application.tsx";
import { apiFetch } from "./utils/config.ts";
import { useInitialLoad } from "./utils/initialLoad.ts";
import { useHashRouter } from "./utils/router.ts";
import "./App.css";
import { Modal } from "./components/ui/Modal.tsx";

function App() {
  const [isLoggedIn, setIsLoggedIn] = useAtom(loginState);
  const [encryptionKey, setEncryptionKey] = useAtom(encryptionKeyState);
  const [language, setLanguage] = useAtom(languageState);
  const [postLimit, setPostLimit] = useAtom(microblogPostLimitState);
  const [skippedEncryptionKey, setSkippedEncryptionKey] = createSignal(false);

  // 共通の初期データ取得
  useInitialLoad();
  // URLハッシュと状態を同期
  useHashRouter();

  // アプリケーション初期化時にログイン状態を確認
  onMount(async () => {
    const storedKey = localStorage.getItem("encryptionKey");
    if (storedKey) {
      setEncryptionKey(storedKey);
    }

    const storedLang = localStorage.getItem("language");
    if (storedLang) {
      setLanguage(storedLang);
    }

    const storedLimit = localStorage.getItem("microblogPostLimit");
    if (storedLimit) {
      setPostLimit(parseInt(storedLimit, 10));
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
    document.body.classList.add("dark");
    localStorage.setItem("darkMode", "true");
  });

  createEffect(() => {
    localStorage.setItem("language", language());
  });

  createEffect(() => {
    localStorage.setItem("microblogPostLimit", String(postLimit()));
  });

  const [encryptionKeyFormVisible, setEncryptionKeyFormVisible] = createSignal(
    false,
  );

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
      <Modal
        open={encryptionKeyFormVisible()}
        onClose={hideEncryptionKeyForm}
        title="暗号化キーの入力"
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
      </Modal>
    </Show>
  );
}

export default App;
