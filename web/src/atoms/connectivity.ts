import { atom } from "jotai";

/**
 * Tracks browser online/offline connectivity.
 *
 * Seeded from `navigator.onLine` and kept in sync with the window
 * `online` / `offline` events. SSR / initial-render safe: if `navigator`
 * is undefined (e.g. server-side or pre-hydration), it defaults to `true`
 * so the UI does not flash an offline state before the browser is ready.
 *
 * An OfflineBanner component consumes this atom; it is otherwise
 * self-contained and has no other dependencies.
 */

const getInitialOnline = (): boolean => {
  if (typeof navigator === "undefined") return true;
  // navigator.onLine can be undefined in some non-browser environments.
  return navigator.onLine ?? true;
};

const baseOnlineAtom = atom<boolean>(getInitialOnline());

baseOnlineAtom.onMount = (set) => {
  if (typeof window === "undefined") return;

  const handleOnline = () => set(true);
  const handleOffline = () => set(false);

  // Re-sync on mount in case connectivity changed before subscription.
  set(getInitialOnline());

  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);

  return () => {
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
  };
};

export const isOnlineAtom = atom((get) => get(baseOnlineAtom));
