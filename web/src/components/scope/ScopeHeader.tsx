import { createMemo, Show } from "solid-js";
import { useAtomValue, useSetAtom } from "solid-jotai";
import { useI18n } from "../../lib/i18n.tsx";
import { actorAtom } from "../../atoms/auth.ts";
import { appMenuOpenAtom } from "../../atoms/shell.ts";
import { showPostModalAtom } from "../../atoms/timeline.ts";
import { inhabitedScopeAtom, scopeCommunitiesAtom } from "../../atoms/scope.ts";
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

const ChevronDownIcon = () => (
  <svg
    class="h-4 w-4 shrink-0 text-neutral-500"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M19 9l-7 7-7-7"
    />
  </svg>
);

interface ScopeHeaderProps {
  // Opens the filter picker / community discovery sheet.
  onOpenSwitcher: () => void;
}

/**
 * Home header. The individual is the base, so home is just home. This single bar
 * carries the mobile AppMenu trigger, the desktop compose affordance, and — when
 * the owner belongs to any community — a compact home VIEW filter rendered as the
 * title itself: "ホーム ▾" while unfiltered, or the community's avatar + name once
 * narrowed. Tapping it opens the picker sheet (which also hosts Discover / Create),
 * so there is no separate pill rail or add button cluttering the bar. When there
 * is nothing to filter by, the title is a plain, non-interactive "ホーム".
 *
 * The filter is a transient view lens ({@link inhabitedScopeAtom}); it never
 * changes where a post lands.
 */
export function ScopeHeader(props: ScopeHeaderProps) {
  const { t } = useI18n();
  const actor = useAtomValue(actorAtom);
  const openMenu = useSetAtom(appMenuOpenAtom);
  const openComposer = useSetAtom(showPostModalAtom);
  const scope = useAtomValue(inhabitedScopeAtom);
  const communities = useAtomValue(scopeCommunitiesAtom);

  const joined = createMemo(() =>
    communities().filter((c) => c.is_member && c.member_role !== null),
  );

  const activeCommunity = () => {
    const s = scope();
    return s.kind === "community" ? s : null;
  };

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

        {/* Title doubles as the home filter when there are communities to switch
            between; otherwise it is a plain label. */}
        <div class="min-w-0 flex-1">
          <Show
            when={joined().length > 0}
            fallback={
              <h1 class="truncate text-base font-bold text-white">
                {t("nav.home")}
              </h1>
            }
          >
            <button
              type="button"
              onClick={props.onOpenSwitcher}
              aria-haspopup="dialog"
              aria-label={t("scope.filterLabel")}
              class="-ml-2 flex max-w-full items-center gap-1.5 rounded-full px-2 py-1 transition-colors hover:bg-neutral-800"
            >
              <Show
                when={activeCommunity()}
                fallback={
                  <span class="truncate text-base font-bold text-white">
                    {t("nav.home")}
                  </span>
                }
              >
                {(c) => (
                  <>
                    <UserAvatar
                      avatarUrl={c().icon_url ?? null}
                      name={c().display_name || c().name}
                      size={24}
                    />
                    <span class="truncate text-base font-bold text-white">
                      {c().display_name || c().name}
                    </span>
                  </>
                )}
              </Show>
              <ChevronDownIcon />
            </button>
          </Show>
        </div>

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
