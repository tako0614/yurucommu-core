import { Show } from "solid-js";
import { useAtomValue, useSetAtom } from "solid-jotai";
import { useI18n } from "../../lib/i18n.tsx";
import { actorAtom } from "../../atoms/auth.ts";
import { appMenuOpenAtom } from "../../atoms/shell.ts";
import { showPostModalAtom } from "../../atoms/timeline.ts";
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

/**
 * Minimal home header. The individual is the base, so home is just home — there
 * is no "inhabited scope" to name or switch here. It carries the mobile AppMenu
 * trigger, a plain title, and the desktop compose affordance; narrowing the view
 * to a community is a separate, optional filter (ScopeBar).
 */
export function ScopeHeader() {
  const { t } = useI18n();
  const actor = useAtomValue(actorAtom);
  const openMenu = useSetAtom(appMenuOpenAtom);
  const openComposer = useSetAtom(showPostModalAtom);

  return (
    <header class="sticky top-0 z-30 border-b border-neutral-800 bg-neutral-900/80 backdrop-blur-sm">
      <div class="flex items-center gap-2 px-4 py-3">
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

        <h1 class="min-w-0 flex-1 truncate text-base font-bold text-white">
          {t("nav.home")}
        </h1>

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
