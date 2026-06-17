import { Show } from "solid-js";
import { A } from "@solidjs/router";
import { useAtomValue, useSetAtom } from "solid-jotai";
import { useI18n } from "../../lib/i18n.tsx";
import { actorAtom } from "../../atoms/auth.ts";
import { inhabitedScopeAtom } from "../../atoms/scope.ts";
import { appMenuOpenAtom } from "../../atoms/shell.ts";
import { notificationUnreadAtom } from "../../atoms/notifications.ts";
import { showPostModalAtom } from "../../atoms/timeline.ts";
import { UserAvatar } from "../UserAvatar.tsx";
import { NavBadge } from "../layout/NavBadge.tsx";
import { ScopePill } from "./ScopePill.tsx";

interface ScopeHeaderProps {
  // Opens the ScopeSwitcherSheet; the host owns the open state so the same
  // sheet instance is shared with the ScopeBar's trailing affordance.
  onOpenSwitcher: () => void;
}

const MessageIcon = () => (
  <svg
    class="h-6 w-6"
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
    class="h-6 w-6"
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

const ComposeIcon = () => (
  <svg
    class="h-5 w-5"
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
);

/**
 * Sticky timeline header for the "Inhabited Scope" redesign.
 *
 * It replaces both the old desktop timeline title bar and the mobile
 * AppHeaderMobile shell header (on the home route) by surfacing, in one bar:
 *  - the AppMenu avatar trigger (mobile only; desktop uses the Sidebar),
 *  - the {@link ScopePill} that names the inhabited scope and opens the
 *    switcher sheet,
 *  - an ambient "reach" subhead that states (read-only) who a default public
 *    post in this scope ambiently reaches — NOT a visibility control,
 *  - DM + notification + compose affordances on the right.
 *
 * The pill writes the SAME {@link inhabitedScopeAtom} the ScopeBar reads/writes;
 * the two are projections of one scope, never divergent state.
 */
export function ScopeHeader(props: ScopeHeaderProps) {
  const { t } = useI18n();
  const actor = useAtomValue(actorAtom);
  const scope = useAtomValue(inhabitedScopeAtom);
  const openMenu = useSetAtom(appMenuOpenAtom);
  const unreadCount = useAtomValue(notificationUnreadAtom);
  const openComposer = useSetAtom(showPostModalAtom);

  // Read-only ambient reach line. A community scope reaches its members; the
  // personal scope's default post visibility is public, so the line states the
  // public reach rather than under-stating it as followers-only.
  const reach = () => {
    const s = scope();
    if (s.kind === "community") {
      return t("scope.reachCommunity").replace(
        "{name}",
        s.display_name || s.name,
      );
    }
    return t("compose.reachPublic");
  };

  // Ambient per-scope tint. Personal uses the app accent (blue); each community
  // gets a stable hue derived from its ap_id so standing in different rooms
  // feels distinct. The tint is a faint top-down wash over the dark header — it
  // is decorative ambience, never a visibility/affordance signal.
  const tintHue = () => {
    const s = scope();
    if (s.kind !== "community") return null;
    let hash = 0;
    for (let i = 0; i < s.ap_id.length; i++) {
      hash = (hash * 31 + s.ap_id.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) % 360;
  };

  const tintStyle = () => {
    const hue = tintHue();
    // Personal: accent-blue wash. Community: derived-hue wash. Low alpha so the
    // dark-only surface stays readable.
    const top =
      hue === null
        ? "rgba(59, 130, 246, 0.16)"
        : `hsla(${hue}, 70%, 55%, 0.18)`;
    return {
      "background-image": `linear-gradient(to bottom, ${top}, rgba(23, 23, 23, 0))`,
    };
  };

  return (
    <header class="sticky top-0 z-30 overflow-hidden border-b border-neutral-800 bg-neutral-900/80 backdrop-blur-sm">
      {/* Ambient per-scope tint wash (decorative; behind content). */}
      <div
        aria-hidden="true"
        class="pointer-events-none absolute inset-0 transition-colors duration-500"
        style={tintStyle()}
      />
      <div class="relative flex items-center gap-2 px-3 py-2.5">
        {/* Mobile-only AppMenu trigger. Desktop reaches the menu via Sidebar. */}
        <Show when={actor()}>
          {(current) => (
            <button
              type="button"
              onClick={() => openMenu(true)}
              aria-label={t("menu.open")}
              aria-haspopup="menu"
              class="shrink-0 rounded-full ring-1 ring-neutral-700 transition-colors hover:ring-neutral-500 md:hidden"
            >
              <UserAvatar
                avatarUrl={current().icon_url}
                name={current().name || current().preferred_username}
                size={32}
              />
            </button>
          )}
        </Show>

        {/* Scope identity + ambient reach. */}
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <ScopePill onOpen={props.onOpenSwitcher} class="self-start" />
          <p class="truncate pl-1 text-xs text-neutral-500">{reach()}</p>
        </div>

        {/* Right cluster: DM, notifications, compose. Hidden on mobile where the
            BottomNav already surfaces these destinations; shown on desktop. */}
        <div class="hidden shrink-0 items-center gap-1 md:flex">
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
              <span class="absolute right-0.5 top-0.5">
                <NavBadge
                  count={unreadCount()}
                  label={t("nav.notifications")}
                />
              </span>
            </Show>
          </A>
          <button
            type="button"
            onClick={() => openComposer(true)}
            aria-label={t("scope.compose")}
            class="ml-0.5 flex h-9 w-9 items-center justify-center rounded-full bg-accent text-white transition-colors"
          >
            <ComposeIcon />
          </button>
        </div>
      </div>
    </header>
  );
}
