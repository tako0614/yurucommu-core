import { createMemo, For, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { useNavigate } from "@solidjs/router";
import { useAtom, useAtomValue, useSetAtom } from "solid-jotai";
import { useI18n } from "../../lib/i18n.tsx";
import { useDialog } from "../../lib/useDialog.ts";
import { actorAtom } from "../../atoms/auth.ts";
import {
  communityToScope,
  inhabitedScopeAtom,
  scopeCommunitiesAtom,
  type InhabitedScope,
} from "../../atoms/scope.ts";
import { toastsAtom, pushToast } from "../../atoms/toast.ts";
import { UserAvatar } from "../UserAvatar.tsx";

interface ScopeSwitcherSheetProps {
  open: boolean;
  onClose: () => void;
  // Optional host overrides for the two action rows. When omitted the sheet
  // navigates to the discovery surface; the host can intercept (e.g. to open a
  // create-community composer) instead.
  onDiscover?: () => void;
  onCreate?: () => void;
}

const CheckIcon = () => (
  <svg
    class="h-5 w-5 shrink-0 text-[var(--accent)]"
    fill="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
  </svg>
);

const DiscoverIcon = () => (
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
      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
    />
  </svg>
);

const CreateIcon = () => (
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
 * Scope picker. Renders as a bottom sheet on mobile and a centered popover-style
 * card on desktop (same responsive shell as {@link ConfirmSheet}).
 *
 * Rows, in order:
 *  1. Personal (owner avatar/handle) — always present, always first.
 *  2. Each joined community (icon + display name + member count).
 *  3. "Discover communities" action.
 *  4. "Create" action.
 *
 * Selecting a scope row sets {@link inhabitedScopeAtom} and closes the sheet —
 * it does NOT navigate (scope is an observation lens, not a route). The Discover
 * / Create rows are the only navigating affordances.
 */
export function ScopeSwitcherSheet(props: ScopeSwitcherSheetProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const actor = useAtomValue(actorAtom);
  const [scope, setScope] = useAtom(inhabitedScopeAtom);
  const communities = useAtomValue(scopeCommunitiesAtom);
  const setToasts = useSetAtom(toastsAtom);
  let dialogRef: HTMLDivElement | undefined;

  useDialog({
    isOpen: () => props.open,
    onClose: () => props.onClose(),
    container: () => dialogRef,
  });

  // Joined communities only; the picker never offers a scope the owner has not
  // entered. Order is preserved from the hydrate fetch.
  const joined = createMemo(() =>
    communities().filter((c) => c.is_member && c.member_role !== null),
  );

  const isActive = (candidate: InhabitedScope) => {
    const current = scope();
    if (candidate.kind === "personal") return current.kind === "personal";
    return (
      current.kind === "community" && current.ap_id === candidate.ap_id
    );
  };

  const selectScope = (next: InhabitedScope, label: string) => {
    setScope(next);
    pushToast(setToasts, t("scope.switched").replace("{name}", label), {
      kind: "info",
    });
    props.onClose();
  };

  const selectPersonal = () => {
    const a = actor();
    selectScope(
      { kind: "personal" },
      a ? a.name || a.preferred_username : t("scope.personal"),
    );
  };

  const handleDiscover = () => {
    props.onClose();
    if (props.onDiscover) props.onDiscover();
    else navigate("/search");
  };

  const handleCreate = () => {
    props.onClose();
    if (props.onCreate) props.onCreate();
    else navigate("/search");
  };

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) props.onClose();
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("scope.switch")}
            class="max-h-[80vh] w-full max-w-sm overflow-y-auto rounded-t-2xl border border-neutral-800 bg-neutral-900 p-2 shadow-2xl sm:rounded-2xl"
          >
            <h2
              id="scope-switcher-heading"
              class="px-3 pb-1 pt-2 text-xs font-bold uppercase tracking-wide text-neutral-500"
            >
              {t("scope.switch")}
            </h2>

            {/* Selectable scopes (radiogroup): Personal + joined communities.
                Each row exposes aria-checked so SR users hear which scope they
                inhabit, mirroring ScopeBar's aria-pressed pills. */}
            <div role="radiogroup" aria-labelledby="scope-switcher-heading">
            {/* Personal scope — always first. */}
            <button
              type="button"
              role="radio"
              aria-checked={isActive({ kind: "personal" })}
              onClick={selectPersonal}
              class="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-neutral-800"
            >
              <UserAvatar
                avatarUrl={actor()?.icon_url ?? null}
                name={
                  actor()?.name || actor()?.preferred_username || "?"
                }
                size={40}
              />
              <div class="min-w-0 flex-1">
                <p class="truncate font-bold text-white">
                  {actor()
                    ? actor()!.name || actor()!.preferred_username
                    : t("scope.personal")}
                </p>
                <p class="truncate text-sm text-neutral-500">
                  {t("scope.personalDesc")}
                </p>
              </div>
              <Show when={isActive({ kind: "personal" })}>
                <CheckIcon />
              </Show>
            </button>

            {/* Joined communities. */}
            <For each={joined()}>
              {(community) => {
                const next = communityToScope(community);
                if (!next) return null;
                return (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={isActive(next)}
                    onClick={() =>
                      selectScope(
                        next,
                        community.display_name || community.name,
                      )
                    }
                    class="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-neutral-800"
                  >
                    <UserAvatar
                      avatarUrl={community.icon_url}
                      name={community.display_name || community.name}
                      size={40}
                    />
                    <div class="min-w-0 flex-1">
                      <p class="truncate font-bold text-white">
                        {community.display_name || community.name}
                      </p>
                      <p class="truncate text-sm text-neutral-500">
                        {t("community.members").replace(
                          "{count}",
                          String(community.member_count ?? 0),
                        )}
                      </p>
                    </div>
                    <Show when={isActive(next)}>
                      <CheckIcon />
                    </Show>
                  </button>
                );
              }}
            </For>
            </div>

            <div class="my-1 border-t border-neutral-800" />

            {/* Discover communities. */}
            <button
              type="button"
              onClick={handleDiscover}
              class="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-white transition-colors hover:bg-neutral-800"
            >
              <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-neutral-300">
                <DiscoverIcon />
              </span>
              <span class="flex-1 text-sm font-medium">
                {t("scope.discover")}
              </span>
            </button>

            {/* Create a community. */}
            <button
              type="button"
              onClick={handleCreate}
              class="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-white transition-colors hover:bg-neutral-800"
            >
              <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-neutral-300">
                <CreateIcon />
              </span>
              <span class="flex-1 text-sm font-medium">
                {t("scope.create")}
              </span>
            </button>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
