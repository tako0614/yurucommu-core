import { Show } from "solid-js";
import { A, useLocation } from "@solidjs/router";
import { useAtomValue, useSetAtom } from "solid-jotai";
import { useI18n } from "../../lib/i18n.tsx";
import { actorAtom } from "../../atoms/auth.ts";
import { appMenuOpenAtom } from "../../atoms/shell.ts";
import { notificationUnreadAtom } from "../../atoms/notifications.ts";
import { UserAvatar } from "../UserAvatar.tsx";
import { NavBadge } from "./NavBadge.tsx";

// Minimal app-shell mobile header, mounted once in AppLayout so the AppMenu
// trigger (avatar) plus DM and Notifications are reachable from EVERY route on
// mobile. On the home route (`/`) the Phase B ScopeHeader takes over the same
// affordances (menu trigger + DM + notifications + compose) with the scope
// identity, so this header hides itself there to avoid a doubled bar. Desktop
// uses the Sidebar instead, so this is hidden at md+.
const MessageIcon = () => (
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
      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
    />
  </svg>
);

const BellIcon = () => (
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
      d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
    />
  </svg>
);

export function AppHeaderMobile() {
  const { t } = useI18n();
  const actor = useAtomValue(actorAtom);
  const openMenu = useSetAtom(appMenuOpenAtom);
  const unreadCount = useAtomValue(notificationUnreadAtom);
  const location = useLocation();

  // On the home route the ScopeHeader owns these affordances; suppress this bar
  // there so the two never stack.
  const onHome = () => location.pathname === "/";

  return (
    <Show when={onHome() ? null : actor()}>
      {(current) => (
        <header class="md:hidden sticky top-0 z-30 flex items-center justify-between px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] bg-neutral-900/80 backdrop-blur-sm border-b border-neutral-800">
          {/* Avatar / menu trigger — opens the global AppMenu drawer. */}
          <button
            type="button"
            onClick={() => openMenu(true)}
            aria-label={t("menu.open")}
            aria-haspopup="dialog"
            class="rounded-full ring-1 ring-neutral-700 transition-colors hover:ring-neutral-500"
          >
            <UserAvatar
              avatarUrl={current().icon_url}
              name={current().name || current().preferred_username}
              size={32}
            />
          </button>

          <h1 class="text-lg font-bold text-white">Yurucommu</h1>

          <div class="flex items-center gap-1">
            <A
              href="/dm"
              aria-label={t("menu.messages")}
              class="p-2 text-white transition-colors hover:text-neutral-400"
            >
              <MessageIcon />
            </A>
            <A
              href="/notifications"
              aria-label={t("menu.notifications")}
              class="relative p-2 text-white transition-colors hover:text-neutral-400"
            >
              <BellIcon />
              <Show when={unreadCount() > 0}>
                <span class="absolute top-0.5 right-0.5">
                  <NavBadge
                    count={unreadCount()}
                    label={t("nav.notifications")}
                  />
                </span>
              </Show>
            </A>
          </div>
        </header>
      )}
    </Show>
  );
}
