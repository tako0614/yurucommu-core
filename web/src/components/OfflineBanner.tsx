import { Show } from "solid-js";
import { Portal } from "solid-js/web";
import { useAtomValue } from "solid-jotai";
import { isOnlineAtom } from "../atoms/connectivity.ts";
import { useI18n } from "../lib/i18n.tsx";

/**
 * App-wide offline indicator. Renders nothing while online (no layout shift),
 * and a slim sticky bar when the browser reports it has gone offline.
 *
 * Sits just above the BottomNav (bottom-16) on mobile so it clears the
 * safe-area / nav, and pins to the bottom edge on desktop. Polite live region
 * so screen readers announce the state change without interrupting.
 */
export function OfflineBanner() {
  const online = useAtomValue(isOnlineAtom);
  const { t } = useI18n();

  return (
    <Show when={!online()}>
      <Portal>
        <div
          role="status"
          aria-live="polite"
          class="pointer-events-none fixed inset-x-0 bottom-16 z-[60] flex justify-center px-4 md:bottom-0 md:px-6 md:pb-4"
        >
          <div class="pointer-events-auto flex w-full max-w-md flex-col items-center gap-0.5 rounded-xl border border-red-500/40 bg-red-950/90 px-4 py-2 text-center shadow-xl backdrop-blur md:max-w-sm">
            <span class="text-sm font-medium text-red-100">
              {t("app.offline")}
            </span>
            <span class="text-xs text-red-200/70">{t("app.offlineHint")}</span>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
