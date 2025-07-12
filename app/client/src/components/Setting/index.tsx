import { useAtom } from "solid-jotai";
import { darkModeState, languageState } from "../../states/settings.ts";
import { encryptionKeyState, loginState } from "../../states/session.ts";
import RelaySettings from "./RelaySettings.tsx";
import { apiFetch } from "../../utils/config.ts";

export interface SettingProps {
  onShowEncryptionKeyForm?: () => void;
}
export function Setting(props: SettingProps) {
  const [darkMode, setDarkMode] = useAtom(darkModeState);
  const [language, setLanguage] = useAtom(languageState);
  const [, setIsLoggedIn] = useAtom(loginState);
  const [, setEncryptionKey] = useAtom(encryptionKeyState);

  const toggleDark = () => setDarkMode(!darkMode());

  const handleLogout = async () => {
    try {
      await apiFetch("/api/logout", { method: "POST" });
    } catch (err) {
      console.error("logout failed", err);
    } finally {
      setIsLoggedIn(false);
      setEncryptionKey(null);
      localStorage.removeItem("encryptionKey");
      sessionStorage.removeItem("skippedEncryptionKey");
    }
  };

  return (
    <div class="space-y-6">
      <div class="flex items-center space-x-3">
        <input
          id="darkmode"
          type="checkbox"
          checked={darkMode()}
          onChange={toggleDark}
        />
        <label for="darkmode">ダークモード</label>
      </div>
      <div>
        <label for="lang" class="block mb-1">言語</label>
        <select
          id="lang"
          value={language()}
          onChange={(e) => setLanguage(e.currentTarget.value)}
        >
          <option value="ja">日本語</option>
          <option value="en">English</option>
        </select>
      </div>
      <RelaySettings />
      <div class="flex justify-end space-x-2">
        <button
          type="button"
          class="bg-blue-700 text-white px-4 py-2 rounded hover:bg-blue-800 transition"
          onClick={() => props.onShowEncryptionKeyForm?.()}
        >
          暗号化キー再入力
        </button>
        <button
          type="button"
          class="bg-red-700 text-white px-4 py-2 rounded hover:bg-red-800 transition"
          onClick={handleLogout}
        >
          ログアウト
        </button>
      </div>
    </div>
  );
}
