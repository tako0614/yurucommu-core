import { Component, createSignal, For, onMount, Show } from "solid-js";

// アカウントデータの型定義
type Account = {
  id: string;
  displayName: string;
  email: string;
  avatarInitial: string;
};

// アカウント設定コンテンツコンポーネント
const AccountSettingsContent: Component<{
  accounts: Account[];
  selectedAccountId: string;
  setSelectedAccountId: (id: string) => void;
  addNewAccount: () => void;
  updateAccount: (id: string, updates: Partial<Account>) => void;
  isMobileView: boolean;
}> = (props) => {
  const selectedAccount = () =>
    props.accounts.find((account) => account.id === props.selectedAccountId);

  return (
    <div class={`${props.isMobileView ? "space-y-6" : "space-y-5"}`}>
      <Show when={props.isMobileView}>
        <h2 class="text-xl font-medium text-gray-100">アカウント設定</h2>
      </Show>
      <Show when={!props.isMobileView}>
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-lg font-medium text-gray-100">アカウント設定</h2>
          <div class="text-teal-400 hover:underline cursor-pointer text-sm">
            すべて表示
          </div>
        </div>
      </Show>

      {/* アカウント選択エリア */}
      <div class="bg-[#181918] rounded-lg shadow-md p-5 m-auto mb-2">
        <h3 class="text-lg font-normal mb-3 text-gray-200">アカウント選択</h3>
        <div class="flex space-x-3 overflow-x-auto pb-3 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <For each={props.accounts}>
            {(account) => (
              <button
                class={`
                  flex-shrink-0 flex flex-col items-center 
                  p-3 rounded-lg transition duration-200 
                  ${
                  props.selectedAccountId === account.id
                    ? "bg-teal-700/70 ring-1 ring-teal-500/50"
                    : "bg-gray-700/70 hover:bg-gray-600/70"
                }
                `}
                onClick={() => props.setSelectedAccountId(account.id)}
              >
                <div class="
                    h-12 w-12 rounded-full bg-teal-600/80 
                    text-white flex items-center justify-center 
                    text-xl font-normal
                  ">
                  {account.avatarInitial}
                </div>
                <span class="mt-2 text-sm truncate text-gray-200">
                  {account.displayName}
                </span>
              </button>
            )}
          </For>

          <button
            class="flex-shrink-0 flex flex-col items-center p-3 rounded-lg bg-gray-600/70 hover:bg-gray-500/70 transition duration-200"
            onClick={props.addNewAccount}
          >
            <div class="h-12 w-12 rounded-full bg-gray-200/90 flex items-center justify-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-5 w-5 text-gray-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                />
              </svg>
            </div>
            <span class="mt-2 text-sm text-gray-300">追加</span>
          </button>
        </div>
      </div>

      {/* アカウント設定フォーム */}
      <Show when={selectedAccount()}>
        <form class="bg-[#181918] rounded-lg shadow-md p-5 space-y-5 m-auto">
          <div class="flex items-center space-x-5">
            <div class="h-16 w-16 rounded-full bg-teal-600/80 flex items-center justify-center text-2xl text-white">
              {selectedAccount()?.avatarInitial}
            </div>
            <div>
              <h3 class="text-lg font-normal text-gray-100">
                {selectedAccount()?.displayName}
              </h3>
              <p class="text-sm text-gray-400">{selectedAccount()?.email}</p>
            </div>
          </div>
          <div class="space-y-4">
            <div>
              <label class="block text-sm text-gray-300 mb-1.5">表示名</label>
              <input
                type="text"
                class="w-full bg-gray-700/70 border border-gray-600/50 rounded px-3 py-2 text-sm text-gray-100
                       focus:outline-none focus:ring-1 focus:ring-teal-500/50 focus:border-teal-500/50"
                placeholder="表示名を入力"
                value={selectedAccount()?.displayName}
                onInput={(e) =>
                  props.updateAccount(props.selectedAccountId, {
                    displayName: e.currentTarget.value,
                  })}
              />
            </div>
            <div>
              <label class="block text-sm text-gray-300 mb-1.5">
                メールアドレス
              </label>
              <input
                type="email"
                class="w-full bg-gray-700/70 border border-gray-600/50 rounded px-3 py-2 text-sm text-gray-100
                       focus:outline-none focus:ring-1 focus:ring-teal-500/50 focus:border-teal-500/50"
                placeholder="you@example.com"
                value={selectedAccount()?.email}
                onInput={(e) =>
                  props.updateAccount(props.selectedAccountId, {
                    email: e.currentTarget.value,
                  })}
              />
            </div>
          </div>
          <button
            type="button"
            class="w-full bg-teal-700 hover:bg-teal-600 text-white rounded py-2 text-sm transition-colors duration-200"
          >
            更新
          </button>
        </form>
      </Show>
    </div>
  );
};

// 拡張機能コンテンツコンポーネント
const ExtensionsContent: Component<{ isMobileView: boolean }> = (props) => {
  // ダミーの拡張機能データ
  const initialExtensionsData = [
    {
      id: 1,
      name: "テーマカラー変更",
      description: "エディタのテーマカラーをカスタマイズします。",
      author: "Takos Corp",
      iconInitial: "TC",
    },
    {
      id: 2,
      name: "Markdownプレビュー",
      description: "Markdownファイルをリアルタイムでプレビューします。",
      author: "SolidJS Community",
      iconInitial: "MP",
    },
    {
      id: 3,
      name: "コードスニペット",
      description: "よく使うコードのスニペット集。",
      author: "DevTools",
      iconInitial: "CS",
    },
    {
      id: 4,
      name: "Git連携強化",
      description: "Gitの操作をより簡単に行えるようにします。",
      author: "GitHub",
      iconInitial: "GI",
    },
  ];

  const [searchTerm, setSearchTerm] = createSignal("");

  const filteredExtensions = () => {
    const lowerSearchTerm = searchTerm().toLowerCase();
    if (!lowerSearchTerm) {
      return initialExtensionsData;
    }
    return initialExtensionsData.filter((ext) =>
      ext.name.toLowerCase().includes(lowerSearchTerm) ||
      ext.description.toLowerCase().includes(lowerSearchTerm) ||
      ext.author.toLowerCase().includes(lowerSearchTerm)
    );
  };

  return (
    <div class={`${props.isMobileView ? "space-y-4" : ""}`}>
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-lg font-medium text-gray-100">拡張機能管理</h2>
        <div class="text-teal-400 hover:underline cursor-pointer text-sm">
          ストアで他の拡張機能を探す
        </div>
      </div>
      <div class="mb-4">
        <input
          type="text"
          placeholder="拡張機能を検索 (例: @installed)"
          class="w-full bg-gray-700/70 border border-gray-600/50 rounded p-2 text-sm placeholder-gray-400 
                 focus:outline-none focus:ring-1 focus:ring-teal-500/50 focus:border-teal-500/50"
          value={searchTerm()}
          onInput={(e) => setSearchTerm(e.currentTarget.value)}
        />
      </div>
      <div class="space-y-2">
        <For each={filteredExtensions()}>
          {(ext) => (
            <div class="bg-[#181918] hover:bg-gray-700/90 transition-colors p-3 rounded-lg shadow-sm flex items-center space-x-3 m-auto mb-2">
              {/* アイコン */}
              <div
                class={`flex-shrink-0 w-10 h-10 rounded bg-teal-600/80 flex items-center justify-center text-white font-normal text-sm`}
              >
                {ext.iconInitial}
              </div>

              {/* 拡張機能情報 */}
              <div class="flex-grow min-w-0">
                <h3 class="font-normal text-gray-200 truncate">{ext.name}</h3>
                <p class="text-gray-400 text-xs truncate">{ext.description}</p>
                <span class="text-xs text-teal-400/90">{ext.author}</span>
              </div>

              {/* アクションボタン */}
              <div class="flex items-center space-x-2 flex-shrink-0">
                <button class="p-1.5 text-gray-400 hover:text-gray-200 hover:bg-gray-600/70 rounded">
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
                      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                    />
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                </button>
                <div class="relative inline-block w-9 align-middle">
                  <input
                    type="checkbox"
                    id={`toggle-${
                      props.isMobileView ? "mobile" : "desktop"
                    }-${ext.id}`}
                    class="opacity-0 absolute peer"
                    checked={ext.id % 2 === 0}
                  />
                  <label
                    for={`toggle-${
                      props.isMobileView ? "mobile" : "desktop"
                    }-${ext.id}`}
                    class={`block overflow-hidden h-4 w-8 rounded-full bg-gray-600/80 cursor-pointer peer-checked:bg-teal-600/70 transition-colors`}
                  >
                    <span
                      class={`block h-4 w-4 rounded-full bg-white/90 shadow-sm transform transition-transform peer-checked:translate-x-4`}
                    >
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}
        </For>
        <Show when={filteredExtensions().length === 0 && searchTerm()}>
          <p class="text-gray-400 text-center py-4">
            「{searchTerm()}」に一致する拡張機能は見つかりませんでした。
          </p>
        </Show>
      </div>
    </div>
  );
};

// 通知コンテンツコンポーネント
const NotificationsContent: Component<{ isMobileView: boolean }> = (props) => {
  return (
    <div class={`${props.isMobileView ? "space-y-4" : ""}`}>
      <Show when={props.isMobileView}>
        <h2 class="text-lg font-medium text-gray-100">通知</h2>
      </Show>
      <Show when={!props.isMobileView}>
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-lg font-medium text-gray-100">通知</h2>
          <div class="text-teal-400 hover:underline cursor-pointer text-sm">
            すべてをクリア
          </div>
        </div>
      </Show>
      <div class="space-y-3">
        <div class="bg-[#181918] p-3 rounded-lg shadow-sm border-l-3 border-teal-500/70">
          <div class="flex justify-between items-center mb-1">
            <h3 class="font-normal text-gray-200">システム通知</h3>
            <span class="text-xs text-gray-400">今日 12:30</span>
          </div>
          <p class="text-gray-300/90 text-sm">
            システムがアップデートされました。最新の機能をご利用いただけます。
          </p>
        </div>

        <div class="bg-[#181918] p-3 rounded-lg shadow-sm border-l-3 border-green-500/70">
          <div class="flex justify-between items-center mb-1">
            <h3 class="font-normal text-gray-200">タスク完了</h3>
            <span class="text-xs text-gray-400">今日 09:15</span>
          </div>
          <p class="text-gray-300/90 text-sm">
            データバックアップが正常に完了しました。
          </p>
        </div>

        <div class="bg-[#181918] p-3 rounded-lg shadow-sm border-l-3 border-amber-500/70">
          <div class="flex justify-between items-center mb-1">
            <h3 class="font-normal text-gray-200">警告</h3>
            <span class="text-xs text-gray-400">昨日 18:45</span>
          </div>
          <p class="text-gray-300/90 text-sm">
            ディスク容量が90%を超えています。不要なファイルの削除を検討してください。
          </p>
        </div>

        <div class="bg-[#181918] p-3 rounded-lg shadow-sm border-l-3 border-rose-500/70">
          <div class="flex justify-between items-center mb-1">
            <h3 class="font-normal text-gray-200">エラー通知</h3>
            <span class="text-xs text-gray-400">3日前</span>
          </div>
          <p class="text-gray-300/90 text-sm">
            拡張機能「拡張機能3」でエラーが発生しました。
          </p>
        </div>
      </div>

      <button class="w-full mt-4 bg-transparent hover:bg-gray-700/70 text-gray-400 hover:text-gray-200 py-2 px-4 border border-gray-600/50 rounded transition-colors duration-200">
        すべての通知を表示
      </button>
    </div>
  );
};

export function Dashboard() {
  const [activeTab, setActiveTab] = createSignal("account");
  const [touchStartX, setTouchStartX] = createSignal(0);
  const [isMobileView, setIsMobileView] = createSignal(false);

  // サンプルアカウントデータ
  const [accounts, setAccounts] = createSignal<Account[]>(
    [
      {
        id: "1",
        displayName: "ユーザー1",
        email: "user1@example.com",
        avatarInitial: "1",
      },
      {
        id: "2",
        displayName: "ユーザー2",
        email: "user2@example.com",
        avatarInitial: "2",
      },
      {
        id: "3",
        displayName: "ユーザー3",
        email: "user3@example.com",
        avatarInitial: "3",
      },
    ],
  );

  // 現在選択中のアカウントID
  const [selectedAccountId, setSelectedAccountId] = createSignal("1");

  // 新規アカウント追加機能
  const addNewAccount = () => {
    const newId = String(accounts().length + 1);
    const newAccount: Account = {
      id: newId,
      displayName: `新規ユーザー${newId}`,
      email: `new${newId}@example.com`,
      avatarInitial: `新`,
    };

    setAccounts([...accounts(), newAccount]);
    setSelectedAccountId(newId);
  };

  // アカウント更新機能
  const updateAccount = (id: string, updates: Partial<Account>) => {
    setAccounts(
      accounts().map((acc) => acc.id === id ? { ...acc, ...updates } : acc),
    );
  };

  // スワイプ機能の実装
  const handleTouchStart = (e: TouchEvent) => {
    setTouchStartX(e.touches[0].clientX);
  };

  const handleTouchEnd = (e: TouchEvent) => {
    const touchEndX = e.changedTouches[0].clientX;
    const diffX = touchEndX - touchStartX();

    // 左右のスワイプを検出（閾値: 50px）
    if (Math.abs(diffX) > 50) {
      const tabs = ["account", "extensions", "notifications"];
      const currentIndex = tabs.indexOf(activeTab());

      if (diffX > 0 && currentIndex > 0) {
        // 右にスワイプ → 前のタブ
        setActiveTab(tabs[currentIndex - 1]);
      } else if (diffX < 0 && currentIndex < tabs.length - 1) {
        // 左にスワイプ → 次のタブ
        setActiveTab(tabs[currentIndex + 1]);
      }
    }
  };

  // 画面サイズに応じたビュー切替
  const checkViewport = () => {
    setIsMobileView(window.innerWidth < 1024);
  };

  // コンポーネントマウント時の処理
  onMount(() => {
    checkViewport();
    window.addEventListener("resize", checkViewport);
  });

  return (
    <div class="min-h-screen bg-[#121212] text-gray-100">
      {/* モバイル用上部ナビ */}
      <Show when={isMobileView()}>
        <div
          class="bg-[#181818]/95 p-4 sticky top-0 z-10 shadow-md"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <div class="flex justify-center mb-2">
            <h1 class="text-xl font-medium text-teal-400">Takos Dashboard</h1>
          </div>

          <div class="flex justify-between border-b border-gray-700/70">
            <button
              class={`flex-1 py-2 text-center ${
                activeTab() === "account"
                  ? "text-teal-400 border-b-2 border-teal-400/70"
                  : "text-gray-400"
              }`}
              onClick={() => setActiveTab("account")}
            >
              アカウント
            </button>
            <button
              class={`flex-1 py-2 text-center ${
                activeTab() === "extensions"
                  ? "text-teal-400 border-b-2 border-teal-400/70"
                  : "text-gray-400"
              }`}
              onClick={() => setActiveTab("extensions")}
            >
              拡張機能
            </button>
            <button
              class={`flex-1 py-2 text-center ${
                activeTab() === "notifications"
                  ? "text-teal-400 border-b-2 border-teal-400/70"
                  : "text-gray-400"
              }`}
              onClick={() => setActiveTab("notifications")}
            >
              通知
              <span class="ml-1 bg-rose-500/80 text-white text-xs rounded-full h-4 w-4 inline-flex items-center justify-center">
                3
              </span>
            </button>
          </div>
        </div>

        {/* モバイル用コンテンツエリア */}
        <div
          class={`p-4 pt-28 mx-auto max-w-xl`} // pt-28 を追加してナビゲーションバーとの重なりを解消
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <Show when={activeTab() === "account"}>
            <AccountSettingsContent
              accounts={accounts()}
              selectedAccountId={selectedAccountId()}
              setSelectedAccountId={setSelectedAccountId}
              addNewAccount={addNewAccount}
              updateAccount={updateAccount}
              isMobileView={true}
            />
          </Show>

          <Show when={activeTab() === "extensions"}>
            <ExtensionsContent isMobileView={true} />
          </Show>

          <Show when={activeTab() === "notifications"}>
            <NotificationsContent isMobileView={true} />
          </Show>
        </div>
      </Show>

      {/* デスクトップ版（全コンテンツ同時表示） */}
      <Show when={!isMobileView()}>
        <div class="container mx-auto p-6">
          <div class="flex justify-between items-center mb-6">
            <h1 class="text-xl font-medium text-teal-400">Takos Dashboard</h1>

            <div class="flex items-center">
              <button class="bg-teal-700 hover:bg-teal-600 text-white py-1.5 px-4 rounded flex items-center mr-4 transition-colors duration-200">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-4 w-4 mr-1.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                  />
                </svg>
                新規作成
              </button>

              <button class="text-gray-400 hover:text-gray-200 py-1 px-2 rounded-full hover:bg-gray-700/50 transition-colors duration-200">
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
                    stroke-width="1.5"
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="1.5"
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* 3カラムレイアウト */}
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* アカウント設定セクション */}
            <div class="bg-[#181818]/90 rounded-lg shadow-md p-4 min-h-[600px]">
              <AccountSettingsContent
                accounts={accounts()}
                selectedAccountId={selectedAccountId()}
                setSelectedAccountId={setSelectedAccountId}
                addNewAccount={addNewAccount}
                updateAccount={updateAccount}
                isMobileView={false}
              />
            </div>

            {/* 拡張機能セクション */}
            <div class="bg-[#181818]/90 rounded-lg shadow-md p-4 min-h-[600px]">
              <ExtensionsContent isMobileView={false} />
            </div>

            {/* 通知セクション */}
            <div class="bg-[#181818]/90 rounded-lg shadow-md p-4 min-h-[600px]">
              <NotificationsContent isMobileView={false} />
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
