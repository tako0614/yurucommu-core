import { A, useLocation } from "@solidjs/router";
import { For } from "solid-js";
import { useI18n } from "../../lib/i18n.tsx";
import type { Component } from "solid-js";

// SVG Icons
const HomeIcon: Component<{ active: boolean }> = (props) => (
  <svg
    class="w-6 h-6"
    fill={props.active ? "currentColor" : "none"}
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
    />
  </svg>
);

const SearchIcon: Component<{ active: boolean }> = (props) => (
  <svg
    class="w-6 h-6"
    fill={props.active ? "currentColor" : "none"}
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
    />
  </svg>
);

const MessageIcon: Component<{ active: boolean }> = (props) => (
  <svg
    class="w-6 h-6"
    fill={props.active ? "currentColor" : "none"}
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
    />
  </svg>
);

const BellIcon: Component<{ active: boolean }> = (props) => (
  <svg
    class="w-6 h-6"
    fill={props.active ? "currentColor" : "none"}
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
    />
  </svg>
);

const ProfileIcon: Component<{ active: boolean }> = (props) => (
  <svg
    class="w-6 h-6"
    fill={props.active ? "currentColor" : "none"}
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
    />
  </svg>
);

export function BottomNav() {
  const { t } = useI18n();
  const location = useLocation();

  const navItems = [
    { to: "/", icon: HomeIcon, label: t("nav.home") },
    { to: "/dm", icon: MessageIcon, label: t("nav.messages") },
    { to: "/search", icon: SearchIcon, label: t("nav.search") },
    { to: "/profile", icon: ProfileIcon, label: t("nav.profile") },
  ];

  const isActive = (to: string) => {
    if (to === "/") return location.pathname === "/";
    return location.pathname.startsWith(to);
  };

  return (
    <nav class="md:hidden fixed bottom-0 left-0 right-0 h-14 bg-neutral-900 border-t border-neutral-900 flex items-center justify-around z-50">
      <For each={navItems}>
        {(item) => {
          const Icon = item.icon;
          return (
            <A
              href={item.to}
              class={`flex flex-col items-center justify-center p-2 ${
                isActive(item.to) ? "text-white" : "text-neutral-500"
              }`}
            >
              <Icon active={isActive(item.to)} />
            </A>
          );
        }}
      </For>
    </nav>
  );
}
