import { A, useLocation } from "@solidjs/router";
import { For, Show } from "solid-js";
import { useAtomValue, useSetAtom } from "solid-jotai";
import { useRequiredActor } from "../../hooks/useRequiredActor.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { notificationUnreadAtom } from "../../atoms/notifications.ts";
import { dmUnreadCountAtom } from "../../atoms/dm-unread.ts";
import { showPostModalAtom } from "../../atoms/timeline.ts";
import { appMenuOpenAtom, createScopeOpenAtom } from "../../atoms/shell.ts";
import { NavBadge } from "./NavBadge.tsx";
import { NAV_ITEMS, type NavItem } from "./navItems.ts";

// Desktop projection of the single nav model (navItems.ts). The mobile
// BottomNav projects from the same list.
export function Sidebar() {
  const actor = useRequiredActor();
  const { t } = useI18n();
  const location = useLocation();
  const unreadCount = useAtomValue(notificationUnreadAtom);
  const dmUnread = useAtomValue(dmUnreadCountAtom);
  const openComposer = useSetAtom(showPostModalAtom);
  const openMenu = useSetAtom(appMenuOpenAtom);
  const openCreateScope = useSetAtom(createScopeOpenAtom);

  // The badge count source depends on which nav item it is.
  const badgeCount = (item: NavItem) =>
    item.id === "messages" ? dmUnread() : unreadCount();
  const badgeLabel = (item: NavItem) =>
    item.id === "messages" ? t("nav.messages") : t("nav.notifications");

  const isActive = (route: string) => {
    if (route === "/") return location.pathname === "/";
    // "/profile" is the OWN profile; foreign profiles live at
    // "/profile/:actorId" and must not light up the Profile entry.
    if (route === "/profile") return location.pathname === "/profile";
    return location.pathname.startsWith(route);
  };
  const active = (item: NavItem) =>
    item.route !== undefined && isActive(item.route);

  const rowClass = (item: NavItem) =>
    `flex items-center gap-4 px-4 py-3 rounded-full text-xl transition-colors ${
      active(item)
        ? "bg-neutral-900 text-white font-bold"
        : "text-neutral-400 hover:bg-neutral-900/50 hover:text-white"
    }`;

  return (
    <aside class="hidden md:flex w-72 bg-neutral-900 flex-col h-screen shrink-0">
      <div class="px-6 pt-8 pb-6">
        <h1 class="text-2xl font-bold text-white">Yurucommu</h1>
      </div>
      <nav class="flex-1 px-4">
        <div class="space-y-2">
          <For each={NAV_ITEMS}>
            {(item) => {
              const Icon = item.icon;
              const label = () => t(item.labelKey);
              const inner = () => (
                <>
                  <span class="relative inline-flex">
                    <Icon active={active(item)} />
                    <Show when={item.badge && badgeCount(item) > 0}>
                      <span class="absolute -top-1.5 -right-2">
                        <NavBadge
                          count={badgeCount(item)}
                          label={badgeLabel(item)}
                        />
                      </span>
                    </Show>
                  </span>
                  <span>{label()}</span>
                </>
              );
              return (
                <Show
                  when={item.route !== undefined}
                  fallback={
                    <button
                      type="button"
                      onClick={() => openComposer(true)}
                      class={`${rowClass(item)} w-full text-left`}
                    >
                      {inner()}
                    </button>
                  }
                >
                  <A
                    href={item.route!}
                    aria-current={active(item) ? "page" : undefined}
                    class={rowClass(item)}
                  >
                    {inner()}
                  </A>
                </Show>
              );
            }}
          </For>
        </div>
      </nav>
      <div class="px-4 pb-6">
        {/* Create a community — desktop entry to the layout-level
            CreateScopeModal (mobile reaches it via the scope switcher). */}
        <button
          type="button"
          onClick={() => openCreateScope(true)}
          class="mb-3 flex w-full items-center gap-3 rounded-full border border-neutral-700 px-4 py-2.5 text-sm font-medium text-neutral-200 transition-colors hover:bg-neutral-900/50 hover:text-white"
        >
          <svg
            class="h-5 w-5 shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
          <span class="truncate">{t("scope.create")}</span>
        </button>
        <div class="border-t border-neutral-900 pt-4">
          {/* Account block — opens the AppMenu (settings / bookmarks /
              account switch / language / logout) as a desktop popover. */}
          {/* `title` not `aria-label`: the visible account name stays the
              accessible name (WCAG 2.5.3) while the "open menu" hint rides along
              as the tooltip. */}
          <button
            type="button"
            onClick={() => openMenu(true)}
            aria-haspopup="dialog"
            title={t("menu.open")}
            class="w-full text-left px-3 py-2 rounded-xl bg-neutral-900/40 transition-colors hover:bg-neutral-900"
          >
            <div class="text-xs text-neutral-500 mb-2">
              {t("settings.account")}
            </div>
            <div class="text-sm font-medium truncate">
              {actor.name || actor.preferred_username}
            </div>
            <div class="text-xs text-neutral-500 truncate">
              @{actor.preferred_username}
            </div>
          </button>
        </div>
      </div>
    </aside>
  );
}
