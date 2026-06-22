import { For, Show } from "solid-js";
import { useAtomValue } from "solid-jotai";
import type { AccountInfo } from "../../lib/api.ts";
import { currentApIdAtom } from "../../atoms/timeline.ts";
import { UserAvatar } from "../UserAvatar.tsx";
import { CheckIcon, CloseIcon, PlusIcon } from "./SettingsIcons.tsx";
import { SettingsSectionHeader } from "./SettingsSectionHeader.tsx";
import type { Translate } from "../../lib/i18n.tsx";

interface SettingsAccountsSectionProps {
  accounts: AccountInfo[];
  loading: boolean;
  /** Set when the account list fetch failed (shown as an inline banner + retry). */
  loadError?: string | null;
  onRetry?: () => void;
  switching: boolean;
  showCreateAccount: boolean;
  newUsername: string;
  newDisplayName: string;
  createError: string | null;
  isUsernameValid: boolean;
  onBack: () => void;
  onSwitchAccount: (apId: string) => void;
  onToggleCreate: (open: boolean) => void;
  onChangeUsername: (value: string) => void;
  onChangeDisplayName: (value: string) => void;
  onCreate: () => void;
  onResetCreate: () => void;
  t: Translate;
}

export function SettingsAccountsSection(props: SettingsAccountsSectionProps) {
  const currentApId = useAtomValue(currentApIdAtom);
  return (
    <div class="flex flex-col h-full">
      <SettingsSectionHeader
        title={props.t("settings.switchAccount")}
        onBack={props.onBack}
      />
      <div class="flex-1 overflow-y-auto">
        <Show
          when={!props.loading}
          fallback={
            <div class="p-8 text-center text-neutral-500">
              {props.t("common.loading")}
            </div>
          }
        >
          <Show when={props.loadError}>
            <div class="m-4 p-3 rounded-lg bg-rose-500/10 flex items-center justify-between gap-3">
              <span class="text-sm text-rose-300">{props.loadError}</span>
              <Show when={props.onRetry}>
                <button
                  onClick={() => props.onRetry?.()}
                  class="text-sm text-accent hover:underline shrink-0"
                >
                  {props.t("common.retry")}
                </button>
              </Show>
            </div>
          </Show>
          {/* Account list */}
          <For each={props.accounts}>
            {(account) => (
              <button
                onClick={() => props.onSwitchAccount(account.ap_id)}
                disabled={props.switching}
                class="w-full flex items-center gap-3 px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900/50 disabled:opacity-50"
              >
                <UserAvatar
                  avatarUrl={account.icon_url}
                  name={account.name || account.preferred_username}
                  size={48}
                />
                <div class="flex-1 min-w-0 text-left">
                  <div class="font-bold text-white truncate">
                    {account.name || account.preferred_username}
                  </div>
                  <div class="text-neutral-500 truncate">
                    @{account.preferred_username}
                  </div>
                </div>
                <Show when={account.ap_id === currentApId()}>
                  <CheckIcon />
                </Show>
              </button>
            )}
          </For>

          {/* Create new account button */}
          <Show
            when={props.showCreateAccount}
            fallback={
              <button
                onClick={() => props.onToggleCreate(true)}
                class="w-full flex items-center gap-3 px-4 py-3 hover:bg-neutral-900/50 text-accent"
              >
                <div class="w-12 h-12 rounded-full bg-neutral-800 flex items-center justify-center">
                  <PlusIcon />
                </div>
                <span>{props.t("settings.createNewAccount")}</span>
              </button>
            }
          >
            <div class="p-4 border-t border-neutral-900">
              <div class="flex items-center justify-between mb-4">
                <h3 class="font-bold">{props.t("settings.newAccount")}</h3>
                <button
                  onClick={props.onResetCreate}
                  aria-label={props.t("common.close")}
                  class="p-1 hover:bg-neutral-800 rounded-full"
                >
                  <CloseIcon />
                </button>
              </div>
              <Show when={props.createError}>
                <div class="mb-3 p-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                  {props.createError}
                </div>
              </Show>
              <div class="space-y-3">
                <div>
                  <label class="block text-sm text-neutral-400 mb-1">
                    {props.t("settings.usernameLabel")}
                  </label>
                  <input
                    type="text"
                    value={props.newUsername}
                    onInput={(e) =>
                      props.onChangeUsername(e.currentTarget.value)
                    }
                    placeholder="username"
                    pattern="^[a-zA-Z0-9_]+$"
                    required
                    class="w-full bg-neutral-800 rounded-lg px-3 py-2 text-white placeholder-neutral-500 outline-none focus:ring-2 focus:ring-accent"
                  />
                  <p class="text-xs text-neutral-500 mt-1">
                    {props.t("settings.usernameHint")}
                  </p>
                </div>
                <div>
                  <label class="block text-sm text-neutral-400 mb-1">
                    {props.t("settings.displayName")}
                  </label>
                  <input
                    type="text"
                    value={props.newDisplayName}
                    onInput={(e) =>
                      props.onChangeDisplayName(e.currentTarget.value)
                    }
                    placeholder={props.t("settings.displayName")}
                    class="w-full bg-neutral-800 rounded-lg px-3 py-2 text-white placeholder-neutral-500 outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>
                <button
                  onClick={props.onCreate}
                  disabled={!props.isUsernameValid}
                  class="w-full py-2 bg-accent rounded-lg font-bold transition-colors disabled:opacity-50"
                >
                  {props.t("groups.create")}
                </button>
              </div>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}
