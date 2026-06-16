import { onCleanup, onMount } from "solid-js";
import { useSetAtom } from "solid-jotai";
import { refreshNotificationUnreadAtom } from "../atoms/notifications.ts";

/**
 * Mount once (in the authenticated app layout) to keep the shared notification
 * unread count fresh via lightweight polling.
 *
 * - Polls every `pollIntervalMs` (default 30s) while the tab is visible.
 * - Pauses the interval when the tab is hidden (`visibilitychange`) and resumes
 *   on focus, refreshing immediately so the badge is current when the user
 *   returns.
 * - Cleans up the interval and listener on unmount; a single mount point avoids
 *   duplicate intervals.
 */
export function useNotificationPolling(pollIntervalMs = 30000) {
  const refresh = useSetAtom(refreshNotificationUnreadAtom);

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
