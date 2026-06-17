import { A, useLocation } from "@solidjs/router";
import { For, Show } from "solid-js";
import { useAtomValue, useSetAtom } from "solid-jotai";
import { useI18n } from "../../lib/i18n.tsx";
import { notificationUnreadAtom } from "../../atoms/notifications.ts";
import { dmUnreadCountAtom } from "../../atoms/dm-unread.ts";
import { showPostModalAtom } from "../../atoms/timeline.ts";
import { NavBadge } from "./NavBadge.tsx";
import { NAV_ITEMS, type NavItem } from "./navItems.ts";

// Mobile projection of the single nav model (navItems.ts). The desktop Sidebar
// projects from the same list, so the two never diverge.
export function BottomNav() {
  const { t } = useI18n();
  const location = useLocation();
  const unreadCount = useAtomValue(notificationUnreadAtom);
  const dmUnread = useAtomValue(dmUnreadCountAtom);
  const openComposer = useSetAtom(showPostModalAtom);

  // The badge count source depends on which nav item it is.
  const badgeCount = (item: NavItem) =>
    item.id === "messages" ? dmUnread() : unreadCount();
  const badgeLabel = (item: NavItem) =>
    item.id === "messages" ? t("nav.messages") : t("nav.notifications");

  const isActive = (route: string) => {
    if (route === "/") return location.pathname === "/";
    // "/profile" is the OWN profile; foreign profiles live at
    // "/profile/:actorId" and must not light up the Profile tab.
    if (route === "/profile") return location.pathname === "/profile";
    return location.pathname.startsWith(route);
  };
  const active = (item: NavItem) =>
    item.route !== undefined && isActive(item.route);

  const itemClass = (item: NavItem) =>
    `flex flex-col items-center justify-center p-2 ${
      active(item) ? "text-white" : "text-neutral-500"
    }`;

  return (
    <nav class="md:hidden fixed bottom-0 left-0 right-0 h-[calc(3.5rem+env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)] bg-neutral-900 border-t border-neutral-900 flex items-center justify-around z-50">
      <For each={NAV_ITEMS}>
        {(item) => {
          const Icon = item.icon;
          const badge = () => (
            <Show when={item.badge && badgeCount(item) > 0}>
              <span class="absolute -top-1 -right-2">
                <NavBadge count={badgeCount(item)} label={badgeLabel(item)} />
              </span>
            </Show>
          );
          return (
            <Show
              when={item.route !== undefined}
              fallback={
                <button
                  type="button"
                  onClick={() => openComposer(true)}
                  aria-label={t(item.labelKey)}
                  class={itemClass(item)}
                >
                  <span class="relative inline-flex">
                    <Icon active={false} />
                  </span>
                </button>
              }
            >
              <A
                href={item.route!}
                aria-label={t(item.labelKey)}
                aria-current={active(item) ? "page" : undefined}
                class={itemClass(item)}
              >
                <span class="relative inline-flex">
                  <Icon active={active(item)} />
                  {badge()}
                </span>
              </A>
            </Show>
          );
        }}
      </For>
    </nav>
  );
}
