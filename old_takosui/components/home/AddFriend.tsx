import { useAtom } from "solid-jotai";
import { createSignal } from "solid-js";
import { homeSelectedAtom } from "./home";
import { TakosFetch } from "../../utils/TakosFetch";

export function AddUserUI() {
  const [selected, setSelected] = useAtom(homeSelectedAtom);
  const [searchId, setSearchId] = createSignal("");
  const [searchResult, setSearchResult] = createSignal<
    {
      userName: string;
      icon: string;
      nickName: string;
      description: string;
    } | null
  >(null);
  const [isSearching, setIsSearching] = createSignal(false);

  const handleInvite = () => {
    // 招待機能の実装をここに追加
    alert("招待リンクがコピーされました");
  };

  const handleQRCode = () => {
    // QRコード表示機能の実装をここに追加
    alert("QRコードを表示します");
  };

  const handleSearch = async () => {
    const id = searchId().trim();
    if (!id) return;

    setIsSearching(true);
    setSearchResult(null);

    try {
      // ユーザー検索リクエスト
      const domain = id.split("@")[1];
      const icon = await TakosFetch(
        `https://${domain}/_takos/v1/user/icon/${id}`,
      );
      const nickName = await TakosFetch(
        `https://${domain}/_takos/v1/user/nickName/${id}`,
      );
      const discription = await TakosFetch(
        `https://${domain}/_takos/v1/user/description/${id}`,
      );
      if (!icon.ok) {
        alert("ユーザーが見つかりませんでした");
        return;
      }
      setSearchResult({
        userName: id,
        icon: (await icon.json()).icon,
        nickName: (await nickName.json()).nickName,
        description: (await discription.json()).description,
      });
    } catch (error) {
      console.error("ユーザー検索エラー:", error);
      alert("検索中にエラーが発生しました");
    } finally {
      setIsSearching(false);
    }
  };

  const handleSendRequest = async () => {
    if (!searchResult()) return;

    try {
      const res = await TakosFetch("/api/v2/friend/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userName: searchResult()!.userName,
        }),
      });

      if (res.status === 200) {
        alert("リクエストを送信しました");
        setSearchId("");
        setSearchResult(null);
      } else {
        alert("リクエスト送信中にエラーが発生しました");
      }
    } catch (error) {
      console.error("友達リクエストエラー:", error);
      alert("エラーが発生しました");
    }
  };

  return (
    <>
      <div class="flex items-center justify-between p-4">
        <button
          class="text-blue-400 hover:text-blue-300 transition-colors"
          onClick={() => setSelected(null)}
        >
          戻る
        </button>
        <h2 class="font-bold text-xl">友だちを追加</h2>
        <div class="w-10"></div> {/* バランス用の空要素 */}
      </div>

      <div class="p-4 max-w-full overflow-x-hidden">
        {/* 招待とQRコードのボタン */}
        <div class="grid grid-cols-2 gap-3 mb-6">
          <button
            onClick={handleInvite}
            class="bg-[#1E1E1E] hover:bg-[#252525] text-white py-3 px-3 rounded-lg flex flex-col items-center justify-center transition-colors border border-gray-800"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-6 w-6 mb-1 text-blue-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
            <span class="font-medium text-sm">招待</span>
          </button>

          <button
            onClick={handleQRCode}
            class="bg-[#1E1E1E] hover:bg-[#252525] text-white py-3 px-3 rounded-lg flex flex-col items-center justify-center transition-colors border border-gray-800"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-6 w-6 mb-1 text-blue-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1v-2a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1z"
              />
            </svg>
            <span class="font-medium text-sm">QRコード</span>
          </button>
        </div>

        {/* IDで検索 - より暗いデザイン */}
        <div class="bg-[#1A1A1A] rounded-lg p-4 border border-[#252525] shadow-lg shadow-black/30">
          <h3 class="text-md font-medium mb-3 text-gray-200">
            IDで友だちを検索
          </h3>

          <div class="flex flex-col sm:flex-row items-center gap-2">
            <input
              type="text"
              value={searchId()}
              onInput={(e) => setSearchId(e.target.value)}
              placeholder="ユーザーID（例: user@example.com）"
              class="w-full p-3 bg-[#0D0D0D] rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 border border-[#333] text-sm"
            />
            <button
              onClick={handleSearch}
              class="bg-blue-700 hover:bg-blue-800 p-3 rounded-lg transition-colors flex-shrink-0 w-full sm:w-auto mt-2 sm:mt-0"
              disabled={!searchId().trim() || isSearching()}
            >
              <div class="flex items-center justify-center">
                {isSearching()
                  ? (
                    <svg
                      class="animate-spin h-5 w-5 text-white"
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
                  )
                  : (
                    <>
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
                          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                        />
                      </svg>
                      <span class="ml-1 sm:hidden block">検索</span>
                    </>
                  )}
              </div>
            </button>
          </div>

          {/* 検索結果表示エリア */}
          {searchResult() && (
            <div class="mt-6 bg-[#121212] rounded-lg p-4 border border-gray-800 animate-fadeIn">
              <div class="flex items-center gap-4">
                <div class="flex-shrink-0">
                  {searchResult()!.icon
                    ? (
                      <img
                        src={`data:image/png;base64,${searchResult()!.icon}`}
                        alt="プロフィール画像"
                        class="w-16 h-16 rounded-full object-cover border border-gray-700"
                      />
                    )
                    : (
                      <div class="w-16 h-16 rounded-full bg-gray-700 flex items-center justify-center">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          class="h-8 w-8 text-gray-400"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                          />
                        </svg>
                      </div>
                    )}
                </div>

                <div class="flex-1 min-w-0">
                  <h4 class="font-medium text-lg text-white truncate">
                    {searchResult()!.nickName}
                  </h4>
                  <p class="text-xs text-blue-400 truncate mb-1">
                    {searchResult()!.userName}
                  </p>
                  <p class="text-sm text-gray-400 line-clamp-2">
                    {searchResult()!.description || "自己紹介はありません"}
                  </p>
                </div>
              </div>

              <div class="mt-4 flex justify-end">
                <button
                  onClick={handleSendRequest}
                  class="bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-md transition-colors flex items-center gap-2"
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
                      d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
                    />
                  </svg>
                  友だちリクエストを送信
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
