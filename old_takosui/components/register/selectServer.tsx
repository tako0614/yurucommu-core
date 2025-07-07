import { createEffect, createSignal, For, Show } from "solid-js";
import { fetch } from "@tauri-apps/plugin-http";
import { Store } from "@tauri-apps/plugin-store";

// Storeを正しく使用するための関数を用意
let storePromise: Promise<Store> | null = null;

async function getStore() {
  if (!storePromise) {
    storePromise = Store.load(".settings.dat");
  }
  return storePromise;
}

export function SelectedServer(
  { setIsSelectedServer }: { setIsSelectedServer: (value: boolean) => void },
) {
  const [servers, setServers] = createSignal<string[]>(["dev1.takos.jp"]);
  const [serverDetails, setServerDetails] = createSignal<
    { domain: string; name: string; explain: string; iconUrl: string }[]
  >([]);
  const [showModal, setShowModal] = createSignal(false);
  const [newServerDomain, setNewServerDomain] = createSignal("");
  const [loading, setLoading] = createSignal<{ [domain: string]: boolean }>({});
  const [selectedDomain, setSelectedDomain] = createSignal<string>("");

  // サーバー詳細を取得する関数
  const fetchServerDetails = async (domain: string) => {
    if (!domain) return;

    setLoading((prev) => ({ ...prev, [domain]: true }));
    try {
      // サーバー名を取得
      const nameResp = await fetch(`https://${domain}/api/v2/server/name`);
      const nameData = await nameResp.json();

      // サーバー説明を取得
      const explainResp = await fetch(
        `https://${domain}/api/v2/server/explain`,
      );
      const explainData = await explainResp.json();

      // アイコンURLを設定
      const iconUrl = `https://${domain}/api/v2/server/icon`;
      console.log(
        `Fetched details for ${domain}:`,
        nameData,
        explainData,
        iconUrl,
      );

      // 完全に新しい配列を作成して更新を確実に検出させる
      setServerDetails((current) => [
        ...current.filter((item) => item.domain !== domain),
        {
          domain,
          name: nameData.name,
          explain: explainData.explain,
          iconUrl,
        },
      ]);

      console.log("Updated serverDetails:", serverDetails());
    } catch (error) {
      console.error(`Failed to fetch details for ${domain}:`, error);
    } finally {
      setLoading((prev) => ({ ...prev, [domain]: false }));
    }
  };

  // サーバーが選択されたときのハンドラー
  const handleServerSelect = async (domain: string) => {
    try {
      await setTauriServerEndpoint(domain);
      //リロード
      window.location.reload();
    } catch (error) {
      console.error("Failed to save server endpoint:", error);
    }
  };

  // 新しいサーバーを追加
  const addServer = () => {
    const domain = newServerDomain().trim();
    if (domain && !servers().includes(domain)) {
      setServers((prev) => [...prev, domain]);
      fetchServerDetails(domain);
      setNewServerDomain("");
      setShowModal(false);
    }
  };

  // 既存サーバーの詳細を取得 - 依存関係を明示的に示す
  createEffect(() => {
    // 依存性を明示的にトリガーさせるために変数に格納
    const currentServers = servers();

    currentServers.forEach((domain) => {
      if (!serverDetails().some((item) => item.domain === domain)) {
        console.log(`Fetching details for ${domain} because it's missing`);
        fetchServerDetails(domain);
      }
    });
  });

  // デバッグ用のエフェクト
  createEffect(() => {
    const details = serverDetails();
    console.log("Current serverDetails (changed):", details);
  });

  return (
    <div class="flex flex-col items-center min-h-screen w-screen bg-black text-white py-6 px-4 pb-12">
      {/* メインコンテンツ - 中央寄せ（横方向のみ） */}
      <div class="w-full max-w-2xl mx-auto">
        {/* タイトルと説明 */}
        <div class="text-center mb-8 mt-8">
          <h1 class="text-3xl font-bold mb-2 text-white">takos</h1>
          <p class="text-gray-400 text-base mb-6">
            サーバーを選択またはドメインで追加
          </p>

          {/* 追加ボタン */}
          <button
            onClick={() => setShowModal(true)}
            class="bg-gray-800 hover:bg-gray-700 text-white px-5 py-2 rounded-md transition-colors duration-200 border border-gray-700"
          >
            <div class="flex items-center justify-center">
              <svg
                class="w-4 h-4 mr-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                >
                </path>
              </svg>
              サーバーを追加
            </div>
          </button>
        </div>

        {/* サーバーリスト */}
        <div class="w-full mb-10">
          {servers().length === 0
            ? (
              <div class="text-center py-8 bg-gray-900 rounded-md border border-gray-800">
                <div class="text-gray-400 text-lg mb-2">
                  サーバーがまだ追加されていません
                </div>
                <p class="text-gray-600">
                  「サーバーを追加」ボタンをクリックして始めましょう
                </p>
              </div>
            )
            : (
              <div class="flex flex-col space-y-3 w-full">
                <For each={servers()}>
                  {(domain) => {
                    // 依存関係を明示的に作成するために再度全体を取得
                    const details = () =>
                      serverDetails().find((item) => item.domain === domain);
                    return (
                      <div
                        class="bg-gray-900 rounded-md overflow-hidden hover:bg-gray-800 transition-colors duration-200 cursor-pointer flex border border-gray-800"
                        onClick={() => handleServerSelect(domain)}
                      >
                        <div class="w-24 h-20 flex-shrink-0 relative overflow-hidden">
                          {loading()[domain]
                            ? (
                              <div class="h-full w-full flex items-center justify-center bg-gray-800">
                                <div class="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-gray-400">
                                </div>
                              </div>
                            )
                            : (
                              <img
                                src={details()?.iconUrl}
                                alt={details()?.name || domain}
                                class="h-full w-full object-cover"
                                onError={(e) => {
                                  e.currentTarget.src =
                                    "https://via.placeholder.com/150?text=No+Image";
                                }}
                              />
                            )}
                        </div>
                        <div class="p-3 flex-grow">
                          <h3 class="text-md font-medium truncate">
                            {details()?.name || domain}
                          </h3>
                          <p class="text-gray-500 text-sm mb-1 truncate">
                            {domain}
                          </p>
                          {details()?.explain && (
                            <p class="text-gray-400 text-xs line-clamp-2">
                              {details()!.explain}
                            </p>
                          )}
                        </div>
                        <div class="self-center pr-3 text-gray-600">
                          <svg
                            class="w-5 h-5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M9 5l7 7-7 7"
                            >
                            </path>
                          </svg>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </div>
            )}
        </div>
      </div>

      {/* フッター - 著作権表示（固定） */}
      <div class="fixed bottom-0 left-0 w-full py-3 text-center text-gray-600 text-xs bg-black border-t border-gray-900">
        © {new Date().getFullYear()} takos
      </div>

      {/* サーバー追加モーダル */}
      {showModal() && (
        <div class="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-50">
          <div class="bg-gray-900 rounded-md w-full max-w-md p-6 border border-gray-800">
            <h2 class="text-xl font-medium mb-4">サーバーを追加</h2>
            <div class="mb-5">
              <label
                class="block text-gray-400 mb-2 text-sm"
                for="serverDomain"
              >
                サーバードメイン
              </label>
              <div class="relative">
                <input
                  id="serverDomain"
                  type="text"
                  value={newServerDomain()}
                  onInput={(e) => setNewServerDomain(e.currentTarget.value)}
                  placeholder="example.takos.jp"
                  class="w-full bg-gray-800 text-white px-3 py-2 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-600 border border-gray-700"
                />
                <div class="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                  <svg
                    class="w-4 h-4 text-gray-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
                    >
                    </path>
                  </svg>
                </div>
              </div>
            </div>
            <div class="flex justify-end space-x-3">
              <button
                onClick={() => setShowModal(false)}
                class="px-4 py-2 text-gray-400 hover:text-white transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={addServer}
                class="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-md transition-colors border border-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={!newServerDomain().trim()}
              >
                追加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 正しく実装されたエクスポート関数
export async function getTauriServerEndpoint() {
  try {
    const store = await getStore();
    return await store.get("serverEndpoint");
  } catch (error) {
    console.error("Failed to get server endpoint:", error);
    return null;
  }
}

export async function setTauriServerEndpoint(endpoint: string | null) {
  try {
    const store = await getStore();
    await store.set("serverEndpoint", endpoint);
    await store.save();
    return true;
  } catch (error) {
    console.error("Failed to set server endpoint:", error);
    throw error;
  }
}
