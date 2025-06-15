import {
  Component,
  createEffect,
  createSignal,
  For,
  onMount,
  Show,
} from "solid-js";
import ExtensionUpload from "./ExtensionUpload.tsx";
import ExtensionRegistry from "./ExtensionRegistry.tsx";

// アカウントデータの型定義
type Account = {
  id: string;
  userName: string;
  displayName: string;
  avatarInitial: string;
};

// Helper function to check if a string is a data URL
const isDataUrl = (str: string) => str.startsWith("data:image/");

// アカウント設定コンテンツコンポーネント
const AccountSettingsContent: Component<{
  accounts: Account[];
  selectedAccountId: string;
  setSelectedAccountId: (id: string) => void;
  addNewAccount: () => void;
  updateAccount: (id: string, updates: Partial<Account>) => void;
  deleteAccount: (id: string) => void;
  isMobileView: boolean;
}> = (props) => {
  const selectedAccount = () =>
    props.accounts.find((account) => account.id === props.selectedAccountId);

  // ローカル編集状態
  const [editingDisplayName, setEditingDisplayName] = createSignal("");
  const [editingUserName, setEditingUserName] = createSignal("");
  const [editingIcon, setEditingIcon] = createSignal(""); // データURLまたはサーバーからの初期値
  const [hasChanges, setHasChanges] = createSignal(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = createSignal(false);

  // 選択されたアカウントが変更されたときにローカル状態を更新
  createEffect(() => {
    const account = selectedAccount();
    if (account) {
      setEditingDisplayName(account.displayName);
      setEditingUserName(account.userName);
      setEditingIcon(account.avatarInitial); // avatarInitialはデータURLまたはサーバーからの初期値
      setHasChanges(false);
    }
  });

  const handleSave = () => {
    const account = selectedAccount();
    if (!account || !hasChanges()) return;

    const updates: Partial<Account> = {};
    if (editingDisplayName() !== account.displayName) {
      updates.displayName = editingDisplayName();
    }
    if (editingUserName() !== account.userName) {
      updates.userName = editingUserName();
    }
    if (editingIcon() !== account.avatarInitial) {
      updates.avatarInitial = editingIcon();
    }

    if (Object.keys(updates).length > 0) {
      props.updateAccount(props.selectedAccountId, updates);
      setHasChanges(false);
    }
  };

  const handleDelete = () => {
    const account = selectedAccount();
    if (!account) return;

    props.deleteAccount(props.selectedAccountId);
    setShowDeleteConfirm(false);
  };

  const checkForChanges = () => {
    const account = selectedAccount();
    if (!account) return;

    const hasDisplayNameChange = editingDisplayName() !== account.displayName;
    const hasUserNameChange = editingUserName() !== account.userName;
    const hasIconChange = editingIcon() !== account.avatarInitial;
    setHasChanges(hasDisplayNameChange || hasUserNameChange || hasIconChange);
  };

  // アイコンプレビュー用の関数
  const IconPreview: Component<
    { iconValue: string; displayNameValue: string; class?: string }
  > = (p) => {
    const displayIcon = () => {
      const icon = p.iconValue?.trim();
      if (icon && isDataUrl(icon)) {
        return (
          <img
            src={icon}
            alt="icon"
            class="h-full w-full object-cover rounded-full"
          />
        );
      }
      // データURLでない場合は、表示名からイニシャルを生成
      const initials = p.displayNameValue?.charAt(0).toUpperCase() || "?";
      return initials.substring(0, 2);
    };
    return <div class={p.class}>{displayIcon()}</div>;
  };

  const handleFileChange = (e: Event) => {
    const files = (e.target as HTMLInputElement).files;
    if (files && files[0]) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setEditingIcon(event.target?.result as string);
        checkForChanges();
      };
      reader.readAsDataURL(files[0]);
    }
  };

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
                type="button"
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
                <IconPreview
                  iconValue={account.avatarInitial}
                  displayNameValue={account.displayName}
                  class="h-12 w-12 rounded-full bg-teal-600/80 text-white flex items-center justify-center text-xl font-normal"
                />
                <span class="mt-2 text-sm truncate text-gray-200">
                  {account.displayName}
                </span>
              </button>
            )}
          </For>

          <button
            type="button"
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
            <IconPreview
              iconValue={editingIcon()} // editingIcon はデータURLか、元の avatarInitial (イニシャル文字列)
              displayNameValue={editingDisplayName()}
              class="h-16 w-16 rounded-full bg-teal-600/80 text-white flex items-center justify-center text-2xl"
            />
            <div>
              <h3 class="text-lg font-normal text-gray-100">
                {editingDisplayName()}
              </h3>
              <p class="text-sm text-gray-400">@{editingUserName()}</p>
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
                value={editingDisplayName()}
                onInput={(e) => {
                  setEditingDisplayName(e.currentTarget.value);
                  checkForChanges();
                }}
              />
            </div>
            <div>
              <label class="block text-sm text-gray-300 mb-1.5">
                ユーザー名
              </label>
              <input
                type="text"
                class="w-full bg-gray-700/70 border border-gray-600/50 rounded px-3 py-2 text-sm text-gray-100
                       focus:outline-none focus:ring-1 focus:ring-teal-500/50 focus:border-teal-500/50"
                placeholder="ユーザー名を入力"
                value={editingUserName()}
                onInput={(e) => {
                  setEditingUserName(e.currentTarget.value);
                  checkForChanges();
                }}
              />
            </div>
            <div>
              <label class="block text-sm text-gray-300 mb-1.5">
                アイコン画像
              </label>
              <input
                type="file"
                accept="image/*"
                class="w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4
                       file:rounded-full file:border-0 file:text-sm file:font-semibold
                       file:bg-teal-600/80 file:text-white hover:file:bg-teal-700/80"
                onInput={handleFileChange}
              />
              <p class="text-xs text-gray-400 mt-1">
                画像をアップロードすると、表示名の最初の文字から生成されるイニシャルの代わりに表示されます。
              </p>
            </div>
          </div>
          <button
            type="button"
            class={`w-full py-2 text-sm transition-colors duration-200 rounded ${
              hasChanges()
                ? "bg-teal-700 hover:bg-teal-600 text-white"
                : "bg-gray-600/70 text-gray-400 cursor-not-allowed"
            }`}
            onClick={handleSave}
            disabled={!hasChanges()}
          >
            {hasChanges() ? "変更を保存" : "更新"}
          </button>

          {/* 削除ボタン */}
          <div class="pt-3 border-t border-gray-600/50">
            <Show when={!showDeleteConfirm()}>
              <button
                type="button"
                class="w-full py-2 text-sm bg-red-600/80 hover:bg-red-600 text-white rounded transition-colors duration-200"
                onClick={() => setShowDeleteConfirm(true)}
              >
                アカウントを削除
              </button>
            </Show>

            <Show when={showDeleteConfirm()}>
              <div class="space-y-3">
                <p class="text-sm text-red-400 text-center">
                  本当にこのアカウントを削除しますか？
                </p>
                <div class="flex space-x-3">
                  <button
                    type="button"
                    class="flex-1 py-2 text-sm bg-gray-600/70 hover:bg-gray-600 text-gray-200 rounded transition-colors duration-200"
                    onClick={() => setShowDeleteConfirm(false)}
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    class="flex-1 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded transition-colors duration-200"
                    onClick={handleDelete}
                  >
                    削除する
                  </button>
                </div>
              </div>
            </Show>
          </div>
        </form>
      </Show>
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

      <button
        type="button"
        class="w-full mt-4 bg-transparent hover:bg-gray-700/70 text-gray-400 hover:text-gray-200 py-2 px-4 border border-gray-600/50 rounded transition-colors duration-200"
      >
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
  const [accounts, setAccounts] = createSignal<Account[]>([]);

  // 現在選択中のアカウントID
  const [selectedAccountId, setSelectedAccountId] = createSignal("");

  // エラーメッセージと成功メッセージ用のシグナル
  const [errorMessage, setErrorMessage] = createSignal("");
  const [successMessage, setSuccessMessage] = createSignal("");

  // メッセージを自動で消去する関数
  const showMessage = (message: string, isError: boolean = false) => {
    if (isError) {
      setErrorMessage(message);
      setSuccessMessage("");
      setTimeout(() => setErrorMessage(""), 5000);
    } else {
      setSuccessMessage(message);
      setErrorMessage("");
      setTimeout(() => setSuccessMessage(""), 3000);
    }
  };

  // APIでアカウント一覧を取得
  const loadAccounts = async (preserveSelectedId?: string) => {
    try {
      const response = await fetch("/api/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events: [{
            eventId: "accounts:list",
            identifier: "takos",
            payload: {},
          }],
        }),
      });
      const results = await response.json();
      if (results[0]?.success) {
        setAccounts(results[0].result || []);

        // 選択中のIDを保持するか、初期選択を行う
        if (preserveSelectedId) {
          // 指定されたIDのアカウントが存在するかチェック
          const accountExists = results[0].result?.some((acc: Account) =>
            acc.id === preserveSelectedId
          );
          if (accountExists) {
            setSelectedAccountId(preserveSelectedId);
          } else if (results[0].result?.length > 0) {
            setSelectedAccountId(results[0].result[0].id);
          }
        } else if (results[0].result?.length > 0 && !selectedAccountId()) {
          // 初回読み込み時のみ最初のアカウントを選択
          setSelectedAccountId(results[0].result[0].id);
        }
      }
    } catch (error) {
      console.error("Failed to load accounts:", error);
    }
  };

  // 新規アカウント追加機能
  const addNewAccount = async () => {
    const username = `user${Date.now()}`;
    try {
      setErrorMessage(""); // エラーメッセージをクリア
      setSuccessMessage("");
      const response = await fetch("/api/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events: [{
            eventId: "accounts:create",
            identifier: "takos",
            payload: { username },
          }],
        }),
      });
      const results = await response.json();
      if (results[0]?.success) {
        const newAccountId = results[0].result.id;
        await loadAccounts(newAccountId); // 新規作成されたアカウントを選択
        setSelectedAccountId(newAccountId);
        showMessage("アカウントを作成しました");
      } else {
        showMessage(
          results[0]?.error || "アカウントの作成に失敗しました",
          true,
        );
      }
    } catch (error) {
      console.error("Failed to create account:", error);
      showMessage("アカウントの作成に失敗しました", true);
    }
  };

  // アカウント更新機能
  const updateAccount = async (id: string, updates: Partial<Account>) => {
    try {
      setErrorMessage("");
      setSuccessMessage("");
      const currentAccount = accounts().find((acc) => acc.id === id);
      if (!currentAccount) return;

      const payload: Record<string, unknown> = {
        username: currentAccount.userName,
      };

      if (updates.userName) {
        payload.newUsername = updates.userName;
      }

      if (updates.displayName) {
        payload.newDisplayName = updates.displayName;
      }

      // アイコンの処理
      if (updates.avatarInitial !== undefined) { // editingIcon() が元の値から変更された場合
        if (isDataUrl(updates.avatarInitial)) {
          payload.icon = updates.avatarInitial;
        } else { // データURLでない場合、または画像がクリアされた場合を想定し、表示名からイニシャルを生成
          const baseDisplayName = updates.displayName ||
            currentAccount.displayName;
          payload.icon = (baseDisplayName.charAt(0).toUpperCase() || "?")
            .substring(0, 2);
        }
      } else if (updates.displayName) {
        // アイコンはファイルアップロード等で明示的に変更されなかったが、表示名が変更された場合
        // かつ、現在のアイコンがデータURLでない（つまりイニシャルである）場合のみ、イニシャルを更新
        if (!isDataUrl(currentAccount.avatarInitial)) {
          payload.icon = (updates.displayName.charAt(0).toUpperCase() || "?")
            .substring(0, 2);
        }
        // 現在のアイコンが画像の場合は、表示名変更だけではアイコンは変更しない
      }
      // payload.icon が未定義の場合、サーバー側はアイコンを変更しない

      const response = await fetch("/api/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events: [{
            eventId: "accounts:edit",
            identifier: "takos",
            payload,
          }],
        }),
      });
      const results = await response.json();
      if (results[0]?.success) {
        const updatedAccountId = results[0].result.id;
        await loadAccounts(updatedAccountId); // 更新されたアカウントを選択状態で保持
        showMessage("アカウントを更新しました");
      } else {
        showMessage(
          results[0]?.error || "アカウントの更新に失敗しました",
          true,
        );
        console.error("Update failed:", results[0]);
      }
    } catch (error) {
      console.error("Failed to update account:", error);
      showMessage("アカウントの更新に失敗しました", true);
    }
  };

  // アカウント削除機能
  const deleteAccount = async (id: string) => {
    try {
      setErrorMessage("");
      setSuccessMessage("");

      const currentAccount = accounts().find((acc) => acc.id === id);
      if (!currentAccount) return;

      const response = await fetch("/api/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events: [{
            eventId: "accounts:delete",
            identifier: "takos",
            payload: { username: currentAccount.userName },
          }],
        }),
      });

      const results = await response.json();
      if (results[0]?.success) {
        // アカウント一覧を再読み込み
        await loadAccounts();
        showMessage("アカウントを削除しました");

        // 削除されたアカウントが選択されていた場合、別のアカウントを選択
        const remainingAccounts = accounts();
        if (remainingAccounts.length > 0) {
          setSelectedAccountId(remainingAccounts[0].id);
        } else {
          setSelectedAccountId("");
        }
      } else {
        showMessage(
          results[0]?.error || "アカウントの削除に失敗しました",
          true,
        );
      }
    } catch (error) {
      console.error("Failed to delete account:", error);
      showMessage("アカウントの削除に失敗しました", true);
    }
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
      const tabs = ["account", "notifications"];
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
    setIsMobileView(globalThis.innerWidth < 1024);
  };

  // コンポーネントマウント時の処理
  onMount(() => {
    checkViewport();
    globalThis.addEventListener("resize", checkViewport);
    loadAccounts(); // アカウントデータを読み込み
  });

  return (
    <div class="min-h-screen bg-[#121212] text-gray-100">
      {/* エラーメッセージ表示 */}
      <Show when={errorMessage()}>
        <div class="fixed top-4 right-4 bg-red-600/90 text-white px-4 py-2 rounded-lg shadow-lg z-50">
          <div class="flex items-center space-x-2">
            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fill-rule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                clip-rule="evenodd"
              />
            </svg>
            <span class="text-sm">{errorMessage()}</span>
            <button
              type="button"
              onClick={() => setErrorMessage("")}
              class="ml-2 text-white/80 hover:text-white"
            >
              ×
            </button>
          </div>
        </div>
      </Show>

      {/* 成功メッセージ表示 */}
      <Show when={successMessage()}>
        <div class="fixed top-4 right-4 bg-green-600/90 text-white px-4 py-2 rounded-lg shadow-lg z-50">
          <div class="flex items-center space-x-2">
            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fill-rule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clip-rule="evenodd"
              />
            </svg>
            <span class="text-sm">{successMessage()}</span>
            <button
              type="button"
              onClick={() => setSuccessMessage("")}
              class="ml-2 text-white/80 hover:text-white"
            >
              ×
            </button>
          </div>
        </div>
      </Show>

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
              type="button"
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
              type="button"
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
              deleteAccount={deleteAccount}
              isMobileView
            />
          </Show>

          <Show when={activeTab() === "notifications"}>
            <NotificationsContent isMobileView />
          </Show>
        </div>
      </Show>

      {/* デスクトップ版（全コンテンツ同時表示） */}
      <Show when={!isMobileView()}>
        <div class="container mx-auto p-6">
          <div class="flex justify-between items-center mb-6">
            <h1 class="text-xl font-medium text-teal-400">Takos Dashboard</h1>

            <div class="flex items-center">
              <button
                type="button"
                class="bg-teal-700 hover:bg-teal-600 text-white py-1.5 px-4 rounded flex items-center mr-4 transition-colors duration-200"
              >
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

              <button
                type="button"
                class="text-gray-400 hover:text-gray-200 py-1 px-2 rounded-full hover:bg-gray-700/50 transition-colors duration-200"
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
                deleteAccount={deleteAccount}
                isMobileView={false}
              />
            </div>

            {/* 通知セクション */}
            <div class="bg-[#181818]/90 rounded-lg shadow-md p-4 min-h-[600px]">
              <NotificationsContent isMobileView={false} />
            </div>

            {/* Extension upload */}
            <div class="bg-[#181818]/90 rounded-lg shadow-md p-4 min-h-[600px]">
              <ExtensionUpload />
            </div>
            {/* Extension registry */}
            <div class="bg-[#181818]/90 rounded-lg shadow-md p-4 min-h-[600px]">
              <ExtensionRegistry />
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
