import {
  Component,
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { Setting } from "./Setting/index.tsx";

// アカウントデータの型定義
type Account = {
  id: string;
  userName: string;
  displayName: string;
  avatarInitial: string;
  publicKey?: string;
  followers?: string[];
  following?: string[];
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
}> = (props) => {
  const selectedAccount = () =>
    props.accounts.find((account) => account.id === props.selectedAccountId);

  // ローカル編集状態
  const [editingDisplayName, setEditingDisplayName] = createSignal("");
  const [editingUserName, setEditingUserName] = createSignal("");
  const [editingIcon, setEditingIcon] = createSignal(""); // データURLまたはサーバーからの初期値
  const [hasChanges, setHasChanges] = createSignal(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = createSignal(false);
  const [isLoading, setIsLoading] = createSignal(false);
  const [isSwitching, setIsSwitching] = createSignal(false);

  // アカウントが切り替わった際のアニメーション用
  createEffect(() => {
    props.selectedAccountId;
    setIsSwitching(true);
    const t = setTimeout(() => setIsSwitching(false), 300);
    onCleanup(() => clearTimeout(t));
  });

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

  const handleSave = async () => {
    const account = selectedAccount();
    if (!account || !hasChanges() || isLoading()) return;

    setIsLoading(true);
    try {
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
        await props.updateAccount(props.selectedAccountId, updates);
        setHasChanges(false);
      }
    } finally {
      setIsLoading(false);
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
    <div class="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
      {/* ヘッダーセクション */}
      <div class="text-center space-y-2">
        <h2 class="text-3xl font-bold text-gray-100">アカウント管理</h2>
        <p class="text-gray-400 max-w-2xl mx-auto">
          アカウントの追加、編集、削除を行い、あなたのプロファイルを管理しましょう
        </p>
      </div>

      {/* アカウント選択エリア */}
      <div class="bg-gradient-to-br from-[#1a1a1a] to-[#161616] rounded-2xl shadow-xl border border-gray-800/50 overflow-hidden">
        <div class="p-6 border-b border-gray-800/50">
          <div class="flex items-center justify-between">
            <h3 class="text-xl font-semibold text-gray-100">アカウント一覧</h3>
            <span class="text-sm text-gray-400 bg-gray-800/50 px-3 py-1 rounded-full">
              {props.accounts.length} アカウント
            </span>
          </div>
        </div>

        <div class="p-6">
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            <For each={props.accounts}>
              {(account) => (
                <button
                  type="button"
                  class={`group relative flex flex-col items-center p-4 rounded-xl transition-all duration-300 transform hover:scale-105 focus:scale-105 focus:outline-none focus:ring-2 focus:ring-teal-500/50 ${
                    props.selectedAccountId === account.id
                      ? "bg-gradient-to-br from-teal-600/20 to-teal-700/20 ring-2 ring-teal-500/50 shadow-lg shadow-teal-500/10"
                      : "bg-gray-800/30 hover:bg-gray-700/40 hover:shadow-lg"
                  }`}
                  onClick={() => props.setSelectedAccountId(account.id)}
                  aria-label={`${account.displayName}のアカウントを選択`}
                >
                  <div class="relative">
                    <IconPreview
                      iconValue={account.avatarInitial}
                      displayNameValue={account.displayName}
                      class="h-14 w-14 rounded-full bg-gradient-to-br from-teal-500 to-teal-600 text-white flex items-center justify-center text-lg font-semibold shadow-lg"
                    />
                    {props.selectedAccountId === account.id && (
                      <div class="absolute -top-1 -right-1 w-5 h-5 bg-teal-400 rounded-full flex items-center justify-center">
                        <svg
                          class="w-3 h-3 text-gray-900"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fill-rule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clip-rule="evenodd"
                          />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div class="mt-3 text-center">
                    <span class="block text-sm font-medium text-gray-200 truncate max-w-20">
                      {account.displayName}
                    </span>
                    <span class="block text-xs text-gray-400 truncate max-w-20">
                      @{account.userName}
                    </span>
                  </div>
                </button>
              )}
            </For>

            <button
              type="button"
              class="group flex flex-col items-center p-4 rounded-xl bg-gray-800/20 border-2 border-dashed border-gray-600/50 hover:border-teal-500/50 hover:bg-teal-500/5 transition-all duration-300 transform hover:scale-105 focus:scale-105 focus:outline-none focus:ring-2 focus:ring-teal-500/50"
              onClick={props.addNewAccount}
              aria-label="新しいアカウントを追加"
            >
              <div class="h-14 w-14 rounded-full bg-gradient-to-br from-gray-600 to-gray-700 group-hover:from-teal-500 group-hover:to-teal-600 flex items-center justify-center transition-all duration-300">
                <svg
                  class="h-6 w-6 text-gray-300 group-hover:text-white transition-colors duration-300"
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
              <div class="mt-3 text-center">
                <span class="block text-sm font-medium text-gray-300 group-hover:text-teal-400 transition-colors duration-300">
                  追加
                </span>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* アカウント設定フォーム */}
      <Show when={selectedAccount()}>
        <div
          class={`bg-gradient-to-br from-[#1a1a1a] to-[#161616] rounded-2xl shadow-xl border border-gray-800/50 overflow-hidden animate-in slide-in-from-right-4 duration-500 ${
            isSwitching() ? "account-switch" : ""
          }`}
        >
          <div class="p-6 border-b border-gray-800/50">
            <h3 class="text-xl font-semibold text-gray-100">アカウント設定</h3>
            <p class="text-gray-400 mt-1">プロファイル情報を編集できます</p>
          </div>

          <form class="p-6 space-y-6">
            {/* プロファイルヘッダー */}
            <div class="flex items-center space-x-6 p-6 bg-gray-800/20 rounded-xl">
              <div class="relative">
                <IconPreview
                  iconValue={editingIcon()}
                  displayNameValue={editingDisplayName()}
                  class="h-20 w-20 rounded-full bg-gradient-to-br from-teal-500 to-teal-600 text-white flex items-center justify-center text-2xl font-bold shadow-xl"
                />
                <div class="absolute -bottom-2 -right-2 w-8 h-8 bg-teal-500 rounded-full flex items-center justify-center shadow-lg">
                  <svg
                    class="w-4 h-4 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                    />
                  </svg>
                </div>
              </div>
              <div class="flex-1">
                <h4 class="text-2xl font-bold text-gray-100">
                  {editingDisplayName() || "名前未設定"}
                </h4>
                <p class="text-lg text-gray-400">
                  @{editingUserName() || "ユーザー名未設定"}
                </p>
                <div class="flex items-center mt-2 space-x-2">
                  <div class="w-2 h-2 bg-green-400 rounded-full"></div>
                  <span class="text-sm text-gray-400">アクティブ</span>
                </div>
              </div>
            </div>

            {/* フォームフィールド */}
            <div class="grid md:grid-cols-2 gap-6">
              <div class="space-y-2">
                <label class="block text-sm font-medium text-gray-300">
                  表示名
                </label>
                <input
                  type="text"
                  class="w-full bg-gray-800/50 border border-gray-600/50 rounded-xl px-4 py-3 text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500/50 focus:border-transparent transition-all duration-200"
                  placeholder="あなたの表示名を入力"
                  value={editingDisplayName()}
                  onInput={(e) => {
                    setEditingDisplayName(e.currentTarget.value);
                    checkForChanges();
                  }}
                />
              </div>

              <div class="space-y-2">
                <label class="block text-sm font-medium text-gray-300">
                  ユーザー名
                </label>
                <div class="relative">
                  <span class="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">
                    @
                  </span>
                  <input
                    type="text"
                    class="w-full bg-gray-800/50 border border-gray-600/50 rounded-xl pl-8 pr-4 py-3 text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500/50 focus:border-transparent transition-all duration-200"
                    placeholder="ユーザー名を入力"
                    value={editingUserName()}
                    onInput={(e) => {
                      setEditingUserName(e.currentTarget.value);
                      checkForChanges();
                    }}
                  />
                </div>
              </div>
            </div>

            <div class="space-y-2">
              <label class="block text-sm font-medium text-gray-300">
                プロフィール画像
              </label>
              <div class="flex items-center space-x-4">
                <input
                  type="file"
                  accept="image/*"
                  class="flex-1 text-sm text-gray-300 file:mr-4 file:py-3 file:px-6 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-teal-600 file:text-white hover:file:bg-teal-700 file:transition-colors file:duration-200 bg-gray-800/30 border border-gray-600/50 rounded-xl"
                  onInput={handleFileChange}
                />
              </div>
              <p class="text-xs text-gray-400 bg-gray-800/20 p-3 rounded-lg">
                💡
                画像をアップロードすると、自動生成されるイニシャルの代わりに表示されます
              </p>
            </div>

            {/* アクションボタン */}
            <div class="flex flex-col sm:flex-row gap-4 pt-6 border-t border-gray-800/50">
              <button
                type="button"
                class={`flex-1 flex items-center justify-center space-x-2 py-3 px-6 text-sm font-semibold rounded-xl transition-all duration-200 ${
                  hasChanges() && !isLoading()
                    ? "bg-gradient-to-r from-teal-600 to-teal-700 hover:from-teal-500 hover:to-teal-600 text-white shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
                    : "bg-gray-700/50 text-gray-400 cursor-not-allowed"
                }`}
                onClick={handleSave}
                disabled={!hasChanges() || isLoading()}
              >
                {isLoading()
                  ? (
                    <>
                      <svg
                        class="animate-spin h-4 w-4"
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
                      <span>保存中...</span>
                    </>
                  )
                  : (
                    <>
                      <svg
                        class="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                      <span>{hasChanges() ? "変更を保存" : "保存済み"}</span>
                    </>
                  )}
              </button>

              <Show when={!showDeleteConfirm()}>
                <button
                  type="button"
                  class="sm:w-auto px-6 py-3 text-sm font-semibold text-red-400 border border-red-400/30 rounded-xl hover:bg-red-400/10 hover:border-red-400/50 transition-all duration-200"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  削除
                </button>
              </Show>
            </div>

            {/* 削除確認 */}
            <Show when={showDeleteConfirm()}>
              <div class="bg-red-500/10 border border-red-500/20 rounded-xl p-6 space-y-4 animate-in slide-in-from-top-4 duration-300">
                <div class="flex items-center space-x-3">
                  <div class="w-10 h-10 bg-red-500/20 rounded-full flex items-center justify-center">
                    <svg
                      class="w-5 h-5 text-red-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                      />
                    </svg>
                  </div>
                  <div>
                    <h4 class="text-lg font-semibold text-red-400">
                      アカウントを削除
                    </h4>
                    <p class="text-sm text-gray-300">
                      この操作は取り消すことができません
                    </p>
                  </div>
                </div>
                <div class="flex flex-col sm:flex-row gap-3">
                  <button
                    type="button"
                    class="flex-1 py-3 px-4 text-sm font-medium text-gray-300 bg-gray-700/50 hover:bg-gray-600/50 rounded-xl transition-colors duration-200"
                    onClick={() => setShowDeleteConfirm(false)}
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    class="flex-1 py-3 px-4 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors duration-200"
                    onClick={handleDelete}
                  >
                    削除を実行
                  </button>
                </div>
              </div>
            </Show>
          </form>
        </div>
      </Show>
    </div>
  );
};

// 通知コンテンツコンポーネント
const NotificationsContent: Component = () => {
  return (
    <div class="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
      {/* ヘッダーセクション */}
      <div class="text-center space-y-2">
        <h2 class="text-3xl font-bold text-gray-100">通知センター</h2>
        <p class="text-gray-400 max-w-2xl mx-auto">
          システムからの重要な通知やアップデート情報を確認できます
        </p>
      </div>

      <div class="bg-gradient-to-br from-[#1a1a1a] to-[#161616] rounded-2xl shadow-xl border border-gray-800/50 overflow-hidden">
        <div class="p-6 border-b border-gray-800/50">
          <div class="flex items-center justify-between">
            <h3 class="text-xl font-semibold text-gray-100">最近の通知</h3>
            <button
              type="button"
              class="text-teal-400 hover:text-teal-300 text-sm font-medium transition-colors duration-200"
            >
              すべてをクリア
            </button>
          </div>
        </div>

        <div class="divide-y divide-gray-800/50">
          <div class="p-6 hover:bg-gray-800/20 transition-colors duration-200 border-l-4 border-teal-500">
            <div class="flex items-start space-x-4">
              <div class="w-10 h-10 bg-teal-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                <svg
                  class="w-5 h-5 text-teal-400"
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
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between mb-2">
                  <h4 class="text-lg font-semibold text-gray-100">
                    システム通知
                  </h4>
                  <span class="text-xs text-gray-400 bg-gray-800/50 px-2 py-1 rounded-full">
                    今日 12:30
                  </span>
                </div>
                <p class="text-gray-300 text-sm leading-relaxed">
                  システムがアップデートされました。最新の機能をご利用いただけます。
                </p>
              </div>
            </div>
          </div>

          <div class="p-6 hover:bg-gray-800/20 transition-colors duration-200 border-l-4 border-green-500">
            <div class="flex items-start space-x-4">
              <div class="w-10 h-10 bg-green-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                <svg
                  class="w-5 h-5 text-green-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between mb-2">
                  <h4 class="text-lg font-semibold text-gray-100">
                    タスク完了
                  </h4>
                  <span class="text-xs text-gray-400 bg-gray-800/50 px-2 py-1 rounded-full">
                    今日 09:15
                  </span>
                </div>
                <p class="text-gray-300 text-sm leading-relaxed">
                  データバックアップが正常に完了しました。
                </p>
              </div>
            </div>
          </div>

          <div class="p-6 hover:bg-gray-800/20 transition-colors duration-200 border-l-4 border-amber-500">
            <div class="flex items-start space-x-4">
              <div class="w-10 h-10 bg-amber-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                <svg
                  class="w-5 h-5 text-amber-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                  />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between mb-2">
                  <h4 class="text-lg font-semibold text-gray-100">警告</h4>
                  <span class="text-xs text-gray-400 bg-gray-800/50 px-2 py-1 rounded-full">
                    昨日 18:45
                  </span>
                </div>
                <p class="text-gray-300 text-sm leading-relaxed">
                  ディスク容量が90%を超えています。不要なファイルの削除を検討してください。
                </p>
              </div>
            </div>
          </div>

          <div class="p-6 hover:bg-gray-800/20 transition-colors duration-200 border-l-4 border-rose-500">
            <div class="flex items-start space-x-4">
              <div class="w-10 h-10 bg-rose-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                <svg
                  class="w-5 h-5 text-rose-400"
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
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between mb-2">
                  <h4 class="text-lg font-semibold text-gray-100">
                    エラー通知
                  </h4>
                  <span class="text-xs text-gray-400 bg-gray-800/50 px-2 py-1 rounded-full">
                    3日前
                  </span>
                </div>
                <p class="text-gray-300 text-sm leading-relaxed">
                  拡張機能「拡張機能3」でエラーが発生しました。
                </p>
              </div>
            </div>
          </div>
        </div>

        <div class="p-6 border-t border-gray-800/50">
          <button
            type="button"
            class="w-full py-3 px-4 text-sm font-medium text-gray-400 hover:text-gray-200 bg-transparent hover:bg-gray-800/30 border border-gray-600/30 hover:border-gray-500/50 rounded-xl transition-all duration-200"
          >
            すべての通知を表示
          </button>
        </div>
      </div>
    </div>
  );
};

export function Home() {
  const [activeSection, setActiveSection] = createSignal("account");

  // サンプルアカウントデータ
  const [accounts, setAccounts] = createSignal<Account[]>([]);

  // 現在選択中のアカウントID
  const [selectedAccountId, setSelectedAccountId] = createSignal("");

  // APIでアカウント一覧を取得
  const loadAccounts = async (preserveSelectedId?: string) => {
    try {
      const response = await fetch("/api/accounts");
      const results = await response.json();
      setAccounts(results || []);

      if (preserveSelectedId) {
        const accountExists = results.some((acc: Account) =>
          acc.id === preserveSelectedId
        );
        if (accountExists) {
          setSelectedAccountId(preserveSelectedId);
        } else if (results.length > 0) {
          setSelectedAccountId(results[0].id);
        }
      } else if (results.length > 0 && !selectedAccountId()) {
        setSelectedAccountId(results[0].id);
      }
    } catch (error) {
      console.error("Failed to load accounts:", error);
    }
  };

  // 新規アカウント追加機能
  const addNewAccount = async () => {
    const username = `user${Date.now()}`;
    try {
      const response = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const result = await response.json();
      const newAccountId = result.id;
      await loadAccounts(newAccountId);
      setSelectedAccountId(newAccountId);
    } catch (error) {
      console.error("Failed to create account:", error);
    }
  };

  // アカウント更新機能
  const updateAccount = async (id: string, updates: Partial<Account>) => {
    try {
      const currentAccount = accounts().find((acc) => acc.id === id);
      if (!currentAccount) return;

      const payload: Record<string, unknown> = {};

      if (updates.userName) {
        payload.userName = updates.userName;
      }

      if (updates.displayName) {
        payload.displayName = updates.displayName;
      }

      // アイコンの処理
      if (updates.avatarInitial !== undefined) { // editingIcon() が元の値から変更された場合
        if (isDataUrl(updates.avatarInitial)) {
          payload.avatarInitial = updates.avatarInitial;
        } else { // データURLでない場合、または画像がクリアされた場合を想定し、表示名からイニシャルを生成
          const baseDisplayName = updates.displayName ||
            currentAccount.displayName;
          payload.avatarInitial =
            (baseDisplayName.charAt(0).toUpperCase() || "?")
              .substring(0, 2);
        }
      } else if (updates.displayName) {
        // アイコンはファイルアップロード等で明示的に変更されなかったが、表示名が変更された場合
        // かつ、現在のアイコンがデータURLでない（つまりイニシャルである）場合のみ、イニシャルを更新
        if (!isDataUrl(currentAccount.avatarInitial)) {
          payload.avatarInitial =
            (updates.displayName.charAt(0).toUpperCase() || "?")
              .substring(0, 2);
        }
        // 現在のアイコンが画像の場合は、表示名変更だけではアイコンは変更しない
      }
      // payload.avatarInitial が未定義の場合、サーバー側はアイコンを変更しない

      const response = await fetch(`/api/accounts/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (result.id) {
        await loadAccounts(result.id);
      } else {
        console.error("Update failed:", result);
      }
    } catch (error) {
      console.error("Failed to update account:", error);
    }
  };

  // アカウント削除機能
  const deleteAccount = async (id: string) => {
    try {
      const currentAccount = accounts().find((acc) => acc.id === id);
      if (!currentAccount) return;

      const response = await fetch(`/api/accounts/${id}`, {
        method: "DELETE",
      });

      if (response.ok) {
        await loadAccounts();
        const remainingAccounts = accounts();
        if (remainingAccounts.length > 0) {
          setSelectedAccountId(remainingAccounts[0].id);
        } else {
          setSelectedAccountId("");
        }
      } else {
        console.error("アカウントの削除に失敗しました");
      }
    } catch (error) {
      console.error("Failed to delete account:", error);
    }
  };

  onMount(() => {
    loadAccounts();
  });

  const renderContent = () => {
    switch (activeSection()) {
      case "account":
        return (
          <AccountSettingsContent
            accounts={accounts()}
            selectedAccountId={selectedAccountId()}
            setSelectedAccountId={setSelectedAccountId}
            addNewAccount={addNewAccount}
            updateAccount={updateAccount}
            deleteAccount={deleteAccount}
          />
        );
      case "notifications":
        return <NotificationsContent />;
      case "settings":
        return (
          <div class="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
            <div class="text-center space-y-2">
              <h2 class="text-3xl font-bold text-gray-100">システム設定</h2>
              <p class="text-gray-400 max-w-2xl mx-auto">
                アプリケーションの動作をカスタマイズできます
              </p>
            </div>
            <div class="max-w-4xl mx-auto">
              <Setting />
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div class="min-h-screen bg-[#121212] text-gray-100 flex flex-col">
      {/* トップナビゲーション */}
      <header class="sticky top-0 z-20 bg-[#181818]/80 backdrop-blur-sm border-b border-gray-800/50">
        <div class="p-2 flex justify-center">
          <div class="flex space-x-1 bg-gray-800/50 p-1 rounded-full">
            <button
              type="button"
              onClick={() => setActiveSection("account")}
              class={`px-3 py-1.5 rounded-full text-sm font-semibold transition-all duration-200 ${
                activeSection() === "account"
                  ? "bg-teal-600 text-white shadow-sm"
                  : "text-gray-400 hover:bg-gray-700/50"
              }`}
            >
              アカウント管理
            </button>
            <button
              type="button"
              onClick={() => setActiveSection("notifications")}
              class={`px-3 py-1.5 rounded-full text-sm font-semibold transition-all duration-200 ${
                activeSection() === "notifications"
                  ? "bg-teal-600 text-white shadow-sm"
                  : "text-gray-400 hover:bg-gray-700/50"
              }`}
            >
              通知
            </button>
            <button
              type="button"
              onClick={() => setActiveSection("settings")}
              class={`px-3 py-1.5 rounded-full text-sm font-semibold transition-all duration-200 ${
                activeSection() === "settings"
                  ? "bg-teal-600 text-white shadow-sm"
                  : "text-gray-400 hover:bg-gray-700/50"
              }`}
            >
              設定
            </button>
          </div>
        </div>
      </header>

      {/* メインコンテンツ */}
      <main class="flex-1 p-4 sm:p-6 md:p-8">
        {renderContent()}
      </main>
    </div>
  );
}
