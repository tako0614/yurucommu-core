import { A, useLocation } from '@solidjs/router';
import { For } from 'solid-js';
import { useRequiredActor } from '../../hooks/useRequiredActor.ts';
import { useI18n } from '../../lib/i18n.tsx';
import type { Component } from 'solid-js';

const HomeIcon: Component = () => (
  <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
  </svg>
);

const MessageIcon: Component = () => (
  <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
  </svg>
);

const BellIcon: Component = () => (
  <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
  </svg>
);

const ProfileIcon: Component = () => (
  <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
  </svg>
);

const BookmarkIcon: Component = () => (
  <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
  </svg>
);

const SettingsIcon: Component = () => (
  <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

export function Sidebar() {
  const actor = useRequiredActor();
  const { t } = useI18n();
  const location = useLocation();

  const navItems = [
    { to: '/', icon: HomeIcon, label: t('nav.home') },
    { to: '/dm', icon: MessageIcon, label: t('nav.messages') },
    { to: '/notifications', icon: BellIcon, label: t('nav.notifications') },
    { to: '/bookmarks', icon: BookmarkIcon, label: t('nav.bookmarks') },
    { to: '/profile', icon: ProfileIcon, label: t('nav.profile') },
    { to: '/settings', icon: SettingsIcon, label: t('nav.settings') },
  ];

  const isActive = (to: string) => {
    if (to === '/') return location.pathname === '/';
    return location.pathname.startsWith(to);
  };

  return (
    <aside class="hidden md:flex w-72 bg-neutral-900 flex-col h-screen shrink-0">
      <div class="px-6 pt-8 pb-6">
        <h1 class="text-2xl font-bold text-white">Yurucommu</h1>
      </div>
      <nav class="flex-1 px-4">
        <div class="space-y-2">
          <For each={navItems}>{(item) => {
            const Icon = item.icon;
            return (
              <A
                href={item.to}
                class={`flex items-center gap-4 px-4 py-3 rounded-full text-xl transition-colors ${
                  isActive(item.to)
                    ? 'bg-neutral-900 text-white font-bold'
                    : 'text-neutral-400 hover:bg-neutral-900/50 hover:text-white'
                }`}
              >
                <Icon />
                <span>{item.label}</span>
              </A>
            );
          }}</For>
        </div>
      </nav>
      <div class="px-4 pb-6">
        <div class="mt-4 border-t border-neutral-900 pt-4">
          <div class="w-full text-left px-3 py-2 rounded-xl bg-neutral-900/40">
            <div class="text-xs text-neutral-500 mb-2">Account</div>
            <div class="text-sm font-medium truncate">{actor.name || actor.preferred_username}</div>
            <div class="text-xs text-neutral-500 truncate">@{actor.preferred_username}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
