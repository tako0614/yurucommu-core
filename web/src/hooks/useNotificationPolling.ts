import { refreshNotificationUnreadAtom } from "../atoms/notifications.ts";
import { useUnreadPolling } from "./useUnreadPolling.ts";

/**
 * Mount once (in the authenticated app layout) to keep the shared notification
 * unread count fresh via lightweight polling.
 */
export function useNotificationPolling(pollIntervalMs = 30000) {
  useUnreadPolling(refreshNotificationUnreadAtom, pollIntervalMs);
}
