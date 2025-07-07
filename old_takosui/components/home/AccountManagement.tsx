import { createSignal, onMount } from "solid-js";
import { UAParser } from "ua-parser-js";
import { clearDB } from "../../utils/storage/idb";
import { useAtom } from "solid-jotai";
import { homeSelectedAtom } from "./home";
import { TakosFetch } from "../../utils/TakosFetch";

export function AccountManagement() {
  const [selected, setSelected] = useAtom(homeSelectedAtom);
  const [confirmLogout, setConfirmLogout] = createSignal(false);
  const [confirmDelete, setConfirmDelete] = createSignal(false);
  const [sessionInfo, setSessionInfo] = createSignal<{
    deviceName: string;
    current: boolean;
    id: string;
    encrypted: boolean;
  }[]>([]);
  const [isLoading, setIsLoading] = createSignal(true);

  onMount(async () => {
    setIsLoading(true);
    try {
      const response = await TakosFetch("/api/v2/sessions/list");
      const data = await response.json();
      console.log(data);
      setSessionInfo(
        data.map(
          (s: { userAgent: any; uuid: string | null; encrypted: boolean }) => {
            const ua = s.userAgent;
            const parser = new UAParser(ua);
            const result = parser.getResult(); // ブラウザ、OS、デバイスなどの情報を取得
            console.log(result);
            const deviceName = result.os.name + " " + result.os.version;
            return {
              deviceName,
              current: s.uuid === localStorage.getItem("sessionUUID"),
              id: s.uuid,
              encrypted: !!s.encrypted, // 暗号化状態を追加
            };
          },
        ),
      );
      setIsLoading(false);
    } catch (error) {
      console.error("セッション情報の取得に失敗:", error);
      setIsLoading(false);
    }
  });
  const handleLogout = async () => {
    try {
      localStorage.removeItem("userName");
      localStorage.removeItem("masterKey");
      await clearDB();
      await TakosFetch("/api/v2/sessions/logout", { method: "POST" });
      alert("ログアウトしました。");
      window.location.href = "/";
    } catch (error) {
      console.error("ログアウト中にエラーが発生しました:", error);
      alert("ログアウトに失敗しました。");
    }
  };

  const handleDeleteAccount = async () => {
    //
  };

  const handleTerminateSession = async (sessionId: string) => {
    try {
      if (confirm("このセッションを終了しますか？")) {
        await TakosFetch(`/api/v2/sessions/delete/${sessionId}`, {
          method: "POST",
        });
        alert("セッションを終了しました。");
        window.location.reload();
      }
    } catch (error) {
      console.error("セッション終了中にエラーが発生しました:", error);
      alert("セッション終了に失敗しました。");
    }
  };

  return (
    <div class="p-4">
      <div class="flex items-center justify-between mb-5">
        <button
          class="text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1"
          onClick={() => setSelected("settings")}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
          戻る
        </button>
        <h3 class="text-lg font-bold">アカウント管理</h3>
        <div class="w-10"></div> {/* スペースバランス用 */}
      </div>

      {/* セッション情報表示部分 */}
      <div class="bg-gray-800/70 border border-gray-700 rounded-lg p-4 mb-4">
        <div class="flex items-center gap-3 mb-3">
          <span class="text-blue-400 bg-blue-500/10 p-2 rounded-lg">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
          </span>
          <h4 class="font-medium">アクティブなセッション</h4>
        </div>

        {isLoading()
          ? (
            <div class="flex justify-center items-center py-6">
              <svg
                class="animate-spin h-6 w-6 text-blue-400"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  class="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  stroke-width="4"
                >
                </circle>
                <path
                  class="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                >
                </path>
              </svg>
            </div>
          )
          : (
            <div class="space-y-3">
              {sessionInfo().map((session) => (
                <div class="bg-gray-900/80 border border-gray-700 rounded-lg p-3 flex items-center justify-between">
                  <div>
                    <div class="flex items-center gap-2">
                      <span class="text-white">{session.deviceName}</span>
                      {session.current && (
                        <span class="bg-green-500/20 text-green-400 text-xs px-2 py-1 rounded-full">
                          現在のデバイス
                        </span>
                      )}
                      {session.encrypted && (
                        <span class="bg-blue-500/20 text-blue-400 text-xs px-2 py-1 rounded-full flex items-center gap-1">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-3 w-3"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                            />
                          </svg>
                          暗号化
                        </span>
                      )}
                    </div>
                  </div>
                  {!session.current && (
                    <button
                      onClick={() => handleTerminateSession(session.id)}
                      class="text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 p-2 rounded-lg transition-colors"
                      title="このセッションを終了"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="h-5 w-5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

        <p class="text-xs text-gray-400 mt-3 flex items-center gap-1">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          他のデバイスからのアクセスをここで管理できます。不明なセッションがある場合はすぐに終了してください。
        </p>
      </div>

      {/* アカウント操作ボタン */}
      <div class="space-y-3">
        <button
          onClick={() => setConfirmLogout(true)}
          class="w-full p-3 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
            />
          </svg>
          ログアウト
        </button>
      </div>

      {/* ログアウト確認ダイアログ */}
      {confirmLogout() && (
        <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div class="bg-gray-800 p-6 rounded-lg w-full max-w-md mx-4">
            <h3 class="text-xl font-bold mb-3">ログアウトの確認</h3>
            <p class="text-gray-300 mb-4">本当にログアウトしますか？</p>
            <div class="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmLogout(false)}
                class="px-4 py-2 bg-gray-700 rounded-md hover:bg-gray-600"
              >
                キャンセル
              </button>
              <button
                onClick={handleLogout}
                class="px-4 py-2 bg-blue-600 rounded-md hover:bg-blue-700"
              >
                ログアウト
              </button>
            </div>
          </div>
        </div>
      )}

      {/* アカウント削除確認ダイアログ */}
      {confirmDelete() && (
        <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div class="bg-gray-800 p-6 rounded-lg w-full max-w-md mx-4">
            <h3 class="text-xl font-bold mb-3 text-red-400">
              アカウント削除の確認
            </h3>
            <p class="text-gray-300 mb-2">本当にアカウントを削除しますか？</p>
            <p class="text-red-400 text-sm mb-4 p-2 bg-red-900/20 rounded-md border border-red-900/20">
              この操作は取り消せません。すべての個人データ、チャット履歴、友だち関係が完全に削除されます。
            </p>
            <div class="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDelete(false)}
                class="px-4 py-2 bg-gray-700 rounded-md hover:bg-gray-600"
              >
                キャンセル
              </button>
              <button
                onClick={handleDeleteAccount}
                class="px-4 py-2 bg-red-600 rounded-md hover:bg-red-700"
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
