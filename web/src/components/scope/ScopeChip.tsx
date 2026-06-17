import { Show, createMemo } from "solid-js";
import { useAtomValue } from "solid-jotai";
import { useI18n } from "../../lib/i18n.tsx";
import { myScopesAtom } from "../../atoms/scope.ts";
import type { CommunityScope } from "../../atoms/scope.ts";

interface ScopeChipProps {
  // The post's community_ap_id; null means a personal (non-community) post.
  communityApId: string | null;
  class?: string;
}

// People glyph — the personal-scope reach marker (you + followers).
const PeopleGlyph = () => (
  <svg
    class="h-3 w-3 shrink-0"
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

// Generic community glyph — a circle of people, used when a post is scoped to a
// community that is not in the owner's own joined scopes (still legible because
// the backend only surfaces communities the viewer may read).
const CommunityGlyph = () => (
  <svg
    class="h-3 w-3 shrink-0"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
    />
  </svg>
);

/**
 * Compact, read-only chip that names a post's reach ("Inhabited Scope" lens):
 *
 *  - A community post resolves its {@link CommunityScope} via {@link myScopesAtom}
 *    and renders the community icon + display name.
 *  - A community post whose community is not in the owner's joined scopes falls
 *    back to a generic community glyph + a short "Circle" label.
 *  - A personal (non-community) post renders a people glyph + a short personal
 *    label (reaches you and your followers).
 *
 * This is purely descriptive of where the post lives — it is NOT a visibility
 * control and never mutates the scope.
 */
export function ScopeChip(props: ScopeChipProps) {
  const { t } = useI18n();
  const scopes = useAtomValue(myScopesAtom);

  const community = createMemo<CommunityScope | null>(() => {
    if (!props.communityApId) return null;
    const match = scopes().find(
      (s): s is CommunityScope =>
        s.kind === "community" && s.ap_id === props.communityApId,
    );
    return match ?? null;
  });

  const isCommunity = () => props.communityApId !== null;

  const label = () => {
    const c = community();
    if (c) return c.display_name || c.name;
    if (isCommunity()) return t("scope.communityShort");
    return t("scope.chipPersonal");
  };

  return (
    <span
      class={`inline-flex max-w-[35%] items-center gap-0.5 rounded-full border border-neutral-800 bg-neutral-900/60 px-1.5 py-0.5 text-[10px] font-medium leading-none text-neutral-400 ${
        props.class ?? ""
      }`}
      title={label()}
    >
      <Show
        when={community()}
        fallback={
          <Show when={isCommunity()} fallback={<PeopleGlyph />}>
            <CommunityGlyph />
          </Show>
        }
      >
        {(c) => (
          <Show when={c().icon_url} fallback={<CommunityGlyph />}>
            <img
              src={c().icon_url}
              alt=""
              class="h-3.5 w-3.5 shrink-0 rounded-full object-cover"
            />
          </Show>
        )}
      </Show>
      <span class="min-w-0 truncate">{label()}</span>
    </span>
  );
}
