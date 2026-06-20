import { createMemo, For, Show } from "solid-js";
import { useAtomValue } from "solid-jotai";
import { useI18n } from "../../lib/i18n.tsx";
import { myScopesAtom } from "../../atoms/scope.ts";

const CommunityGlyph = () => (
  <svg
    class="h-3.5 w-3.5 shrink-0"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a4 4 0 10-1-7.87"
    />
  </svg>
);

/**
 * "Communities" chip row, shown on the owner's own profile — the named circles
 * they belong to, using the same {@link myScopesAtom} source that backs the home
 * filter. The individual is the base, so the owner is NOT listed as a scope here;
 * only joined communities are. Hidden entirely when there are none.
 *
 * Descriptive of belonging only — NOT a visibility control, and tapping a chip
 * does not change the active home filter.
 */
export function ProfileScopeRow() {
  const { t } = useI18n();
  const scopes = useAtomValue(myScopesAtom);

  const communities = createMemo(() =>
    scopes().filter(
      (s): s is Extract<typeof s, { kind: "community" }> =>
        s.kind === "community",
    ),
  );

  return (
    <Show when={communities().length > 0}>
      <div class="mb-3">
        <p class="mb-1.5 text-xs font-medium text-neutral-500">
          {t("profile.communities")}
        </p>
        <div class="flex flex-wrap gap-2">
          <For each={communities()}>
            {(community) => (
              <span
                data-scope-key={community.ap_id}
                class="inline-flex max-w-full items-center gap-1.5 rounded-full border border-neutral-800 bg-neutral-900/60 px-2.5 py-1 text-xs font-medium text-neutral-300"
              >
                <Show when={community.icon_url} fallback={<CommunityGlyph />}>
                  <img
                    src={community.icon_url}
                    alt=""
                    class="h-4 w-4 shrink-0 rounded-full object-cover"
                  />
                </Show>
                <span class="min-w-0 truncate">
                  {community.display_name || community.name}
                </span>
              </span>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}
