import { atom } from "jotai";
import { fetchUnreadCount } from "../lib/api.ts";

// Shared, app-wide unread notification count. A single poller (mounted once in
// the app layout) writes this; nav surfaces (sidebar bell, mobile header) read
// it, and the notifications page resets it to 0 after marking items read.
export const notificationUnreadAtom = atom(0);

// Refresh the unread count from the backend. Safe to call repeatedly; failures
// are swallowed (the badge is non-critical) so a transient error never breaks
// the surrounding UI.
export const refreshNotificationUnreadAtom = atom(null, async (_get, set) => {
  try {
    const count = await fetchUnreadCount();
    set(notificationUnreadAtom, count);
  } catch (e) {
    console.error("Failed to fetch unread notification count:", e);
  }
});
