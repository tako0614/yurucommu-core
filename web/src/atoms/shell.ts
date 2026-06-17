import { atom } from "jotai";

// App-shell UI state that is global (not timeline-local) so any route can drive
// it. The AppMenu (account switcher / settings / bookmarks / language / logout
// / discover) and the post composer are mounted once in AppLayout, so their
// open state lives here rather than inside a single page.

// Whether the AppMenu drawer is open. Opened by the mobile header trigger and
// the desktop Sidebar account block.
export const appMenuOpenAtom = atom(false);

// Whether the global "create a community" composer (CreateScopeModal) is open.
// Lives at shell level so the desktop Sidebar, the composer's scope switcher and
// the first-feed empty state can all open the same layout-mounted modal instead
// of each owning a private copy.
export const createScopeOpenAtom = atom(false);
