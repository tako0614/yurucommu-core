import { For, Show } from "solid-js";
import { A } from "@solidjs/router";
import type { AccountInfo } from "../../lib/api.ts";
import { UserAvatar } from "../UserAvatar.tsx";
import { BackIcon } from "./ProfileIcons.tsx";
import { useI18n } from "../../lib/i18n.tsx";

interface ProfileHeaderProps {
  actorId?: string;
  isOwnProfile: boolean;
  username: string;
  showAccountSwitcher: boolean;
  onToggleAccountSwitcher: () => void;
  onCloseAccountSwitcher: () => void;
  accounts: AccountInfo[];
  accountsLoading: boolean;
  currentApId: string;
  onSwitchAccount: (apId: string) => void;
}

export function ProfileHeader(props: ProfileHeaderProps) {
  const { t } = useI18n();
  return (
    <>
      <header class="sticky top-0 bg-neutral-900/80 backdrop-blur-sm border-b border-neutral-900 z-10">
        <div class="flex items-center justify-between px-4 py-3">
          {/* Left: Back button (only when viewing other's profile) */}
          <div class="w-10">
            <Show when={props.actorId}>
              <A
                href="/"
                aria-label={t("common.back")}
                class="p-2 -ml-2 hover:bg-neutral-900 rounded-full inline-block"
              >
                <BackIcon />
              </A>
            </Show>
          </div>

          {/* Center: Username with account switcher (own profile only) */}
          <Show
            when={props.isOwnProfile}
            fallback={
              <span class="font-bold text-white">@{props.username}</span>
            }
          >
            <button
              onClick={props.onToggleAccountSwitcher}
              aria-label={t("settings.switchAccount")}
              aria-haspopup="menu"
              aria-expanded={props.showAccountSwitcher}
              class="flex items-center gap-1 hover:bg-neutral-900 px-3 py-1 rounded-full transition-colors"
            >
              <span class="font-bold text-white">@{props.username}</span>
              <svg
                class={`w-4 h-4 transition-transform ${
                  props.showAccountSwitcher ? "rotate-180" : ""
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>
          </Show>

          {/* Right: Placeholder for balance */}
          <div class="w-10" />
        </div>

        {/* Account Switcher Dropdown */}
        <Show when={props.showAccountSwitcher && props.isOwnProfile}>
          <div class="absolute left-1/2 -translate-x-1/2 top-14 bg-neutral-900 rounded-xl shadow-lg border border-neutral-800 min-w-[250px] z-20">
            <Show
              when={!props.accountsLoading}
              fallback={
                <div class="p-4 text-center text-neutral-500">
                  {t("common.loading")}
                </div>
              }
            >
              <div class="py-2">
                <For each={props.accounts}>
                  {(account) => (
                    <button
                      onClick={() => props.onSwitchAccount(account.ap_id)}
                      class={`w-full flex items-center gap-3 px-4 py-3 hover:bg-neutral-800 transition-colors ${
                        account.ap_id === props.currentApId
                          ? "bg-neutral-800/50"
                          : ""
                      }`}
                    >
                      <UserAvatar
                        avatarUrl={account.icon_url}
                        name={account.name || account.preferred_username}
                        size={40}
                      />
                      <div class="flex-1 text-left">
                        <p class="font-bold text-white">
                          {account.name || account.preferred_username}
                        </p>
                        <p class="text-sm text-neutral-500">
                          @{account.preferred_username}
                        </p>
                      </div>
                      <Show when={account.ap_id === props.currentApId}>
                        <svg
                          class="w-5 h-5 text-blue-500"
                          fill="currentColor"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                        </svg>
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>
      </header>

      {/* Backdrop for account switcher */}
      <Show when={props.showAccountSwitcher}>
        <div
          class="fixed inset-0 z-10"
          onClick={props.onCloseAccountSwitcher}
        />
      </Show>
    </>
  );
}
