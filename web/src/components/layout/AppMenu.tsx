import { createEffect, For, Show } from "solid-js";
import { A } from "@solidjs/router";
import { useAtom, useAtomValue, useSetAtom } from "solid-jotai";
import { useI18n } from "../../lib/i18n.tsx";
import { useDialog } from "../../lib/useDialog.ts";
import { actorAtom, logoutAtom } from "../../atoms/auth.ts";
import { appMenuOpenAtom } from "../../atoms/shell.ts";
import {
  accountsAtom,
  accountsLoadingAtom,
  currentApIdAtom,
  loadAccountsAtom,
  showAccountSwitcherAtom,
  switchAccountAtom,
} from "../../atoms/timeline.ts";
import { UserAvatar } from "../UserAvatar.tsx";
import {
  BookmarkIconMenu,
  ProfileIconMenu,
  SettingsIconMenu,
} from "../timeline/TimelineIcons.tsx";

// App-shell account / utility menu. Mounted once in AppLayout (not timeline-
// local) so Settings, Bookmarks and the account switcher are reachable from any
// route on mobile. Phase B's ScopeHeader will absorb the trigger; this drawer
// is the durable home for these affordances.
const DiscoverIcon = () => (
  <svg
    class="w-6 h-6"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
    />
  </svg>
);

const FriendsIcon = () => (
  <svg
    class="w-6 h-6"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
    />
  </svg>
);

const LanguageIcon = () => (
  <svg
    class="w-6 h-6"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129"
    />
  </svg>
);

const LogoutIcon = () => (
  <svg
    class="w-6 h-6"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
    />
  </svg>
);

export function AppMenu() {
  const { t, language, setLanguage } = useI18n();
  const actor = useAtomValue(actorAtom);

  const [open, setOpen] = useAtom(appMenuOpenAtom);
  const [showAccountSwitcher, setShowAccountSwitcher] = useAtom(
    showAccountSwitcherAtom,
  );
  const accounts = useAtomValue(accountsAtom);
  const accountsLoading = useAtomValue(accountsLoadingAtom);
  const currentApId = useAtomValue(currentApIdAtom);
  const doLoadAccounts = useSetAtom(loadAccountsAtom);
  const doSwitchAccount = useSetAtom(switchAccountAtom);
  const doLogout = useSetAtom(logoutAtom);

  let drawerRef: HTMLDivElement | undefined;

  // Load the account list lazily the first time the menu opens.
  createEffect(() => {
    if (open()) doLoadAccounts();
  });

  const close = () => {
    setOpen(false);
    setShowAccountSwitcher(false);
  };

  useDialog({
    isOpen: () => open(),
    onClose: close,
    container: () => drawerRef,
  });

  const handleLogout = async () => {
    // Route through logoutAtom so the observation scope is reset (resetScope);
    // a direct lib/api logout would leave the previous owner's community lens.
    try {
      await doLogout();
    } catch {
      // Ignore — fall through to the redirect which re-triggers auth.
    }
    globalThis.location.href = "/";
  };

  return (
    <Show when={open()}>
      {(() => {
        const current = actor();
        if (!current) return null;
        return (
          <div class="fixed inset-0 z-[60]">
            {/* Backdrop. On mobile it dims full-screen; on desktop it is a
                transparent click-catcher so the popover dismisses on outside
                click without dimming the whole app. */}
            <div
              class="absolute inset-0 bg-black/60 md:bg-transparent"
              onClick={close}
            />
            {/* Mobile: left slide-in drawer (modal sheet). Desktop: a popover
                anchored to the Sidebar account block (bottom-left) rather than a
                full-screen dimmed modal — so it reads as a menu attached to its
                trigger. */}
            <div
              ref={drawerRef}
              role="dialog"
              aria-label={t("menu.title")}
              class="absolute left-0 top-0 bottom-0 w-72 bg-neutral-900 border-r border-neutral-800 animate-slide-in overflow-y-auto pt-[env(safe-area-inset-top)] md:bottom-4 md:left-4 md:top-auto md:w-80 md:max-h-[calc(100vh-2rem)] md:rounded-2xl md:border md:border-neutral-800 md:shadow-2xl md:pt-0"
            >
              {/* Profile Header */}
              <div class="p-4 border-b border-neutral-800">
                <div class="flex items-center justify-between mb-3">
                  <UserAvatar
                    avatarUrl={current.icon_url}
                    name={current.name || current.preferred_username}
                    size={48}
                  />
                  <button
                    onClick={() => setShowAccountSwitcher((prev) => !prev)}
                    aria-label={t("settings.switchAccount")}
                    aria-haspopup="menu"
                    aria-expanded={showAccountSwitcher()}
                    class="p-2 rounded-full border border-neutral-700 hover:bg-neutral-800 transition-colors"
                  >
                    <svg
                      class={`w-4 h-4 transition-transform ${
                        showAccountSwitcher() ? "rotate-180" : ""
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
                <p class="font-bold text-white text-lg">
                  {current.name || current.preferred_username}
                </p>
                <p class="text-neutral-500">@{current.preferred_username}</p>
                <div class="flex gap-4 mt-3">
                  <A
                    href="/friends/list?tab=following"
                    onClick={close}
                    class="hover:underline"
                  >
                    <span class="font-bold text-white">
                      {current.following_count || 0}
                    </span>
                    <span class="text-neutral-500 ml-1">
                      {t("profile.following")}
                    </span>
                  </A>
                  <A
                    href="/friends/list?tab=followers"
                    onClick={close}
                    class="hover:underline"
                  >
                    <span class="font-bold text-white">
                      {current.follower_count || 0}
                    </span>
                    <span class="text-neutral-500 ml-1">
                      {t("profile.followers")}
                    </span>
                  </A>
                </div>
              </div>

              {/* Account Switcher */}
              <Show when={showAccountSwitcher()}>
                <div class="border-b border-neutral-800">
                  <Show
                    when={!accountsLoading()}
                    fallback={
                      <div class="p-4 text-center text-neutral-500">
                        {t("common.loading")}
                      </div>
                    }
                  >
                    <div class="py-2">
                      <For each={accounts()}>
                        {(account) => (
                          <button
                            onClick={() => doSwitchAccount(account.ap_id)}
                            class={`w-full flex items-center gap-3 px-4 py-3 hover:bg-neutral-900 transition-colors ${
                              account.ap_id === currentApId()
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
                            <Show when={account.ap_id === currentApId()}>
                              <svg
                                class="w-5 h-5 text-accent"
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

              {/* Utility navigation */}
              <nav class="p-2">
                <A
                  href="/profile"
                  onClick={close}
                  class="flex items-center gap-4 px-4 py-3 rounded-full hover:bg-neutral-900 transition-colors"
                >
                  <ProfileIconMenu />
                  <span class="text-lg">{t("nav.profile")}</span>
                </A>
                <A
                  href="/friends"
                  onClick={close}
                  class="flex items-center gap-4 px-4 py-3 rounded-full hover:bg-neutral-900 transition-colors"
                >
                  <FriendsIcon />
                  <span class="text-lg">{t("nav.friends")}</span>
                </A>
                <A
                  href="/bookmarks"
                  onClick={close}
                  class="flex items-center gap-4 px-4 py-3 rounded-full hover:bg-neutral-900 transition-colors"
                >
                  <BookmarkIconMenu />
                  <span class="text-lg">{t("nav.bookmarks")}</span>
                </A>
                <A
                  href="/search"
                  onClick={close}
                  class="flex items-center gap-4 px-4 py-3 rounded-full hover:bg-neutral-900 transition-colors"
                >
                  <DiscoverIcon />
                  <span class="text-lg">{t("nav.discover")}</span>
                </A>
                <A
                  href="/settings"
                  onClick={close}
                  class="flex items-center gap-4 px-4 py-3 rounded-full hover:bg-neutral-900 transition-colors"
                >
                  <SettingsIconMenu />
                  <span class="text-lg">{t("nav.settings")}</span>
                </A>
                <button
                  type="button"
                  onClick={() => setLanguage(language === "ja" ? "en" : "ja")}
                  class="w-full flex items-center gap-4 px-4 py-3 rounded-full hover:bg-neutral-900 transition-colors text-left"
                >
                  <LanguageIcon />
                  <span class="flex-1 text-lg">{t("settings.language")}</span>
                  <span class="text-neutral-500">
                    {language === "ja"
                      ? t("settings.languageJa")
                      : t("settings.languageEn")}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  class="w-full flex items-center gap-4 px-4 py-3 rounded-full hover:bg-neutral-900 transition-colors text-left"
                >
                  <LogoutIcon />
                  <span class="text-lg">{t("settings.logout")}</span>
                </button>
              </nav>
            </div>
          </div>
        );
      })()}
    </Show>
  );
}
