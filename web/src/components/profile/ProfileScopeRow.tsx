import { For, Show } from "solid-js";
import { useAtomValue } from "solid-jotai";
import { useI18n } from "../../lib/i18n.tsx";
import { myScopesAtom } from "../../atoms/scope.ts";
import type { InhabitedScope } from "../../atoms/scope.ts";

// Personal-scope glyph — the owner's own place (you + followers).
const PersonalGlyph = () => (
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
      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
    />
  </svg>
);

function scopeKey(scope: InhabitedScope): string {
  return scope.kind === "personal" ? "personal" : scope.ap_id;
}

/**
 * "Your observation scope" chip row, shown on the owner's own profile. It names
 * the scopes the owner inhabits (personal first, then each joined community)
 * using the same {@link myScopesAtom} source that backs the scope switcher.
 *
 * This is descriptive of reach/observation only — it is NOT a visibility
 * control and tapping a chip does not change the active scope here.
 */
export function ProfileScopeRow() {
  const { t } = useI18n();
  const scopes = useAtomValue(myScopesAtom);

  return (
    <div class="mb-3">
      <p class="mb-1.5 text-xs font-medium text-neutral-500">
        {t("profile.observationScope")}
      </p>
      <div class="flex flex-wrap gap-2">
        <For each={scopes()}>
          {(scope) => (
            <span
              data-scope-key={scopeKey(scope)}
              class="inline-flex max-w-full items-center gap-1.5 rounded-full border border-neutral-800 bg-neutral-900/60 px-2.5 py-1 text-xs font-medium text-neutral-300"
            >
              <Show
                when={scope.kind === "community" ? scope : null}
                fallback={<PersonalGlyph />}
              >
                {(community) => (
                  <Show
                    when={community().icon_url}
                    fallback={<PersonalGlyph />}
                  >
                    <img
                      src={community().icon_url}
                      alt=""
                      class="h-4 w-4 shrink-0 rounded-full object-cover"
                    />
                  </Show>
                )}
              </Show>
              <span class="min-w-0 truncate">
                {scope.kind === "personal"
                  ? t("scope.personal")
                  : scope.display_name || scope.name}
              </span>
            </span>
          )}
        </For>
      </div>
    </div>
  );
}
