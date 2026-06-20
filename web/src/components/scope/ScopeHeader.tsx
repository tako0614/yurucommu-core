import { createMemo, For, Show } from "solid-js";
import { useAtom, useAtomValue, useSetAtom } from "solid-jotai";
import { useI18n } from "../../lib/i18n.tsx";
import { actorAtom } from "../../atoms/auth.ts";
import { appMenuOpenAtom } from "../../atoms/shell.ts";
import { showPostModalAtom } from "../../atoms/timeline.ts";
import {
  communityToScope,
  inhabitedScopeAtom,
  scopeCommunitiesAtom,
  type InhabitedScope,
} from "../../atoms/scope.ts";
import { UserAvatar } from "../UserAvatar.tsx";

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

const PlusIcon = () => (
  <svg
    class="h-4 w-4"
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

interface ScopeHeaderProps {
  // Opens the filter picker / community discovery sheet from the trailing "+".
  onOpenSwitcher: () => void;
}

/**
 * Home header. The individual is the base, so home is just home — there is no
 * "inhabited scope" to name or switch. This single bar carries:
 *   - the mobile AppMenu trigger (desktop reaches the menu via the Sidebar),
 *   - the home VIEW filter inline ("すべて" + each joined community + "＋") when
 *     there is anything to filter by — otherwise a plain "ホーム" title so the bar
 *     is never empty and gives context (chiefly on mobile, which has no sidebar),
 *   - the desktop compose affordance.
 *
 * Folding the filter into the header (instead of a third stacked bar under the
 * StoryBar) keeps the top of home calm. Writes the transient
 * {@link inhabitedScopeAtom}; the filter never changes where a post lands.
 */
export function ScopeHeader(props: ScopeHeaderProps) {
  const { t } = useI18n();
  const actor = useAtomValue(actorAtom);
  const openMenu = useSetAtom(appMenuOpenAtom);
  const openComposer = useSetAtom(showPostModalAtom);
  const [scope, setScope] = useAtom(inhabitedScopeAtom);
  const communities = useAtomValue(scopeCommunitiesAtom);

  const joined = createMemo(() =>
    communities().filter((c) => c.is_member && c.member_role !== null),
  );

  const isAllActive = () => scope().kind === "personal";
  const isCommunityActive = (apId: string) => {
    const s = scope();
    return s.kind === "community" && s.ap_id === apId;
  };

  const pillClass = (active: boolean) =>
    `flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
      active
        ? "border-transparent bg-accent text-white"
        : "border-neutral-800 bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
    }`;

  const setFilter = (next: InhabitedScope) => setScope(next);

  return (
    <header class="sticky top-0 z-30 border-b border-neutral-800 bg-neutral-900/80 backdrop-blur-sm">
      <div class="flex items-center gap-2 px-4 py-2.5">
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

        {/* Inline home filter, or a plain title when there is nothing to filter. */}
        <Show
          when={joined().length > 0}
          fallback={
            <h1 class="min-w-0 flex-1 truncate text-base font-bold text-white">
              {t("nav.home")}
            </h1>
          }
        >
          <div
            role="tablist"
            aria-label={t("scope.filterLabel")}
            class="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto scrollbar-hide"
          >
            <button
              type="button"
              role="tab"
              onClick={() => setFilter({ kind: "personal" })}
              aria-selected={isAllActive()}
              class={pillClass(isAllActive())}
            >
              {t("scope.all")}
            </button>

            <For each={joined()}>
              {(community) => {
                const next = communityToScope(community);
                if (!next) return null;
                const label = community.display_name || community.name;
                const active = () => isCommunityActive(community.ap_id);
                return (
                  <button
                    type="button"
                    role="tab"
                    onClick={() => setFilter(next)}
                    aria-selected={active()}
                    class={`${pillClass(active())} pl-1`}
                  >
                    <UserAvatar
                      avatarUrl={community.icon_url}
                      name={label}
                      size={22}
                    />
                    <span class="max-w-32 truncate">{label}</span>
                  </button>
                );
              }}
            </For>

            <button
              type="button"
              onClick={props.onOpenSwitcher}
              aria-label={t("scope.addCommunity")}
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-neutral-800 bg-neutral-900 text-neutral-300 transition-colors hover:bg-neutral-800"
            >
              <PlusIcon />
            </button>
          </div>
        </Show>

        <button
          type="button"
          onClick={() => openComposer(true)}
          aria-label={t("scope.compose")}
          class="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-colors md:flex"
        >
          <ComposeIcon />
        </button>
      </div>
    </header>
  );
}
