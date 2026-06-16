import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { useI18n } from "../lib/i18n.tsx";
import type { InstanceHealth } from "../lib/plugin.ts";
import type { TranslationKey } from "../atoms/i18n.ts";

interface InstancePendingScreenProps {
  /** Latest health snapshot; may be null before the first check resolves. */
  health: InstanceHealth | null;
  /** Instance id used to trigger a rebuild when provisioning stalls. */
  instanceId: string | null;
  /** Re-runs the auth/health check (used for polling). */
  onRefresh: () => Promise<void> | void;
  /** Rebuilds the instance when provisioning seems stuck. */
  onRebuild: (instanceId: string) => Promise<boolean> | void;
}

const POLL_INTERVAL_MS = 5000;
// Offer a rebuild once provisioning has dragged on past this many polls.
const STALL_AFTER_POLLS = 12;

const CHECK_ROWS: Array<{
  key: keyof InstanceHealth["checks"];
  label: TranslationKey;
}> = [
  { key: "worker_exists", label: "instance.checkWorker" },
  { key: "d1_exists", label: "instance.checkD1" },
  { key: "r2_exists", label: "instance.checkR2" },
  { key: "kv_exists", label: "instance.checkKV" },
  { key: "runtime_health_ok", label: "instance.checkRuntime" },
];

/**
 * Cold-start screen shown while a hosted instance is still provisioning. Lists
 * the per-resource health checks, polls {@link InstancePendingScreenProps.onRefresh}
 * on an interval, and surfaces a rebuild action once provisioning stalls.
 */
export function InstancePendingScreen(props: InstancePendingScreenProps) {
  const { t } = useI18n();
  const [polls, setPolls] = createSignal(0);
  const [rebuilding, setRebuilding] = createSignal(false);

  onMount(() => {
    const timer = setInterval(() => {
      setPolls((n) => n + 1);
      void props.onRefresh();
    }, POLL_INTERVAL_MS);
    onCleanup(() => clearInterval(timer));
  });

  const stalled = () => polls() >= STALL_AFTER_POLLS;

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
          <div class="h-10 w-10 animate-spin rounded-full border-3 border-neutral-700 border-t-accent" />
          <h1 class="text-xl font-bold">{t("instance.pendingTitle")}</h1>
          <p class="text-sm text-neutral-400">
            {t("instance.pendingDescription")}
          </p>
        </div>

        <Show when={props.health}>
          {(health) => (
            <ul class="space-y-2 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
              <For each={CHECK_ROWS}>
                {(row) => {
                  const ok = () => health().checks[row.key];
                  return (
                    <li class="flex items-center justify-between text-sm">
                      <span class="text-neutral-300">{t(row.label)}</span>
                      <span
                        class={
                          ok()
                            ? "flex items-center gap-1.5 text-green-400"
                            : "flex items-center gap-1.5 text-neutral-500"
                        }
                      >
                        <Show
                          when={ok()}
                          fallback={
                            <span class="h-3 w-3 animate-spin rounded-full border-2 border-neutral-600 border-t-neutral-400" />
                          }
                        >
                          <svg
                            class="h-4 w-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width={2}
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        </Show>
                        {ok()
                          ? t("instance.checkOk")
                          : t("instance.checkPending")}
                      </span>
                    </li>
                  );
                }}
              </For>
              <Show when={health().checked_at}>
                <li class="pt-1 text-xs text-neutral-600">
                  {t("instance.lastChecked").replace(
                    "{time}",
                    new Date(health().checked_at).toLocaleTimeString(),
                  )}
                </li>
              </Show>
            </ul>
          )}
        </Show>

        <div class="space-y-3">
          <button
            type="button"
            onClick={() => void props.onRefresh()}
            class="w-full rounded-md border border-neutral-700 px-4 py-2 text-sm font-medium text-neutral-200 transition-colors hover:bg-neutral-800"
          >
            {t("instance.refresh")}
          </button>

          <Show when={stalled() && props.instanceId}>
            <div class="space-y-2 text-center">
              <p class="text-xs text-neutral-500">
                {t("instance.stalledHint")}
              </p>
              <button
                type="button"
                onClick={handleRebuild}
                disabled={rebuilding()}
                class="w-full rounded-md border border-accent px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-[var(--accent)]/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {rebuilding()
                  ? t("instance.rebuilding")
                  : t("instance.rebuild")}
              </button>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}

export default InstancePendingScreen;
