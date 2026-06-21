import { atom } from "jotai";
import { fetchDMUnreadCount } from "../lib/api.ts";

// Shared, app-wide unread DM count. A single poller (mounted once in the app
// layout / nav) writes this; nav surfaces (Messages destination badge) read it.
// The total sums unread across both one-to-one DM contacts and joined community
// group chats — the same total GET /dm/contacts would yield, but read from the
// lightweight GET /dm/unread/count endpoint (a backend parity test pins the two
// together) so the 30s badge poll does not refetch the whole contacts list with
// actor enrichment + last-message previews on every tick.
export const dmUnreadCountAtom = atom(0);

// Refresh the unread DM total from the backend. Safe to call repeatedly;
// failures are swallowed (the badge is non-critical) so a transient error never
// breaks the surrounding UI.
export const refreshDmUnreadAtom = atom(null, async (_get, set) => {
  try {
    const { total } = await fetchDMUnreadCount();
    set(dmUnreadCountAtom, total);
  } catch (e) {
    console.error("Failed to fetch unread DM count:", e);
  }
});

// Locally clear the badge (e.g. after a conversation is read) without waiting
// for the next poll.
export const clearDmUnreadAtom = atom(null, (_get, set) => {
  set(dmUnreadCountAtom, 0);
});
