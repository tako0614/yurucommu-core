import { atom } from "jotai";
import { fetchDMContacts } from "../lib/api.ts";

// Shared, app-wide unread DM count. A single poller (mounted once in the app
// layout / nav) writes this; nav surfaces (Messages destination badge) read it.
// The total sums `unread_count` across both one-to-one DM contacts and joined
// community group chats, which is exactly what GET /dm/contacts returns.
export const dmUnreadCountAtom = atom(0);

// Refresh the unread DM total from the backend. Safe to call repeatedly;
// failures are swallowed (the badge is non-critical) so a transient error never
// breaks the surrounding UI.
export const refreshDmUnreadAtom = atom(null, async (_get, set) => {
  try {
    const data = await fetchDMContacts();
    const sum = (contacts: { unread_count?: number }[]) =>
      contacts.reduce((acc, c) => acc + (c.unread_count || 0), 0);
    const total = sum(data.mutual_followers) + sum(data.communities);
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
