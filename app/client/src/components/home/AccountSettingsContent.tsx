import {
  Component,
  createEffect,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { Account, isDataUrl } from "./types.ts";

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

  // 編集モード用の状態
  const [isEditing, setIsEditing] = createSignal(false);

  return (
    <div class="min-h-screen p-4 md:p-6 lg:p-8 animate-in slide-in-from-bottom-4 duration-500">
      {/* プロファイル切り替えエリア */}
      <Show when={selectedAccount()}>
        <div
          class={`max-w-4xl mx-auto bg-gradient-to-br from-[#1a1a1a] to-[#161616] rounded-3xl shadow-2xl border border-gray-800/50 overflow-hidden animate-in slide-in-from-right-4 duration-500 ${
            isSwitching() ? "account-switch" : ""
          }`}
        >
          {/* メインプロフィール表示 */}
          <div class="relative">
            {/* カバー画像風の背景 */}
            <div class="h-40 md:h-48 lg:h-56 bg-gradient-to-r from-teal-600/80 via-blue-600/80 to-purple-600/80"></div>
            
            {/* プロフィール情報 */}
            <div class="relative px-6 md:px-8 lg:px-12 pb-8 md:pb-12">
              {/* アバター */}
              <div class="flex items-end justify-between -mt-20 md:-mt-24 lg:-mt-28 mb-6 md:mb-8">
                <div class="relative group">
                  <button
                    type="button"
                    onClick={() => setIsEditing(!isEditing())}
                    class="relative block focus:outline-none focus:ring-4 focus:ring-teal-500/30 rounded-full transition-all duration-200 hover:scale-105"
                  >
                    <IconPreview
                      iconValue={editingIcon()}
                      displayNameValue={editingDisplayName()}
                      class="h-28 w-28 md:h-32 md:w-32 lg:h-36 lg:w-36 rounded-full bg-gradient-to-br from-teal-500 to-teal-600 text-white flex items-center justify-center text-2xl md:text-3xl lg:text-4xl font-bold shadow-2xl border-4 md:border-6 border-[#1a1a1a]"
                    />
                    <div class="absolute inset-0 bg-black/20 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                      <svg class="w-6 h-6 md:w-8 md:h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </div>
                  </button>
                </div>
                
                {/* アクションボタン */}
                <div class="flex space-x-3 md:space-x-4">
                  <Show when={!isEditing()}>
                    <button
                      type="button"
                      onClick={() => setIsEditing(true)}
                      class="px-4 md:px-6 lg:px-8 py-2 md:py-3 bg-gray-800/80 hover:bg-gray-700/80 text-gray-200 font-medium rounded-full border border-gray-600/50 hover:border-gray-500/50 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-teal-500/50 text-sm md:text-base"
                    >
                      プロフィールを編集
                    </button>
                  </Show>
                  <Show when={isEditing()}>
                    <button
                      type="button"
                      onClick={() => setIsEditing(false)}
                      class="px-4 md:px-6 py-2 md:py-3 bg-gray-600/80 hover:bg-gray-500/80 text-gray-200 font-medium rounded-full transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-gray-500/50 text-sm md:text-base"
                    >
                      キャンセル
                    </button>
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={!hasChanges() || isLoading()}
                      class={`px-4 md:px-6 py-2 md:py-3 font-medium rounded-full transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-teal-500/50 text-sm md:text-base ${
                        hasChanges() && !isLoading()
                          ? "bg-teal-600 hover:bg-teal-500 text-white"
                          : "bg-gray-700/50 text-gray-400 cursor-not-allowed"
                      }`}
                    >
                      {isLoading() ? "保存中..." : "保存"}
                    </button>
                  </Show>
                </div>
              </div>

              {/* 名前とユーザー名 */}
              <div class="space-y-2 md:space-y-3 mb-6 md:mb-8">
                <Show when={!isEditing()}>
                  <div class="flex items-center space-x-3">
                    <h2 class="text-3xl md:text-4xl lg:text-5xl font-bold text-gray-100">
                      {editingDisplayName() || "名前未設定"}
                    </h2>
                    <button
                      type="button"
                      onClick={() => setIsEditing(true)}
                      class="p-1 md:p-2 text-gray-400 hover:text-gray-200 transition-colors duration-200"
                    >
                      <svg class="w-5 h-5 md:w-6 md:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                  </div>
                  <p class="text-xl md:text-2xl text-gray-400">@{editingUserName() || "ユーザー名未設定"}</p>
                </Show>
                
                <Show when={isEditing()}>
                  <div class="space-y-4 md:space-y-6 max-w-2xl">
                    <input
                      type="text"
                      class="w-full bg-gray-800/50 border border-gray-600/50 rounded-xl px-4 md:px-6 py-3 md:py-4 text-lg md:text-xl text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500/50 focus:border-transparent"
                      placeholder="表示名"
                      value={editingDisplayName()}
                      onInput={(e) => {
                        setEditingDisplayName(e.currentTarget.value);
                        checkForChanges();
                      }}
                    />
                    <div class="relative">
                      <span class="absolute left-4 md:left-6 top-1/2 transform -translate-y-1/2 text-gray-400 text-lg md:text-xl">@</span>
                      <input
                        type="text"
                        class="w-full bg-gray-800/50 border border-gray-600/50 rounded-xl pl-10 md:pl-12 pr-4 md:pr-6 py-3 md:py-4 text-lg md:text-xl text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500/50 focus:border-transparent"
                        placeholder="ユーザー名"
                        value={editingUserName()}
                        onInput={(e) => {
                          setEditingUserName(e.currentTarget.value);
                          checkForChanges();
                        }}
                      />
                    </div>
                  </div>
                </Show>
              </div>

              {/* ステータス */}
              <div class="flex items-center space-x-6 text-base md:text-lg text-gray-400 mb-8 md:mb-12">
                <div class="flex items-center space-x-2">
                  <div class="w-3 h-3 bg-green-400 rounded-full"></div>
                  <span>アクティブ</span>
                </div>
                <span>•</span>
                <span>最終更新: 今日</span>
              </div>

              {/* プロフィール画像アップロード（編集時のみ） */}
              <Show when={isEditing()}>
                <div class="bg-gray-800/30 rounded-xl p-6 md:p-8 space-y-4 max-w-2xl">
                  <label class="block text-lg md:text-xl font-medium text-gray-300">プロフィール画像</label>
                  <input
                    type="file"
                    accept="image/*"
                    class="block w-full text-base md:text-lg text-gray-300 file:mr-4 file:py-3 file:px-6 file:rounded-xl file:border-0 file:text-base file:font-medium file:bg-teal-600 file:text-white hover:file:bg-teal-700 file:transition-colors bg-gray-800/50 border border-gray-600/50 rounded-xl"
                    onInput={handleFileChange}
                  />
                </div>
              </Show>

              {/* 削除確認（編集時のみ） */}
              <Show when={isEditing() && showDeleteConfirm()}>
                <div class="bg-red-500/10 border border-red-500/20 rounded-lg p-4 space-y-3">
                  <div class="flex items-center space-x-2">
                    <svg class="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    <h4 class="font-medium text-red-400">アカウントを削除しますか？</h4>
                  </div>
                  <p class="text-sm text-red-400">この操作は取り消せません。</p>
                  <div class="flex space-x-2">
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(false)}
                      class="flex-1 py-2 px-3 text-sm bg-gray-700/50 text-gray-300 rounded-lg hover:bg-gray-600/50 transition-colors"
                    >
                      キャンセル
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      class="flex-1 py-2 px-3 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                    >
                      削除
                    </button>
                  </div>
                </div>
              </Show>

              {/* 削除ボタン（編集時のみ） */}
              <Show when={isEditing() && !showDeleteConfirm()}>
                <details class="group mt-6">
                  <summary class="text-xs text-gray-500 hover:text-gray-400 cursor-pointer transition-colors duration-200 focus:outline-none focus:ring-1 focus:ring-gray-500/50 rounded px-1 py-0.5">
                    危険な操作
                  </summary>
                  <div class="mt-2 pt-2 border-t border-gray-700/30">
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(true)}
                      class="text-xs text-red-500/70 hover:text-red-400 transition-colors duration-200 underline underline-offset-2"
                    >
                      このアカウントを削除
                    </button>
                  </div>
                </details>
              </Show>
            </div>
          </div>

          {/* アカウント切り替えドロップダウン */}
          <div class="border-t border-gray-800/50 p-6 md:p-8">
            <details class="group">
              <summary class="flex items-center justify-between cursor-pointer text-gray-300 hover:text-gray-100 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-teal-500/50 rounded-xl p-4 md:p-6">
                <div class="flex items-center space-x-4 md:space-x-6">
                  <svg class="w-6 h-6 md:w-7 md:h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                  </svg>
                  <span class="font-medium text-lg md:text-xl">アカウントを切り替え</span>
                  <span class="text-sm md:text-base bg-gray-700/50 px-3 py-1 rounded-full">{props.accounts.length}</span>
                </div>
                <svg class="w-5 h-5 md:w-6 md:h-6 transition-transform duration-200 group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </summary>
              
              <div class="mt-4 md:mt-6 space-y-3 md:space-y-4">
                <For each={props.accounts.filter(a => a.id !== props.selectedAccountId)}>
                  {(account) => (
                    <button
                      type="button"
                      onClick={() => props.setSelectedAccountId(account.id)}
                      class="w-full flex items-center space-x-4 md:space-x-6 p-4 md:p-6 rounded-xl bg-gray-800/30 hover:bg-gray-700/40 text-left transition-all duration-200 group focus:outline-none focus:ring-2 focus:ring-teal-500/50"
                    >
                      <IconPreview
                        iconValue={account.avatarInitial}
                        displayNameValue={account.displayName}
                        class="h-12 w-12 md:h-14 md:w-14 rounded-full bg-gradient-to-br from-teal-500 to-teal-600 text-white flex items-center justify-center text-base md:text-lg font-semibold flex-shrink-0"
                      />
                      <div class="min-w-0 flex-1">
                        <p class="font-medium text-lg md:text-xl text-gray-200 group-hover:text-white transition-colors duration-200 truncate">
                          {account.displayName}
                        </p>
                        <p class="text-base md:text-lg text-gray-400 truncate">@{account.userName}</p>
                      </div>
                    </button>
                  )}
                </For>
                
                <button
                  type="button"
                  onClick={props.addNewAccount}
                  class="w-full flex items-center space-x-4 md:space-x-6 p-4 md:p-6 rounded-xl border-2 border-dashed border-gray-600/50 hover:border-teal-500/50 hover:bg-teal-500/5 text-left transition-all duration-200 group focus:outline-none focus:ring-2 focus:ring-teal-500/50"
                >
                  <div class="h-12 w-12 md:h-14 md:w-14 rounded-full bg-gradient-to-br from-gray-600 to-gray-700 group-hover:from-teal-500 group-hover:to-teal-600 flex items-center justify-center flex-shrink-0 transition-all duration-200">
                    <svg class="h-6 w-6 md:h-7 md:w-7 text-gray-300 group-hover:text-white transition-colors duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                  </div>
                  <div>
                    <p class="font-medium text-lg md:text-xl text-gray-300 group-hover:text-teal-400 transition-colors duration-200">
                      新しいアカウントを追加
                    </p>
                    <p class="text-base md:text-lg text-gray-500">別のアカウントでログイン</p>
                  </div>
                </button>
              </div>
            </details>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default AccountSettingsContent;
