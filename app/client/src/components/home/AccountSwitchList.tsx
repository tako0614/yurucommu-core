import { Component, For, Show, createSignal } from "solid-js";
import { Account } from "./types.ts";

type Props = {
  accounts: Account[];
  selectedAccountId: string | null;
  setSelectedAccountId: (id: string | null) => void;
  addNewAccount: (
    username: string,
    displayName?: string,
    icon?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  updateAccount: (id: string, updates: Partial<Account>) => void;
  deleteAccount: (id: string) => void;
};

const IconPreview: Component<{
  iconValue: string;
  displayNameValue: string;
  class?: string;
}> = (p) => {
  const displayIcon = () => {
    const icon = p.iconValue?.trim();
    if (icon && (icon.startsWith("data:") || icon.startsWith("http"))) {
      return (
        <img src={icon} alt="icon" class="h-full w-full object-cover rounded-full" />
      );
    }
    // デフォルトは頭文字ではなくデフォルト画像を表示
    return (
      <img src="/takos.png" alt="default icon" class="h-full w-full object-cover rounded-full" />
    );
  };
  return <div class={p.class}>{displayIcon()}</div>;
};

export const AccountSwitchList: Component<Props> = (props) => {
  const [showNewAccountModal, setShowNewAccountModal] = createSignal(false);
  const [newAccountForm, setNewAccountForm] = createSignal({
    username: "",
    displayName: "",
    icon: "",
    error: "",
  });

  const handleNewAccountIconChange = (e: Event) => {
    const files = (e.target as HTMLInputElement).files;
    if (files && files[0]) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setNewAccountForm({ ...newAccountForm(), icon: event.target?.result as string });
      };
      reader.readAsDataURL(files[0]);
    }
  };

  const handleCreateNewAccount = async () => {
    const form = newAccountForm();
    if (!form.username.trim()) {
      setNewAccountForm({ ...form, error: "ユーザー名は必須です" });
      return;
    }
    const result = await props.addNewAccount(form.username, form.displayName, form.icon);
    if (result.success) {
      setShowNewAccountModal(false);
      setNewAccountForm({ username: "", displayName: "", icon: "", error: "" });
    } else {
      setNewAccountForm({ ...form, error: result.error || "アカウント作成に失敗しました" });
    }
  };

  return (
    <div class="border-t border-gray-800/30 mt-12">
      <div class="max-w-4xl mx-auto px-4 md:px-8 py-8">
        <div>
          <div class="flex items-center justify-between text-gray-400 text-sm font-medium mb-3">
            <div class="flex items-center space-x-2">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
              <span>アカウントを切り替え ({props.accounts.length})</span>
            </div>
          </div>

          <div class="mt-0 space-y-2">
            <Show when={props.selectedAccountId && !props.accounts.some((a) => a.id === props.selectedAccountId)}>
              <div class="w-full flex items-center space-x-3 p-3 rounded-lg bg-gray-800 text-left transition-all duration-200 group border border-gray-800/50">
                <div class="h-8 w-8 rounded-full bg-gradient-to-br from-gray-600 to-gray-700 text-white flex items-center justify-center text-xs font-semibold flex-shrink-0">?</div>
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium text-white truncate">選択中のアカウント</p>
                  <p class="text-xs text-gray-400 truncate">(不明: {props.selectedAccountId})</p>
                </div>
                <span class="text-xs text-green-400">選択中</span>
              </div>
            </Show>

            <For each={props.accounts}>
              {(account) => {
                const isSelected = account.id === props.selectedAccountId;
                return (
                  <button
                    type="button"
                    onClick={() => { if (!isSelected) props.setSelectedAccountId(account.id); }}
                    disabled={isSelected}
                    class={`w-full flex items-center space-x-3 p-3 rounded-lg text-left transition-all duration-200 group border border-gray-800/50 hover:border-gray-700/50 ${isSelected ? "bg-gray-800 text-gray-200 cursor-default" : "bg-gray-900/30 hover:bg-gray-800/50"}`}
                  >
                    <IconPreview iconValue={account.avatarInitial} displayNameValue={account.displayName} class="h-8 w-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-white flex items-center justify-center text-xs font-semibold flex-shrink-0" />
                    <div class="min-w-0 flex-1">
                      <p class="text-sm font-medium transition-colors duration-200 truncate" classList={{ 'text-gray-300': !isSelected, 'text-white': isSelected }}>{account.displayName}</p>
                      <p class="text-xs" classList={{ 'text-gray-500': !isSelected, 'text-gray-400': isSelected }}>@{account.userName}</p>
                    </div>
                    <div class="flex items-center gap-2">
                      {isSelected ? (
                        <span class="text-xs text-green-400">選択中</span>
                      ) : (
                        <svg class="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                        </svg>
                      )}
                    </div>
                  </button>
                );
              }}
            </For>

            <button type="button" onClick={() => setShowNewAccountModal(true)} class="w-full flex items-center space-x-3 p-3 rounded-lg border border-dashed border-gray-700/50 hover:border-gray-600/50 hover:bg-gray-800/20 text-left transition-all duration-200 group">
              <div class="h-8 w-8 rounded-full bg-gray-800/50 group-hover:bg-gray-700/50 flex items-center justify-center flex-shrink-0 transition-all duration-200">
                <svg class="h-4 w-4 text-gray-500 group-hover:text-gray-400 transition-colors duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              </div>
              <div>
                <p class="text-sm font-medium text-gray-400 group-hover:text-gray-300 transition-colors duration-200">新しいアカウントを追加</p>
                <p class="text-xs text-gray-600">別のアカウントでログイン</p>
              </div>
            </button>
          </div>
        </div>
      </div>

      <Show when={showNewAccountModal()}>
        <div class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div class="bg-gray-900 rounded-lg max-w-md w-full p-6 space-y-4">
            <h3 class="text-xl font-bold text-white">新しいアカウントを作成</h3>
            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-300 mb-2">ユーザー名 *</label>
                <div class="relative">
                  <span class="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">@</span>
                  <input type="text" class="w-full bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" placeholder="ユーザー名を入力" value={newAccountForm().username} onInput={(e) => setNewAccountForm({ ...newAccountForm(), username: e.currentTarget.value, error: "" })} />
                </div>
                <p class="text-xs text-gray-500 mt-1">ユーザー名は作成後変更できません</p>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-300 mb-2">表示名</label>
                <input type="text" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" placeholder="表示名を入力（省略可）" value={newAccountForm().displayName} onInput={(e) => setNewAccountForm({ ...newAccountForm(), displayName: e.currentTarget.value, error: "" })} />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-300 mb-2">アイコン</label>
                <div class="flex items-center space-x-4">
                  <button type="button" onClick={() => document.getElementById("new-account-file")?.click()} class="relative group focus:outline-none">
                    <IconPreview iconValue={newAccountForm().icon} displayNameValue={newAccountForm().displayName || newAccountForm().username} class="h-16 w-16 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-white flex items-center justify-center text-xl font-bold" />
                    <div class="absolute inset-0 bg-black/40 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                      <svg class="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    </div>
                  </button>
                  <input id="new-account-file" type="file" accept="image/*" class="hidden" onInput={handleNewAccountIconChange} />
                </div>
              </div>
              <Show when={newAccountForm().error}><div class="bg-red-500/10 border border-red-500/30 rounded-lg p-3"><p class="text-sm text-red-400">{newAccountForm().error}</p></div></Show>
            </div>
            <div class="flex space-x-3 pt-4">
              <button type="button" onClick={() => { setShowNewAccountModal(false); setNewAccountForm({ username: "", displayName: "", icon: "", error: "" }); }} class="flex-1 py-2 px-4 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors">キャンセル</button>
              <button type="button" onClick={handleCreateNewAccount} disabled={!newAccountForm().username.trim()} class={`flex-1 py-2 px-4 rounded-lg transition-colors ${newAccountForm().username.trim() ? "bg-blue-500 text-white hover:bg-blue-600" : "bg-gray-700 text-gray-400 cursor-not-allowed"}`}>作成</button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default AccountSwitchList;
