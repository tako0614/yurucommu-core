import { onCleanup, onMount } from "solid-js";
import { useSetAtom } from "solid-jotai";
import { refreshDmUnreadAtom } from "../atoms/dm-unread.ts";

/**
 * Mount once (in the authenticated app layout) to keep the shared DM unread
 * count fresh via lightweight polling — the counterpart to
 * `useNotificationPolling`. Without it `dmUnreadCountAtom` is never written, so
 * the Messages nav badge stays permanently 0.
 *
 * - Polls every `pollIntervalMs` (default 30s) while the tab is visible.
 * - Pauses when the tab is hidden and refreshes immediately on return.
 * - Cleans up the interval + listener on unmount; one mount point avoids
 *   duplicate intervals.
 */
export function useDmUnreadPolling(pollIntervalMs = 30000) {
  const refresh = useSetAtom(refreshDmUnreadAtom);

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
        void refresh();
        start();
      }
    };

    void refresh();
    if (!document.hidden) start();

    document.addEventListener("visibilitychange", handleVisibility);

    onCleanup(() => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibility);
    });
  });
}
