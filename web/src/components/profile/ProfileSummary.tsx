import { type Accessor, For, onCleanup, onMount, Show } from "solid-js";
import type { Actor } from "../../types/index.ts";
import { formatMonthYear } from "../../lib/datetime.ts";
import { UserAvatar } from "../UserAvatar.tsx";
import { CalendarIcon, MoreIcon } from "./ProfileIcons.tsx";
import { ProfileScopeRow } from "./ProfileScopeRow.tsx";
import type { Language, Translate } from "../../lib/i18n.tsx";

type FollowModalType = "followers" | "following";

interface ProfileSummaryProps {
  profile: Actor;
  isOwnProfile: boolean;
  isFollowing: boolean;
  // A private/remote follow can be awaiting the target's approval. While it is
  // pending we must not present it as an accepted follow ("Unfollow").
  followPending?: boolean;
  showMenu: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onToggleFollow: () => void;
  onOpenEdit: () => void;
  onOpenFollowModal: (type: FollowModalType) => void;
  onBlock: () => void;
  onMute: () => void;
  t: Translate;
  // Reactive locale accessor so the "joined {date}" month localizes (ja: 2026年6月
  // / en: June 2026) instead of falling back to the runtime default locale.
  language: Accessor<Language>;
}

// Derive a readable `@user@domain` handle from an AP id for the moved-to
// banner, falling back to the raw value when it is not a parseable actor URL.
function movedToHandle(apId: string): string {
  try {
    const url = new URL(apId);
    const match = apId.match(/\/(users|groups)\/([^/]+)$/);
    if (match) return `@${match[2]}@${url.host}`;
  } catch {
    // Ignore malformed values and show them verbatim.
  }
  return apId;
}

export function ProfileSummary(props: ProfileSummaryProps) {
  // Only keep fully-populated label/value pairs for display.
  const visibleFields = () =>
    (props.profile.fields ?? []).filter((f) => f.name.trim() && f.value.trim());

  // Dismiss the mute/block menu on outside click or Escape (it is otherwise
  // keyboard-undismissable and stays open when the user clicks away). menuRoot
  // wraps both the trigger and the menu, so clicking the trigger never counts
  // as "outside". Escape also returns focus to the trigger.
  let menuRoot: HTMLDivElement | undefined;
  let menuTrigger: HTMLButtonElement | undefined;
  const onDocClick = (e: MouseEvent) => {
    if (props.showMenu && menuRoot && !menuRoot.contains(e.target as Node)) {
      props.onCloseMenu();
    }
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (props.showMenu && e.key === "Escape") {
      e.preventDefault();
      props.onCloseMenu();
      menuTrigger?.focus();
    }
  };
  onMount(() => {
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKeyDown);
  });
  onCleanup(() => {
    document.removeEventListener("click", onDocClick);
    document.removeEventListener("keydown", onKeyDown);
  });

  return (
    <>
      {/* Header Image */}
      <div class="h-32 md:h-48 bg-neutral-800 relative">
        <Show when={props.profile.header_url}>
          <img
            src={props.profile.header_url ?? undefined}
            alt=""
            class="w-full h-full object-cover"
          />
        </Show>
      </div>

      {/* Profile Info */}
      <div class="px-4 pb-4 relative">
        {/* Avatar */}
        <div class="absolute -top-16 left-4">
          <div class="w-32 h-32 rounded-full border-4 border-black overflow-hidden bg-neutral-800">
            <UserAvatar
              avatarUrl={props.profile.icon_url}
              name={props.profile.name || props.profile.preferred_username}
              size={128}
            />
          </div>
        </div>

        {/* Follow Button & Menu */}
        <div class="flex justify-end pt-3 pb-12 gap-2">
          <Show when={!props.isOwnProfile}>
            <div class="relative" ref={menuRoot}>
              <button
                ref={menuTrigger}
                onClick={props.onToggleMenu}
                aria-label={props.t("profile.moreOptions")}
                aria-haspopup="menu"
                aria-expanded={props.showMenu}
                class="p-2 border border-neutral-600 rounded-full hover:bg-neutral-900 transition-colors"
              >
                <MoreIcon />
              </button>
              <Show when={props.showMenu}>
                <div
                  ref={(el) =>
                    queueMicrotask(() => el.querySelector("button")?.focus())
                  }
                  class="absolute right-0 top-full mt-1 bg-neutral-900 rounded-xl shadow-lg py-1 min-w-[180px] z-20 border border-neutral-800"
                >
                  <button
                    onClick={() => {
                      props.onCloseMenu();
                      props.onMute();
                    }}
                    class="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-neutral-800 transition-colors"
                  >
                    {props.t("profile.mute")}
                  </button>
                  <button
                    onClick={() => {
                      props.onCloseMenu();
                      props.onBlock();
                    }}
                    class="w-full flex items-center gap-3 px-4 py-3 text-left text-red-500 hover:bg-neutral-800 transition-colors"
                  >
                    {props.t("profile.block")}
                  </button>
                </div>
              </Show>
            </div>
            <button
              onClick={props.onToggleFollow}
              disabled={props.followPending}
              class={`px-4 py-2 rounded-full font-bold transition-colors ${
                props.followPending
                  ? "bg-transparent border border-neutral-700 text-neutral-400 cursor-default"
                  : props.isFollowing
                    ? "bg-transparent border border-neutral-600 text-white hover:border-red-500 hover:text-red-500"
                    : "bg-white text-black hover:bg-neutral-200"
              }`}
            >
              {props.followPending
                ? props.t("profile.followRequested")
                : props.isFollowing
                  ? props.t("profile.unfollow")
                  : props.t("profile.follow")}
            </button>
          </Show>
          <Show when={props.isOwnProfile}>
            <button
              onClick={props.onOpenEdit}
              class="px-4 py-2 rounded-full font-bold border border-neutral-600 text-white hover:bg-neutral-900 transition-colors"
            >
              {props.t("profile.editProfile")}
            </button>
          </Show>
        </div>

        {/* Name & federated handle (user@domain, shown prominently) */}
        <div class="mb-3">
          <div class="text-xl font-bold text-white">
            {props.profile.name || props.profile.preferred_username}
          </div>
          <div
            class="select-all text-sm font-medium text-[var(--accent)]"
            title={`@${props.profile.username}`}
          >
            @{props.profile.username}
          </div>
        </div>

        {/* Account-migration banner: this account has moved elsewhere. */}
        <Show when={props.profile.moved_to}>
          <div class="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            {props
              .t("profile.movedToBanner")
              .replace("{handle}", movedToHandle(props.profile.moved_to!))}
          </div>
        </Show>

        {/* Bio */}
        <Show when={props.profile.summary}>
          <p class="text-neutral-200 mb-3 whitespace-pre-wrap">
            {props.profile.summary}
          </p>
        </Show>

        {/* Structured profile fields (PropertyValue label/value list) */}
        <Show when={visibleFields().length > 0}>
          <dl class="mb-3 overflow-hidden rounded-lg border border-neutral-800">
            <For each={visibleFields()}>
              {(field, index) => (
                <div
                  class={`flex gap-3 px-3 py-2 text-sm ${
                    index() > 0 ? "border-t border-neutral-800" : ""
                  }`}
                >
                  <dt class="w-1/3 shrink-0 truncate font-medium text-neutral-400">
                    {field.name}
                  </dt>
                  <dd class="min-w-0 flex-1 break-words text-neutral-200">
                    {field.value}
                  </dd>
                </div>
              )}
            </For>
          </dl>
        </Show>

        {/* Join Date */}
        <div class="flex items-center gap-1 text-neutral-500 text-sm mb-3">
          <CalendarIcon />
          <span>
            {props
              .t("profile.joined")
              .replace(
                "{date}",
                formatMonthYear(props.profile.created_at, props.language()),
              )}
          </span>
        </div>

        {/* Your observation scope (own profile only) */}
        <Show when={props.isOwnProfile}>
          <ProfileScopeRow />
        </Show>

        {/* Follow Stats */}
        <div class="flex gap-4 text-sm">
          <button
            onClick={() => props.onOpenFollowModal("following")}
            class="hover:underline"
          >
            <span class="font-bold text-white">
              {props.profile.following_count}
            </span>
            <span class="text-neutral-500 ml-1">
              {props.t("profile.following")}
            </span>
          </button>
          <button
            onClick={() => props.onOpenFollowModal("followers")}
            class="hover:underline"
          >
            <span class="font-bold text-white">
              {props.profile.follower_count}
            </span>
            <span class="text-neutral-500 ml-1">
              {props.t("profile.followers")}
            </span>
          </button>
        </div>
      </div>
    </>
  );
}
