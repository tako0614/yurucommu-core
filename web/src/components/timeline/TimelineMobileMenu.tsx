import { For, Show } from "solid-js";
import { A } from "@solidjs/router";
import type { Actor } from "../../types/index.ts";
import type { AccountInfo } from "../../lib/api.ts";
import { UserAvatar } from "../UserAvatar.tsx";
import {
  BookmarkIconMenu,
  ProfileIconMenu,
  SettingsIconMenu,
} from "./TimelineIcons.tsx";
import type { Translate } from "../../lib/i18n.tsx";

interface TimelineMobileMenuProps {
  isOpen: boolean;
  actor: Actor;
  accounts: AccountInfo[];
  accountsLoading: boolean;
  currentApId: string;
  showAccountSwitcher: boolean;
  onToggleAccountSwitcher: () => void;
  onSwitchAccount: (apId: string) => void;
  onClose: () => void;
  t: Translate;
}

export function TimelineMobileMenu(props: TimelineMobileMenuProps) {
  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-50 md:hidden">
        {/* Backdrop */}
        <div class="absolute inset-0 bg-black/60" onClick={props.onClose} />
        {/* Slide-in Menu */}
        <div class="absolute left-0 top-0 bottom-0 w-72 bg-neutral-900 border-r border-neutral-800 animate-slide-in overflow-y-auto">
          {/* Profile Header */}
          <div class="p-4 border-b border-neutral-800">
            {/* Avatar and Account Switcher Toggle */}
            <div class="flex items-center justify-between mb-3">
              <UserAvatar
                avatarUrl={props.actor.icon_url}
                name={props.actor.name || props.actor.username}
                size={48}
              />
              <button
                onClick={props.onToggleAccountSwitcher}
                aria-label={props.t("settings.switchAccount")}
                aria-haspopup="menu"
                aria-expanded={props.showAccountSwitcher}
                class="p-2 rounded-full border border-neutral-700 hover:bg-neutral-800 transition-colors"
              >
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
            </div>
            {/* Name and Username */}
            <p class="font-bold text-white text-lg">
              {props.actor.name || props.actor.username}
            </p>
            <p class="text-neutral-500">@{props.actor.username}</p>
            {/* Follow/Follower counts */}
            <div class="flex gap-4 mt-3">
              <A
                href="/friends/list?tab=following"
                onClick={props.onClose}
                class="hover:underline"
              >
                <span class="font-bold text-white">
                  {props.actor.following_count || 0}
                </span>
                <span class="text-neutral-500 ml-1">
                  {props.t("profile.following")}
                </span>
              </A>
              <A
                href="/friends/list?tab=followers"
                onClick={props.onClose}
                class="hover:underline"
              >
                <span class="font-bold text-white">
                  {props.actor.follower_count || 0}
                </span>
                <span class="text-neutral-500 ml-1">
                  {props.t("profile.followers")}
                </span>
              </A>
            </div>
          </div>

          {/* Account Switcher */}
          <Show when={props.showAccountSwitcher}>
            <div class="border-b border-neutral-800">
              <Show
                when={!props.accountsLoading}
                fallback={
                  <div class="p-4 text-center text-neutral-500">
                    {props.t("common.loading")}
                  </div>
                }
              >
                <div class="py-2">
                  <For each={props.accounts}>
                    {(account) => (
                      <button
                        onClick={() => props.onSwitchAccount(account.ap_id)}
                        class={`w-full flex items-center gap-3 px-4 py-3 hover:bg-neutral-900 transition-colors ${
                          account.ap_id === props.currentApId
                            ? "bg-neutral-900/50"
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

          {/* Navigation */}
          <nav class="p-2">
            <A
              href="/profile"
              onClick={props.onClose}
              class="flex items-center gap-4 px-4 py-3 rounded-full hover:bg-neutral-900 transition-colors"
            >
              <ProfileIconMenu />
              <span class="text-lg">{props.t("nav.profile")}</span>
            </A>
            <A
              href="/bookmarks"
              onClick={props.onClose}
              class="flex items-center gap-4 px-4 py-3 rounded-full hover:bg-neutral-900 transition-colors"
            >
              <BookmarkIconMenu />
              <span class="text-lg">{props.t("nav.bookmarks")}</span>
            </A>
            <A
              href="/settings"
              onClick={props.onClose}
              class="flex items-center gap-4 px-4 py-3 rounded-full hover:bg-neutral-900 transition-colors"
            >
              <SettingsIconMenu />
              <span class="text-lg">{props.t("nav.settings")}</span>
            </A>
          </nav>
        </div>
      </div>
    </Show>
  );
}
