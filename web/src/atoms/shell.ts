import { atom } from "jotai";

// App-shell UI state that is global (not timeline-local) so any route can drive
// it. The AppMenu (account switcher / settings / bookmarks / language / logout
// / discover) and the post composer are mounted once in AppLayout, so their
// open state lives here rather than inside a single page.

// Whether the AppMenu drawer is open. Opened by the mobile header trigger.
export const appMenuOpenAtom = atom(false);
