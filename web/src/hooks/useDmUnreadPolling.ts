import { refreshDmUnreadAtom } from "../atoms/dm-unread.ts";
import { useUnreadPolling } from "./useUnreadPolling.ts";

/**
 * Mount once (in the authenticated app layout) to keep the shared DM unread
 * count fresh via lightweight polling — the counterpart to
 * `useNotificationPolling`. Without it `dmUnreadCountAtom` is never written, so
 * the Messages nav badge stays permanently 0.
 */
export function useDmUnreadPolling(pollIntervalMs = 30000) {
  useUnreadPolling(refreshDmUnreadAtom, pollIntervalMs);
}
