import { onCleanup, onMount } from "solid-js";
import { useSetAtom } from "solid-jotai";
import type { WritableAtom } from "jotai";

/**
 * Mount once (in the authenticated app layout) to keep a shared unread count
 * fresh via lightweight polling of `refreshAtom`.
 *
 * - Polls every `pollIntervalMs` (default 30s) while the tab is visible.
 * - Pauses the interval when the tab is hidden (`visibilitychange`) and resumes
 *   on return, refreshing immediately so the badge is current.
 * - Cleans up the interval + listener on unmount; one mount point avoids
 *   duplicate intervals.
 */
export function useUnreadPolling(
  refreshAtom: WritableAtom<unknown, [], unknown>,
  pollIntervalMs = 30000,
) {
  const refresh = useSetAtom(refreshAtom);

  onMount(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const start = () => {
      if (intervalId !== null) return;
      intervalId = setInterval(() => {
        void refresh();
      }, pollIntervalMs);
    };

    const handleVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        // Refresh immediately on return, then resume the interval.
        void refresh();
        start();
      }
    };

    // Initial fetch + start polling if the tab is currently visible.
    void refresh();
    if (!document.hidden) start();

    document.addEventListener("visibilitychange", handleVisibility);

    onCleanup(() => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibility);
    });
  });
}
