import { Show } from "solid-js";
import { DMContact } from "../../lib/api.ts";
import { formatConversationListTime } from "../../lib/datetime.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { UserAvatar } from "../UserAvatar.tsx";

interface DMContactItemProps {
  contact: DMContact;
  onClick: () => void;
  isPinned?: boolean;
  unreadCount?: number;
  // When provided (one-to-one conversations only), a trailing button archives
  // or — in the archived view — unarchives the conversation.
  onArchive?: () => void;
  onUnarchive?: () => void;
}

const ArchiveIcon = () => (
  <svg
    class="w-5 h-5"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
    />
  </svg>
);

export function DMContactItem(props: DMContactItemProps) {
  const { t } = useI18n();
  const canArchive = () =>
    props.contact.type !== "community" &&
    (props.onArchive !== undefined || props.onUnarchive !== undefined);
  return (
    <div class="flex items-center hover:bg-neutral-900 active:bg-neutral-800 transition-colors">
      <button
        onClick={props.onClick}
        class="flex-1 min-w-0 flex items-center gap-3 px-4 py-3 text-left"
      >
        <div class="relative flex-shrink-0">
          <UserAvatar
            avatarUrl={props.contact.icon_url ?? null}
            name={props.contact.name || props.contact.preferred_username || "?"}
            size={56}
          />
          <Show when={props.isPinned}>
            <div class="absolute -top-1 -left-1 w-5 h-5 bg-accent rounded-full flex items-center justify-center border-2 border-black">
              <svg
                class="w-3 h-3 text-white"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M16,12V4H17V2H7V4H8V12L6,14V16H11.2V22H12.8V16H18V14L16,12Z" />
              </svg>
            </div>
          </Show>
          <Show when={props.contact.type === "community"}>
            <div class="absolute -bottom-1 -right-1 w-6 h-6 bg-accent rounded-full flex items-center justify-center border-2 border-black">
              <svg
                class="w-3.5 h-3.5 text-white"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
              </svg>
            </div>
          </Show>
        </div>

        <div class="flex-1 min-w-0 text-left">
          <div class="flex items-center gap-2">
            <span class="font-semibold text-white truncate text-base">
              {props.contact.name || props.contact.preferred_username}
            </span>
            <Show
              when={
                props.contact.type === "community" &&
                props.contact.member_count !== undefined
              }
            >
              <span class="text-xs text-neutral-500">
                ({props.contact.member_count})
              </span>
            </Show>
          </div>
          <Show
            when={props.contact.last_message}
            fallback={
              <p class="text-sm text-neutral-500 truncate mt-0.5">
                {props.contact.type === "community"
                  ? t("dm.groupChat")
                  : t("dm.noMessagePreview")}
              </p>
            }
          >
            <p class="text-sm text-neutral-400 truncate mt-0.5">
              {props.contact.last_message!.is_mine ? t("dm.youPrefix") : ""}
              {props.contact.last_message!.content}
            </p>
          </Show>
        </div>

        <div class="flex flex-col items-end gap-1">
          <span class="text-xs text-neutral-500">
            {formatConversationListTime(props.contact.last_message_at)}
          </span>
          <Show when={(props.unreadCount ?? 0) > 0}>
            <span class="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
              {(props.unreadCount ?? 0) > 99 ? "99+" : props.unreadCount}
            </span>
          </Show>
        </div>
      </button>
      <Show when={canArchive()}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (props.onUnarchive) props.onUnarchive();
            else props.onArchive?.();
          }}
          aria-label={t(props.onUnarchive ? "dm.unarchive" : "dm.archive")}
          title={t(props.onUnarchive ? "dm.unarchive" : "dm.archive")}
          class="shrink-0 p-3 text-neutral-500 hover:text-neutral-200 transition-colors"
        >
          <ArchiveIcon />
        </button>
      </Show>
    </div>
  );
}
