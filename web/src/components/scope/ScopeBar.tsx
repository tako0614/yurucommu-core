import { createMemo, For } from "solid-js";
import { useAtom, useAtomValue, useSetAtom } from "solid-jotai";
import { useI18n } from "../../lib/i18n.tsx";
import { actorAtom } from "../../atoms/auth.ts";
import {
  communityToScope,
  inhabitedScopeAtom,
  scopeCommunitiesAtom,
  type InhabitedScope,
} from "../../atoms/scope.ts";
import { toastsAtom, pushToast } from "../../atoms/toast.ts";
import { UserAvatar } from "../UserAvatar.tsx";

interface ScopeBarProps {
  // Opens the ScopeSwitcherSheet (shared with the ScopeHeader pill). Used by the
  // trailing "+" affordance to reach Discover / Create.
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
 * Horizontal, one-tap segmented rail of inhabited scopes, rendered under the
 * StoryBar. Pills, in order: Personal, then each joined community, then a
 * trailing "+" that opens the switcher sheet (Discover / Create).
 *
 * This is the second projection of {@link inhabitedScopeAtom} (the first being
 * the {@link ScopeHeader} pill). Tapping a pill writes the same atom, so the
 * header label, the rail's active state, and the timeline scope query all move
 * together — there is no divergent scope state.
 */
export function ScopeBar(props: ScopeBarProps) {
  const { t } = useI18n();
  const actor = useAtomValue(actorAtom);
  const [scope, setScope] = useAtom(inhabitedScopeAtom);
  const communities = useAtomValue(scopeCommunitiesAtom);
  const setToasts = useSetAtom(toastsAtom);

  // Joined communities only; the rail never offers a scope the owner has not
  // entered. Order is preserved from the hydrate fetch.
  const joined = createMemo(() =>
    communities().filter((c) => c.is_member && c.member_role !== null),
  );

  const isPersonalActive = () => scope().kind === "personal";
  const isCommunityActive = (apId: string) => {
    const s = scope();
    return s.kind === "community" && s.ap_id === apId;
  };

  const pillClass = (active: boolean) =>
    `flex shrink-0 items-center gap-1.5 rounded-full border py-1 pl-1 pr-3 text-sm font-bold transition-colors ${
      active
        ? "border-transparent bg-accent text-white"
        : "border-neutral-800 bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
    }`;

  const select = (next: InhabitedScope, label: string) => {
    setScope(next);
    pushToast(setToasts, t("scope.switched").replace("{name}", label), {
      kind: "info",
    });
  };

  const selectPersonal = () => {
    const a = actor();
    select(
      { kind: "personal" },
      a ? a.name || a.preferred_username : t("scope.personal"),
    );
  };

  return (
    <div class="border-b border-neutral-900 px-3 py-2">
      <div class="flex items-center gap-2 overflow-x-auto scrollbar-hide">
        {/* Personal — always first. Labelled with the community short glyph to
            signal it is the always-present home ring. */}
        <button
          type="button"
          onClick={selectPersonal}
          aria-pressed={isPersonalActive()}
          class={pillClass(isPersonalActive())}
        >
          <UserAvatar
            avatarUrl={actor()?.icon_url ?? null}
            name={actor()?.name || actor()?.preferred_username || "?"}
            size={22}
          />
          <span class="max-w-28 truncate">{t("scope.personal")}</span>
        </button>

        {/* Joined communities. */}
        <For each={joined()}>
          {(community) => {
            const next = communityToScope(community);
            if (!next) return null;
            const label = community.display_name || community.name;
            const active = () => isCommunityActive(community.ap_id);
            return (
              <button
                type="button"
                onClick={() => select(next, label)}
                aria-pressed={active()}
                class={pillClass(active())}
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

        {/* Trailing "+" — opens the switcher (Discover / Create). */}
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
  );
}
