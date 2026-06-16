import { onMount, type JSX } from "solid-js";
import { useSetAtom } from "solid-jotai";
import { Sidebar } from "./Sidebar.tsx";
import { BottomNav } from "./BottomNav.tsx";
import { RightSidebar } from "./RightSidebar.tsx";
import { AppHeaderMobile } from "./AppHeaderMobile.tsx";
import { AppMenu } from "./AppMenu.tsx";
import { GlobalPostComposer } from "./GlobalPostComposer.tsx";
import { ToastLayer } from "../ToastLayer.tsx";
import { useNotificationPolling } from "../../hooks/useNotificationPolling.ts";
import { hydrateScopeAtom } from "../../atoms/scope.ts";

export function AppLayout(props: { children?: JSX.Element }) {
  // Single mount point for unread-notification polling (pauses when hidden).
  useNotificationPolling();

  // Hydrate the inhabited-scope rail once per authenticated shell: reconcile the
  // stored scope against live membership and populate the ScopeBar / switcher
  // source. Runs here (not per-page) so the rail is ready on first paint.
  const hydrateScope = useSetAtom(hydrateScopeAtom);
  onMount(() => {
    void hydrateScope();
  });

  return (
    <div class="flex justify-center h-screen bg-neutral-900 text-white">
      <Sidebar />
      <main class="flex-1 flex flex-col min-h-screen pb-14 md:pb-0 overflow-hidden border-x border-neutral-800 max-w-2xl">
        {/* Mobile-only app-shell header: AppMenu trigger + DM + Notifications,
            reachable from every route. Phase B's ScopeHeader absorbs it. */}
        <AppHeaderMobile />
        {props.children}
      </main>
      <div class="hidden lg:block w-80 bg-neutral-900 shrink-0">
        <RightSidebar />
      </div>
      <BottomNav />
      {/* App-shell overlays mounted once so they work from any route. */}
      <AppMenu />
      <GlobalPostComposer />
      <ToastLayer />
    </div>
  );
}
