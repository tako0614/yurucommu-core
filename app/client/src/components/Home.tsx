import { createSignal, onMount } from "solid-js";
import { useAtom } from "solid-jotai";
import AccountSettingsContent from "./home/AccountSettingsContent.tsx";
import NotificationsContent from "./home/NotificationsContent.tsx";
import { Account, isDataUrl } from "./home/types.ts";
import { Setting } from "./Setting/index.tsx";
import { selectedAccountState } from "../states/account.ts";

export function Home() {
  const [activeSection, setActiveSection] = createSignal("account");

  // サンプルアカウントデータ
  const [accounts, setAccounts] = createSignal<Account[]>([]);

  // 現在選択中のアカウントIDをグローバル状態として管理
  const [selectedAccountId, setSelectedAccountId] = useAtom(
    selectedAccountState,
  );

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
