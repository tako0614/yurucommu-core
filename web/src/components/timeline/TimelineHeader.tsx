import { Show } from "solid-js";
import { A } from "@solidjs/router";
import { useAtomValue } from "solid-jotai";
import { HeartIcon } from "../icons/SocialIcons.tsx";
import { notificationUnreadAtom } from "../../atoms/notifications.ts";
import { NavBadge } from "../layout/NavBadge.tsx";
import { useI18n } from "../../lib/i18n.tsx";

interface TimelineHeaderProps {
  onCreatePost: () => void;
  title: string;
}

export function TimelineHeader(props: TimelineHeaderProps) {
  const { t } = useI18n();
  const unreadCount = useAtomValue(notificationUnreadAtom);
  return (
    <header class="sticky top-0 bg-neutral-900/80 backdrop-blur-sm z-10">
      <div class="flex items-center justify-between px-4 py-4">
        {/* Mobile: Create post button */}
        <button
          onClick={props.onCreatePost}
          aria-label="Create post"
          class="md:hidden p-2 text-white hover:text-neutral-400 transition-colors"
        >
          <svg
            class="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
        </button>
        {/* Desktop: Show text title */}
        <h1 class="hidden md:block text-xl font-bold">{props.title}</h1>
        {/* Mobile: Notification heart icon */}
        <A
          href="/notifications"
          aria-label="Notifications"
          class="md:hidden relative p-2 text-white hover:text-pink-500 transition-colors"
        >
          <HeartIcon filled={false} />
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
  );
}
