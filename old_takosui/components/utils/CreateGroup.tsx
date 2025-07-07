import { atom, useAtom } from "solid-jotai";
import { createEffect, createSignal } from "solid-js";
import { arrayBufferToBase64, base64ToArrayBuffer } from "../../utils/buffers";
import { TakosFetch } from "../../utils/TakosFetch";

export const shoowGroupPopUp = atom(false);
export const showGroupfindPopUp = atom(false);

export function CreateGroupPopUp() {
  return (
    <div>
      <CreateGroup />
      <GroupFindPopUp />
    </div>
  );
}

// グループ検索ポップアップ
export function GroupFindPopUp() {
  const [showFindPopUp, setShowFindPopUp] = useAtom(showGroupfindPopUp);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [searchResults, setSearchResults] = createSignal<{
    id: string;
    name: string;
    icon: string | null;
    memberCount: number;
    allowJoin: boolean;
  }[]>([]);
  const [isLoading, setIsLoading] = createSignal(false);
  // サーバー選択のための状態を追加
  const [selectedServer, setSelectedServer] = createSignal(location.hostname);
  // サーバー編集モーダルの表示状態
  const [showServerModal, setShowServerModal] = createSignal(false);
  // 新しいサーバーの入力値
  const [newServerUrl, setNewServerUrl] = createSignal("");

  // 利用可能なサーバーのリスト（ローカルストレージから読み込む）
  const [availableServers, setAvailableServers] = createSignal([
    { id: location.hostname, name: location.hostname },
  ]);

  // コンポーネントの初期化時にローカルストレージからサーバーリストを読み込む
  createEffect(() => {
    const savedServers = localStorage.getItem("takos-servers");
    if (savedServers) {
      try {
        const parsedServers = JSON.parse(savedServers);
        if (Array.isArray(parsedServers) && parsedServers.length > 0) {
          setAvailableServers(parsedServers);
        }
      } catch (e) {
        console.error("サーバーリストの読み込みに失敗しました", e);
      }
    }
  });

  // サーバーを追加する関数
  function addServer() {
    if (!newServerUrl().trim()) return;

    const serverUrl = newServerUrl().trim();
    // 既に同じサーバーが存在するか確認
    if (availableServers().some((server) => server.id === serverUrl)) {
      alert("既に追加済みのサーバーです");
      return;
    }

    const updatedServers = [
      ...availableServers(),
      { id: serverUrl, name: serverUrl },
    ];

    setAvailableServers(updatedServers);
    setNewServerUrl("");

    // ローカルストレージに保存
    localStorage.setItem("takos-servers", JSON.stringify(updatedServers));
  }

  // サーバーを削除する関数
  function removeServer(serverId: string) {
    const updatedServers = availableServers().filter((server) =>
      server.id !== serverId
    );
    setAvailableServers(updatedServers);

    if (selectedServer() === serverId) {
      setSelectedServer("default");
    }

    // ローカルストレージに保存
    localStorage.setItem("takos-servers", JSON.stringify(updatedServers));
  }

  async function handleSearch() {
    if (!searchQuery().trim()) {
      alert("検索キーワードを入力してください");
      return;
    }

    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      params.append("query", searchQuery());
      const res = await TakosFetch(
        `https://${selectedServer()}/_takos/v1/group/search?${params.toString()}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

      if (res.status === 200) {
        const data = await res.json();
        setSearchResults(data.groups || []);
      } else {
        console.error("検索に失敗しました", res.status);
        setSearchResults([]);
      }
    } catch (error) {
      console.error("検索エラー:", error);
      setSearchResults([]);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <>
      {showFindPopUp() && (
        <div
          class="fixed inset-0 z-[500000] flex items-center justify-center bg-[rgba(0,0,0,0.5)] p-4 animate-fadeIn"
          role="dialog"
          aria-modal="true"
        >
          <div class="bg-[#242424] rounded-lg shadow-2xl w-full max-w-md">
            {/* ヘッダー */}
            <div class="flex items-center justify-between border-b border-gray-700 px-5 py-3">
              <h2 class="text-xl font-semibold text-white">グループを探す</h2>
              <button
                onClick={() => setShowFindPopUp(false)}
                aria-label="閉じる"
                class="text-gray-400 hover:text-white text-2xl transition-colors"
              >
                &times;
              </button>
            </div>

            {/* 検索フォーム */}
            <div class="p-6 space-y-6">
              <div class="space-y-4">
                {/* サーバー選択 */}
                <div class="mb-3">
                  <div class="flex items-center justify-between mb-2">
                    <label class="text-white text-sm font-medium">
                      サーバーを選択
                    </label>
                    <button
                      onClick={() => setShowServerModal(true)}
                      class="text-blue-400 hover:text-blue-300 text-sm focus:outline-none"
                    >
                      編集
                    </button>
                  </div>
                  <select
                    value={selectedServer()}
                    onChange={(e) => setSelectedServer(e.currentTarget.value)}
                    class="w-full px-4 py-2 rounded border border-gray-600 bg-gray-800 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                  >
                    {availableServers().map((server) => (
                      <option value={server.id}>{server.name}</option>
                    ))}
                  </select>
                </div>

                {/* 検索入力 */}
                <div class="flex space-x-2">
                  <input
                    type="text"
                    value={searchQuery()}
                    onInput={(e) => setSearchQuery(e.currentTarget.value)}
                    placeholder="グループ名を入力"
                    class="flex-1 px-4 py-2 rounded border border-gray-600 bg-gray-800 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                  />
                  <button
                    onClick={handleSearch}
                    disabled={isLoading()}
                    class="bg-blue-500 hover:bg-blue-600 text-white py-2 px-4 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed"
                  >
                    {isLoading() ? "検索中..." : "検索"}
                  </button>
                </div>
              </div>

              {/* 検索結果 */}
              <div class="mt-4">
                <h3 class="text-white text-lg font-medium mb-2">検索結果</h3>
                <div class="max-h-64 overflow-y-auto bg-gray-800 rounded-lg">
                  {isLoading()
                    ? (
                      <div class="flex justify-center items-center h-24">
                        <p class="text-gray-400">検索中...</p>
                      </div>
                    )
                    : searchResults().length > 0
                    ? (
                      <ul class="divide-y divide-gray-700">
                        {searchResults().map((group) => (
                          <li class="p-3 hover:bg-gray-700 cursor-pointer transition-colors">
                            <div class="flex items-center space-x-3">
                              {group.icon
                                ? (
                                  <img
                                    src={`data:image/png;base64,${group.icon}`}
                                    alt="グループアイコン"
                                    class="w-12 h-12 rounded-full object-cover"
                                  />
                                )
                                : (
                                  <div class="w-12 h-12 rounded-full bg-gray-700 flex items-center justify-center text-gray-400">
                                    アイコン
                                  </div>
                                )}
                              <div class="flex-1">
                                <h4 class="text-white
                              font-semibold">
                                  {group.name}
                                </h4>
                                <p class="text-gray-400 text-sm">
                                  {group.memberCount}人のメンバー
                                </p>
                              </div>
                              <button
                                onClick={async () => {
                                  if (group.allowJoin) {
                                    const res = await TakosFetch(
                                      `/api/v2/group/join`,
                                      {
                                        method: "POST",
                                        headers: {
                                          "Content-Type": "application/json",
                                        },
                                        body: JSON.stringify({
                                          groupId: group.id,
                                        }),
                                      },
                                    );
                                    if (res.status !== 200) {
                                      alert("グループ参加に失敗しました");
                                      return;
                                    }
                                    alert("グループに参加しました");
                                  } else {
                                    const res = await TakosFetch(
                                      `/api/v2/group/join/request`,
                                      {
                                        method: "POST",
                                        headers: {
                                          "Content-Type": "application/json",
                                        },
                                        body: JSON.stringify({
                                          groupId: group.id,
                                        }),
                                      },
                                    );
                                    if (res.status !== 200) {
                                      alert("参加リクエストに失敗しました");
                                      return;
                                    }
                                    alert("参加リクエストを送信しました");
                                  }
                                }}
                                class="bg-blue-500 hover:bg-blue-600 text-white py-2 px-4 rounded transition-colors focus:outline-none disabled:bg-blue-800 disabled:cursor-not-allowed"
                              >
                                {group.allowJoin
                                  ? "参加する"
                                  : "参加リクエスト"}
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )
                    : (
                      <div class="flex justify-center items-center h-24">
                        <p class="text-gray-400">
                          {searchQuery()
                            ? "該当するグループが見つかりませんでした"
                            : "検索キーワードを入力してください"}
                        </p>
                      </div>
                    )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {showServerModal() && (
        <div
          class="fixed inset-0 z-[600000] flex items-center justify-center bg-[rgba(0,0,0,0.5)] p-4 animate-fadeIn"
          role="dialog"
          aria-modal="true"
        >
          <div class="bg-[#242424] rounded-lg shadow-2xl w-full max-w-md">
            {/* ヘッダー */}
            <div class="flex items-center justify-between border-b border-gray-700 px-5 py-3">
              <h2 class="text-xl font-semibold text-white">サーバー設定</h2>
              <button
                onClick={() => setShowServerModal(false)}
                aria-label="閉じる"
                class="text-gray-400 hover:text-white text-2xl transition-colors"
              >
                &times;
              </button>
            </div>

            {/* コンテンツ */}
            <div class="p-6 space-y-6">
              {/* サーバー追加フォーム */}
              <div>
                <h3 class="text-white text-lg font-medium mb-2">
                  サーバー追加
                </h3>
                <div class="flex space-x-2">
                  <input
                    type="text"
                    value={newServerUrl()}
                    onInput={(e) => setNewServerUrl(e.currentTarget.value)}
                    placeholder="サーバーのURLを入力"
                    class="flex-1 px-4 py-2 rounded border border-gray-600 bg-gray-800 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                  />
                  <button
                    onClick={addServer}
                    class="bg-blue-500 hover:bg-blue-600 text-white py-2 px-4 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    追加
                  </button>
                </div>
              </div>

              {/* サーバーリスト */}
              <div>
                <h3 class="text-white text-lg font-medium mb-2">
                  登録済みサーバー
                </h3>
                <ul class="space-y-2 max-h-64 overflow-y-auto">
                  {availableServers().map((server) => (
                    <li class="flex items-center justify-between p-3 bg-gray-800 rounded">
                      <span class="text-white">{server.name}</span>
                      <button
                        onClick={() => removeServer(server.id)}
                        disabled={server.id === location.hostname}
                        class="text-red-400 hover:text-red-300 focus:outline-none disabled:text-gray-600 disabled:cursor-not-allowed"
                        title={server.id === location.hostname
                          ? "デフォルトサーバーは削除できません"
                          : "削除"}
                      >
                        削除
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              {/* 保存ボタン */}
              <div class="flex justify-end">
                <button
                  onClick={() => setShowServerModal(false)}
                  class="bg-blue-500 hover:bg-blue-600 text-white py-2 px-6 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  閉じる
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function CreateGroup() {
  const [showGroupPopUp, setShowGroupPopUp] = useAtom(shoowGroupPopUp);
  const [groupName, setGroupName] = createSignal("");
  // groupIcon は画像のBase64文字列または null を保持
  const [groupIcon, setGroupIcon] = createSignal<File | null>(null);
  const [iconPreview, setIconPreview] = createSignal<string | null>(null);
  // グループの公開設定（true: 公開、false: 非公開）
  const [isPublic, setIsPublic] = createSignal(true);

  async function handleSaveGroup() {
    const file = groupIcon();
    const reader = new FileReader();
    reader.onload = async () => {
      const arrayBuffer = reader.result as ArrayBuffer;
      const icon = arrayBufferToBase64(arrayBuffer);
      const name = groupName();
      if (!name) {
        alert("グループ名を入力してください");
        return;
      }
      if (!icon) {
        alert("アイコンを設定してください");
        return;
      }
      console.log(icon);
      const res = await TakosFetch("/api/v2/group/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: name,
          icon: icon,
          isPublic: isPublic(), // 公開設定を追加
        }),
      });
      if (res.status !== 200) {
        alert("グループ作成に失敗しました");
        return;
      }
      alert("グループを作成しました");
      setShowGroupPopUp(false);
    };
    reader.readAsArrayBuffer(file!);
  }

  return (
    <>
      {showGroupPopUp() && (
        <div
          class="fixed inset-0 z-[500000] flex items-center justify-center bg-[rgba(0,0,0,0.5)] p-4 animate-fadeIn"
          role="dialog"
          aria-modal="true"
        >
          <div class="bg-[#242424] rounded-lg shadow-2xl w-full max-w-md">
            {/* ヘッダー */}
            <div class="flex items-center justify-between border-b border-gray-700 px-5 py-3">
              <h2 class="text-xl font-semibold text-white">グループ</h2>
              <button
                onClick={() => setShowGroupPopUp(false)}
                aria-label="閉じる"
                class="text-gray-400 hover:text-white text-2xl transition-colors"
              >
                &times;
              </button>
            </div>
            {/* 設定コンテンツ */}
            <div class="p-6 space-y-6">
              {/* アイコン設定 + グループ名 */}
              <div class="flex flex-col items-center space-y-4">
                {/* アイコン表示部分（クリックで画像選択） */}
                <label for="groupIcon" class="cursor-pointer">
                  {groupIcon()
                    ? (
                      <img
                        src={iconPreview()!}
                        alt="グループアイコン"
                        class="w-24 h-24 rounded-full object-cover border-2 border-gray-600"
                      />
                    )
                    : (
                      <div class="w-24 h-24 rounded-full bg-gray-700 flex items-center justify-center text-gray-400 border-2 border-gray-600">
                        アイコン
                      </div>
                    )}
                </label>
                <input
                  id="groupIcon"
                  type="file"
                  accept="image/*"
                  class="hidden"
                  onChange={(e) => {
                    const file = e.currentTarget.files?.[0];
                    if (file) {
                      setGroupIcon(file);
                      const reader = new FileReader();
                      reader.onload = () => {
                        setIconPreview(reader.result as string);
                      };
                      reader.readAsDataURL(file);
                    } else {
                      setGroupIcon(null);
                    }
                  }}
                />
                {/* グループ名入力 */}
                <input
                  type="text"
                  value={groupName()}
                  onInput={(e) => setGroupName(e.currentTarget.value)}
                  placeholder="グループ名を入力"
                  class="w-full px-4 py-2 rounded border border-gray-600 bg-gray-800 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                />

                {/* 公開設定 */}
                <div class="w-full mt-4">
                  <p class="text-white mb-2">グループの公開設定</p>
                  <div class="flex space-x-4">
                    <label class="flex items-center cursor-pointer">
                      <input
                        type="radio"
                        name="visibility"
                        checked={isPublic()}
                        onChange={() => setIsPublic(true)}
                        class="mr-2"
                      />
                      <span class="text-white">公開</span>
                    </label>
                    <label class="flex items-center cursor-pointer">
                      <input
                        type="radio"
                        name="visibility"
                        checked={!isPublic()}
                        onChange={() => setIsPublic(false)}
                        class="mr-2"
                      />
                      <span class="text-white">非公開</span>
                    </label>
                  </div>
                  <p class="text-gray-400 text-sm mt-1">
                    {isPublic()
                      ? "公開グループは誰でも検索・閲覧できます"
                      : "非公開グループは招待されたメンバーのみ閲覧できます"}
                  </p>
                </div>
              </div>
              {/* 保存ボタン */}
              <div class="flex justify-end">
                <button
                  onClick={handleSaveGroup}
                  class="bg-blue-500 hover:bg-blue-600 text-white py-2 px-6 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  保存する
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
