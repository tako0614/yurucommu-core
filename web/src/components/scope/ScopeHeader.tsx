import { Show } from "solid-js";
import { useAtomValue, useSetAtom } from "solid-jotai";
import { useI18n } from "../../lib/i18n.tsx";
import { actorAtom } from "../../atoms/auth.ts";
import { inhabitedScopeAtom } from "../../atoms/scope.ts";
import { appMenuOpenAtom } from "../../atoms/shell.ts";
import { showPostModalAtom } from "../../atoms/timeline.ts";
import { UserAvatar } from "../UserAvatar.tsx";
import { ScopePill } from "./ScopePill.tsx";

interface ScopeHeaderProps {
  // Opens the ScopeSwitcherSheet; the host owns the open state so the same
  // sheet instance is shared with the ScopeBar's trailing affordance.
  onOpenSwitcher: () => void;
}

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

        {/* Right cluster: scope-aware compose only. DM and notifications are
            intentionally NOT duplicated here — the desktop sidebar and the
            mobile BottomNav already surface those destinations, so repeating
            them in the column header is redundant clutter. Compose stays
            because it posts to the CURRENT inhabited scope. */}
        <div class="hidden shrink-0 items-center gap-1 md:flex">
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
