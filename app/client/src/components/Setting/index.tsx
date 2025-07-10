import { useAtom } from "solid-jotai";
import { darkModeState, languageState } from "../../states/settings.ts";
import RelaySettings from "./RelaySettings.tsx";

export interface SettingProps {
  onShowEncryptionKeyForm?: () => void;
}
export function Setting(props: SettingProps) {
  const [darkMode, setDarkMode] = useAtom(darkModeState);
  const [language, setLanguage] = useAtom(languageState);

  const toggleDark = () => setDarkMode(!darkMode());

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
      <div class="flex justify-end">
        <button
          type="button"
          class="bg-blue-700 text-white px-4 py-2 rounded hover:bg-blue-800 transition"
          onClick={() => props.onShowEncryptionKeyForm?.()}
        >
          暗号化キー再入力
        </button>
      </div>
    </div>
  );
}
