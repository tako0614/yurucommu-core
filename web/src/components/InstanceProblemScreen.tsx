import { createSignal, For, Show } from "solid-js";
import { useI18n } from "../lib/i18n.tsx";
import type { InstanceHealth } from "../lib/plugin.ts";
import { yurucommuDeployDocsUrl } from "../lib/deploy-docs.ts";

interface InstanceProblemScreenProps {
  /** Distinguishes the missing vs. blocked copy. */
  variant: "missing" | "blocked";
  /** Latest health snapshot, used to surface diagnostic reasons. */
  health: InstanceHealth | null;
  /** Instance id used to trigger a rebuild. */
  instanceId: string | null;
  /** Rebuilds the instance. */
  onRebuild: (instanceId: string) => Promise<boolean> | void;
}

/**
 * Terminal cold-start screen for a hosted instance that is missing or blocked.
 * Surfaces diagnostic reasons, a deploy-docs link, and a rebuild action.
 */
export function InstanceProblemScreen(props: InstanceProblemScreenProps) {
  const { t } = useI18n();
  const [rebuilding, setRebuilding] = createSignal(false);
  const deployDocsUrl = yurucommuDeployDocsUrl();

  const description = () =>
    props.variant === "blocked"
      ? t("instance.blockedDescription")
      : t("instance.missingDescription");

  const handleRebuild = async () => {
    const id = props.instanceId;
    if (!id) return;
    setRebuilding(true);
    try {
      await props.onRebuild(id);
    } finally {
      setRebuilding(false);
    }
  };

  return (
    <div class="flex min-h-screen flex-col items-center justify-center bg-neutral-950 p-6 text-neutral-100">
      <div class="w-full max-w-sm space-y-6">
        <div class="flex flex-col items-center space-y-3 text-center">
          <div class="flex h-12 w-12 items-center justify-center rounded-full bg-red-900/30 text-red-400">
            <svg
              class="h-6 w-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width={2}
                d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z"
              />
            </svg>
          </div>
          <h1 class="text-xl font-bold">{t("instance.problemTitle")}</h1>
          <p class="text-sm text-neutral-400">{description()}</p>
        </div>

        <Show when={props.health && props.health.reasons.length > 0}>
          <div class="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
            <p class="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
              {t("instance.reasons")}
            </p>
            <ul class="space-y-1 text-sm text-neutral-400">
              <For each={props.health!.reasons}>
                {(reason) => <li class="font-mono text-xs">{reason}</li>}
              </For>
            </ul>
          </div>
        </Show>

        <div class="space-y-3">
          <Show when={props.instanceId}>
            <button
              type="button"
              onClick={handleRebuild}
              disabled={rebuilding()}
              class="w-full rounded-md bg-accent px-4 py-3 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              {rebuilding() ? t("instance.rebuilding") : t("instance.rebuild")}
            </button>
          </Show>
          <a
            href={deployDocsUrl}
            rel="noopener"
            class="block w-full rounded-md border border-neutral-700 px-4 py-3 text-center text-sm font-medium text-neutral-200 transition-colors hover:bg-neutral-800"
          >
            {t("instance.deployDocs")}
          </a>
        </div>
      </div>
    </div>
  );
}

export default InstanceProblemScreen;
