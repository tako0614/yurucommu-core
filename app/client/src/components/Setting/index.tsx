import { useAtom } from "solid-jotai";
import {
  languageState,
  microblogPostLimitState,
} from "../../states/settings.ts";
import { encryptionKeyState, loginState } from "../../states/session.ts";
import { apiFetch } from "../../utils/config.ts";
import { accounts as accountsAtom } from "../../states/account.ts";
import { deleteMLSDatabase } from "../e2ee/storage.ts";
import { FaspProviders } from "./FaspProviders.tsx";

export function Setting() {
  const [language, setLanguage] = useAtom(languageState);
  const [postLimit, setPostLimit] = useAtom(microblogPostLimitState);
  const [, setIsLoggedIn] = useAtom(loginState);
  // 暗号化キー入力は廃止
  const [accs] = useAtom(accountsAtom);

  const handleLogout = async () => {
    try {
      await apiFetch("/api/logout", { method: "POST" });
    } catch (err) {
      console.error("logout failed", err);
    } finally {
      for (const acc of accs()) {
        await deleteMLSDatabase(acc.id);
      }
      setIsLoggedIn(false);
      localStorage.removeItem("encryptionKey");
    }
  };

  return (
    <div class="space-y-6">
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
      <div>
        <label for="microblogLimit" class="block mb-1">
          マイクロブログ表示件数
        </label>
        <select
          id="microblogLimit"
          value={postLimit()}
          onChange={(e) => setPostLimit(parseInt(e.currentTarget.value, 10))}
        >
          <option value="20">20件</option>
          <option value="50">50件</option>
          <option value="100">100件</option>
        </select>
      </div>
      <div>
        <h3 class="font-bold mb-1">FASP 設定</h3>
        <FaspProviders />
      </div>
      <div class="flex justify-end space-x-2">
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
