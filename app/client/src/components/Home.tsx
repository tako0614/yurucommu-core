import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { apiFetch } from "../utils/config.ts";
import { useAtom } from "solid-jotai";
import AccountSettingsContent from "./home/AccountSettingsContent.tsx";
import NotificationsContent from "./home/NotificationsContent.tsx";
import { Account, isDataUrl, isUrl } from "./home/types.ts";
import { Setting } from "./Setting/index.tsx";
import { Button, Modal } from "./ui/index.ts";
import {
  accounts as accountsAtom,
  activeAccountId,
  fetchAccounts,
} from "../states/account.ts";

export interface HomeProps {
  onShowEncryptionKeyForm?: () => void;
}

export function Home(props: HomeProps) {
  // 設定・通知のモーダル制御
  const [showSettings, setShowSettings] = createSignal(false);
  const [showNotifications, setShowNotifications] = createSignal(false);

  const [accounts, setAccounts] = useAtom(accountsAtom);

  // 現在選択中のアカウントIDをグローバル状態として管理
  const [actId, setActId] = useAtom(
    activeAccountId,
  );

  // APIでアカウント一覧を取得
  const loadAccounts = async (preserveSelectedId?: string) => {
    try {
      const results = await fetchAccounts();
      setAccounts(results || []);
      if (preserveSelectedId) {
        const accountExists = results.some((acc: Account) =>
          acc.id === preserveSelectedId
        );
        if (accountExists) {
          setActId(preserveSelectedId);
        } else if (results.length > 0) {
          setActId(results[0].id);
        }
      } else {
        const currentId = actId();
        const exists = results.some((acc: Account) => acc.id === currentId);
        if (!exists && results.length > 0) {
          setActId(results[0].id);
        }
      }
    } catch (error) {
      console.error("Failed to load accounts:", error);
    }
  };

  // 新規アカウント追加機能
  const addNewAccount = async (
    username: string,
    displayName?: string,
    icon?: string,
  ) => {
    try {
      const response = await apiFetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          displayName: displayName?.trim() || username.trim(),
          ...(icon ? { icon } : {}),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create account");
      }

      const result = await response.json();
      const newAccountId = result.id;
      await loadAccounts(newAccountId);
      setActId(newAccountId);
      return { success: true };
    } catch (error) {
      console.error("Failed to create account:", error);
      return {
        success: false,
        error: error instanceof Error
          ? error.message
          : "Unknown error occurred",
      };
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
        if (isDataUrl(updates.avatarInitial) || isUrl(updates.avatarInitial)) {
          payload.avatarInitial = updates.avatarInitial;
        } else { // データURLやURLでない場合は表示名からイニシャルを生成
          const baseDisplayName = updates.displayName ||
            currentAccount.displayName;
          payload.avatarInitial =
            (baseDisplayName.charAt(0).toUpperCase() || "?")
              .substring(0, 2);
        }
      } else if (updates.displayName) {
        // アイコンが明示的に変更されず表示名のみ変わった場合、
        // 現在のアイコンがイニシャルのときだけ更新する
        if (
          !isDataUrl(currentAccount.avatarInitial) &&
          !isUrl(currentAccount.avatarInitial)
        ) {
          payload.avatarInitial =
            (updates.displayName.charAt(0).toUpperCase() || "?")
              .substring(0, 2);
        }
      }
      // payload.avatarInitial が未定義の場合、サーバー側はアイコンを変更しない

      const response = await apiFetch(`/api/accounts/${id}`, {
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

      const response = await apiFetch(`/api/accounts/${id}`, {
        method: "DELETE",
      });

      if (response.ok) {
        await loadAccounts();
        const remainingAccounts = accounts();
        if (remainingAccounts.length > 0) {
          setActId(remainingAccounts[0].id);
        } else {
          setActId("");
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

  // ショートカットキー: S=設定, N=通知（入力中は無効化）
  onMount(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      const isTyping = ["input", "textarea"].includes(tag) ||
        (document.activeElement as HTMLElement)?.isContentEditable;
      if (isTyping) return;
      if (e.key.toLowerCase() === "s") setShowSettings(true);
      if (e.key.toLowerCase() === "n") setShowNotifications(true);
    };
    globalThis.addEventListener("keydown", handler);
    onCleanup(() => globalThis.removeEventListener("keydown", handler));
  });

  const renderContent = () => (
    <AccountSettingsContent
      accounts={accounts()}
      selectedAccountId={actId() || ""}
      setSelectedAccountId={setActId}
      addNewAccount={addNewAccount}
      updateAccount={updateAccount}
      deleteAccount={deleteAccount}
    />
  );

  return (
    <div class="bg-[#121212] text-gray-100 flex flex-col">
      {/* 右上のフローティングアイコン（ヘッダーは使わない） */}
      <div class="fixed top-3 right-3 z-20 flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          class="rounded-full p-2 bg-[#1f1f1f]/70 hover:bg-[#2a2a2a] border border-[#2f2f2f] shadow"
          aria-label="通知"
          title="通知 (N)"
          onClick={() => setShowNotifications(true)}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            class="w-5 h-5"
          >
            <path
              fill="currentColor"
              d="M12 22a2 2 0 0 0 2-2H10a2 2 0 0 0 2 2Zm6-6V11a6 6 0 1 0-12 0v5l-2 2v1h16v-1l-2-2Z"
            />
          </svg>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="rounded-full p-2 bg-[#1f1f1f]/70 hover:bg-[#2a2a2a] border border-[#2f2f2f] shadow"
          aria-label="設定"
          title="設定 (S)"
          onClick={() => setShowSettings(true)}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            class="w-5 h-5"
          >
            <path
              fill="currentColor"
              d="M19.14,12.94a7.49,7.49,0,0,0,.05-1,7.49,7.49,0,0,0-.05-1l2.11-1.65a.5.5,0,0,0,.12-.64l-2-3.46a.5.5,0,0,0-.6-.22l-2.49,1a7.12,7.12,0,0,0-1.73-1L14.5,2.5a.5.5,0,0,0-.5-.5H10a.5.5,0,0,0-.5.5l-.38,2.47a7.12,7.12,0,0,0-1.73,1l-2.49-1a.5.5,0,0,0-.6.22l-2,3.46a.5.5,0,0,0,.12.64L4.86,10a7.49,7.49,0,0,0-.05,1,7.49,7.49,0,0,0,.05,1L2.75,13.65a.5.5,0,0,0-.12.64l2,3.46a.5.5,0,0,0,.6.22l2.49-1a7.12,7.12,0,0,0,1.73,1L9.5,21.5a.5.5,0,0,0,.5.5h4a.5.5,0,0,0,.5-.5l.38-2.47a7.12,7.12,0,0,0,1.73-1l2.49,1a.5.5,0,0,0,.6-.22l2-3.46a.5.5,0,0,0-.12-.64ZM12,15.5A3.5,3.5,0,1,1,15.5,12,3.5,3.5,0,0,1,12,15.5Z"
            />
          </svg>
        </Button>
      </div>

      {/* メインコンテンツ */}
      <main class="flex-1">
        <div class="relative overflow-hidden">
          {renderContent()}
        </div>
      </main>

      {/* 設定モーダル */}
      <Show when={showSettings()}>
        <Modal
          open={showSettings()}
          onClose={() => setShowSettings(false)}
          title="設定"
        >
          <div class="max-w-4xl">
            <Setting onShowEncryptionKeyForm={props.onShowEncryptionKeyForm} />
          </div>
        </Modal>
      </Show>

      {/* 通知モーダル */}
      <Show when={showNotifications()}>
        <Modal
          open={showNotifications()}
          onClose={() => setShowNotifications(false)}
          title="通知"
        >
          <div class="max-w-3xl">
            <NotificationsContent />
          </div>
        </Modal>
      </Show>
    </div>
  );
}
