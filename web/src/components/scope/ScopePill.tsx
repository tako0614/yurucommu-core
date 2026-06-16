import { Show } from "solid-js";
import { useAtomValue } from "solid-jotai";
import { useI18n } from "../../lib/i18n.tsx";
import { actorAtom } from "../../atoms/auth.ts";
import { inhabitedScopeAtom } from "../../atoms/scope.ts";
import { UserAvatar } from "../UserAvatar.tsx";

interface ScopePillProps {
  // Opens the ScopeSwitcherSheet. The host owns the open state.
  onOpen: () => void;
  class?: string;
}

const ChevronDown = () => (
  <svg
    class="h-4 w-4 shrink-0 text-neutral-400"
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

/**
 * Compact avatar + name pill that surfaces the currently inhabited scope and,
 * when tapped, asks the host to open the {@link ScopeSwitcherSheet}.
 *
 * Personal scope renders the owner's own avatar/handle; a community scope
 * renders the community icon + display name. The pill never changes the scope
 * itself — it is purely a trigger.
 */
export function ScopePill(props: ScopePillProps) {
  const { t } = useI18n();
  const scope = useAtomValue(inhabitedScopeAtom);
  const actor = useAtomValue(actorAtom);

  const label = () => {
    const s = scope();
    if (s.kind === "community") return s.display_name || s.name;
    const a = actor();
    return a ? a.name || a.preferred_username : t("scope.personal");
  };

  const avatarUrl = () => {
    const s = scope();
    if (s.kind === "community") return s.icon_url ?? null;
    return actor()?.icon_url ?? null;
  };

  return (
    <button
      type="button"
      onClick={props.onOpen}
      aria-haspopup="dialog"
      aria-label={t("scope.switch")}
      class={`flex max-w-full items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900 py-1 pl-1 pr-2.5 transition-colors hover:bg-neutral-800 ${
        props.class ?? ""
      }`}
    >
      <UserAvatar avatarUrl={avatarUrl()} name={label()} size={28} />
      <span class="min-w-0 truncate text-sm font-bold text-white">
        {label()}
      </span>
      <Show when={scope().kind === "personal"}>
        <span class="shrink-0 text-xs font-medium text-neutral-500">
          {t("scope.personal")}
        </span>
      </Show>
      <ChevronDown />
    </button>
  );
}
