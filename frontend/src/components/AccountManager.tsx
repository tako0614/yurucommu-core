import type React from "react";
import { For, Show, createSignal, onCleanup, onMount } from "../lib/solid-compat";
import { useLocation, useNavigate } from "react-router-dom";
import Avatar from "./Avatar";
import {
  getStoredAccounts,
  getActiveAccountIndex,
  removeAccount,
  switchAccount,
  type StoredAccount,
} from "../lib/api";

const ACCOUNTS_STORAGE_KEY = "takos_accounts";
const ACTIVE_INDEX_STORAGE_KEY = "takos_active_account_index";

export default function AccountManager() {
  const navigate = useNavigate();
  const location = useLocation();
  const [accounts, setAccounts] = createSignal<StoredAccount[]>([]);
  const [activeIndex, setActiveIndex] = createSignal(0);

  const refreshAccounts = () => {
    setAccounts(getStoredAccounts());
    setActiveIndex(getActiveAccountIndex());
  };

  onMount(() => {
    refreshAccounts();
    if (typeof window === "undefined") return;
    const handleStorage = (event: StorageEvent) => {
      if (
        !event.key ||
        event.key === ACCOUNTS_STORAGE_KEY ||
        event.key === ACTIVE_INDEX_STORAGE_KEY
      ) {
        refreshAccounts();
      }
    };
    window.addEventListener("storage", handleStorage);
    onCleanup(() => window.removeEventListener("storage", handleStorage));
  });

  const handleSwitch = (index: number) => {
    if (index === activeIndex()) return;
    switchAccount(index);
  };

  const handleRemove = (event: React.MouseEvent, index: number) => {
    event.stopPropagation();
    removeAccount(index);
    refreshAccounts();
  };

  const handleAddAccount = () => {
    const current =
      typeof window !== "undefined"
        ? `${location.pathname}${location.search}${location.hash}`
        : "/profile";
    const redirect = current || "/";
    const params = new URLSearchParams();
    params.set("addAccount", "1");
    params.set("redirect", redirect);
    navigate(`/login?${params.toString()}`);
  };

  return (
    <div className="rounded-2xl border hairline bg-white dark:bg-neutral-900 px-4 py-5 shadow-sm">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <div className="text-base font-semibold text-gray-900 dark:text-white">
            アカウント
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            保存済みのアカウントを切り替えたり削除できます。
          </p>
        </div>
        <button
          type="button"
          className="text-sm px-3 py-1.5 rounded-full border hairline text-gray-700 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-neutral-800"
          onClick={handleAddAccount}
        >
          アカウントを追加
        </button>
      </div>
      <Show
        when={accounts().length > 0}
        fallback={
          <div className="text-sm text-gray-500 dark:text-gray-400">
            まだ保存されたアカウントはありません。
          </div>
        }
      >
        <div className="space-y-2">
          <For each={accounts()}>
            {(account, indexAccessor) => {
              const index = indexAccessor();
              const isActive = () => index === activeIndex();
              return (
                <div
                  className="flex items-center gap-3 rounded-2xl border border-transparent hover:border-gray-200 dark:hover:border-gray-700 px-3 py-2 transition-colors cursor-pointer"
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSwitch(index)}
                  onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleSwitch(index);
                    }
                  }}
                >
                  <Avatar
                    src={account.avatarUrl || ""}
                    alt={account.displayName || account.handle}
                    className="w-10 h-10 rounded-full object-cover bg-gray-100 dark:bg-neutral-800"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {account.displayName || account.handle}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      @{account.handle}
                      <Show when={account.hostHandle}>
                        {(hostLabel) => (
                          <span className="ml-1 text-gray-400 dark:text-gray-500">
                            · {hostLabel()}
                          </span>
                        )}
                      </Show>
                    </div>
                  </div>
                  <Show
                    when={isActive()}
                    fallback={
                      <span className="text-xs text-blue-600 dark:text-blue-400">
                        切り替え
                      </span>
                    }
                  >
                    <span className="text-xs text-green-600 dark:text-green-400">
                      使用中
                    </span>
                  </Show>
                  <button
                    type="button"
                    className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                    onClick={(event) => handleRemove(event, index)}
                    aria-label="アカウントを削除"
                  >
                    削除
                  </button>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}
