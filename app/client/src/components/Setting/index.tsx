import { useAtom } from "solid-jotai";
import {
  languageState,
  microblogPostLimitState,
} from "../../states/settings.ts";
import { loginState } from "../../states/session.ts";
import { apiFetch } from "../../utils/config.ts";
import {
  accounts as accountsAtom,
  activeAccount,
} from "../../states/account.ts";
import { deleteMLSDatabase } from "../e2ee/storage.ts";
import { FaspProviders } from "./FaspProviders.tsx";
import { useMLS } from "../e2ee/useMLS.ts";
import { Show } from "solid-js";

export function Setting() {
  const [language, setLanguage] = useAtom(languageState);
  const [postLimit, setPostLimit] = useAtom(microblogPostLimitState);
  const [, setIsLoggedIn] = useAtom(loginState);
  const [accs] = useAtom(accountsAtom);
  const [account] = useAtom(activeAccount);
  const { generateKeys, status, error } = useMLS(
    account()?.userName ?? "",
  );

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
      <div>
        <h3 class="font-bold mb-1">MLS 鍵管理</h3>
        <button
          type="button"
          class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition"
          onClick={generateKeys}
        >
          鍵ペア生成
        </button>
        <Show when={status()}>
          <p class="text-green-500 text-sm mt-1">{status()}</p>
        </Show>
        <Show when={error()}>
          <p class="text-red-500 text-sm mt-1">{error()}</p>
        </Show>
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
