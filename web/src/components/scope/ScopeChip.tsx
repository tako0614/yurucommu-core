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
 * Compact, read-only badge shown ONLY on a post deliberately narrowed to a
 * community. The individual is the base, so a personal (default) post carries no
 * badge — that keeps the unified home quiet. A community post resolves its
 * {@link CommunityScope} via {@link myScopesAtom} and renders the community icon +
 * display name, falling back to a generic community glyph + short label when the
 * community is not in the owner's joined scopes.
 *
 * Purely descriptive of where the post was narrowed to — NOT a visibility control.
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

  const label = () => {
    const c = community();
    if (c) return c.display_name || c.name;
    return t("scope.communityShort");
  };

  // Personal posts (the default) carry no badge — only a post deliberately
  // narrowed to a community shows one, keeping the timeline quiet.
  return (
    <Show when={props.communityApId}>
      <span
        class={`inline-flex max-w-[35%] items-center gap-0.5 rounded-full border border-neutral-800 bg-neutral-900/60 px-1.5 py-0.5 text-[10px] font-medium leading-none text-neutral-400 ${
          props.class ?? ""
        }`}
        title={label()}
      >
        <Show when={community()} fallback={<CommunityGlyph />}>
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
    </Show>
  );
}
