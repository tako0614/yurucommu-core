import { A, useLocation } from "@solidjs/router";
import { For, Show } from "solid-js";
import { useAtomValue, useSetAtom } from "solid-jotai";
import { useRequiredActor } from "../../hooks/useRequiredActor.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { notificationUnreadAtom } from "../../atoms/notifications.ts";
import { showPostModalAtom } from "../../atoms/timeline.ts";
import { NavBadge } from "./NavBadge.tsx";
import { NAV_ITEMS, type NavItem } from "./navItems.ts";

// Desktop projection of the single nav model (navItems.ts). The mobile
// BottomNav projects from the same list.
export function Sidebar() {
  const actor = useRequiredActor();
  const { t } = useI18n();
  const location = useLocation();
  const unreadCount = useAtomValue(notificationUnreadAtom);
  const openComposer = useSetAtom(showPostModalAtom);

  const isActive = (route: string) => {
    if (route === "/") return location.pathname === "/";
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
                    <Show when={item.badge && unreadCount() > 0}>
                      <span class="absolute -top-1.5 -right-2">
                        <NavBadge
                          count={unreadCount()}
                          label={t("nav.notifications")}
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
        <div class="mt-4 border-t border-neutral-900 pt-4">
          <div class="w-full text-left px-3 py-2 rounded-xl bg-neutral-900/40">
            <div class="text-xs text-neutral-500 mb-2">Account</div>
            <div class="text-sm font-medium truncate">
              {actor.name || actor.preferred_username}
            </div>
            <div class="text-xs text-neutral-500 truncate">
              @{actor.preferred_username}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
