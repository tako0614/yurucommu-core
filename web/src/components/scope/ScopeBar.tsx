import { createMemo, For, Show } from "solid-js";
import { useAtom, useAtomValue } from "solid-jotai";
import { useI18n } from "../../lib/i18n.tsx";
import {
  communityToScope,
  inhabitedScopeAtom,
  scopeCommunitiesAtom,
  type InhabitedScope,
} from "../../atoms/scope.ts";
import { UserAvatar } from "../UserAvatar.tsx";

interface ScopeBarProps {
  // Opens the switcher sheet (Discover / Create communities) from the trailing
  // "+" affordance.
  onOpenSwitcher: () => void;
}

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

/**
 * Home view filter — a quiet horizontal rail under the StoryBar. "すべて" is the
 * unfiltered home (your whole reach); each joined community narrows the SAME
 * feed to that community's people. This is only a VIEW lens (it never changes
 * where a post lands), so it carries no toast and is hidden entirely when there
 * is nothing to filter by. Writes the transient {@link inhabitedScopeAtom}.
 */
export function ScopeBar(props: ScopeBarProps) {
  const { t } = useI18n();
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

  // Nothing to narrow by → no filter rail (keeps home uncluttered).
  return (
    <Show when={joined().length > 0}>
      <div
        role="tablist"
        aria-label={t("scope.filterLabel")}
        class="border-b border-neutral-900 px-3 py-2"
      >
        <div class="flex items-center gap-2 overflow-x-auto scrollbar-hide">
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
      </div>
    </Show>
  );
}
