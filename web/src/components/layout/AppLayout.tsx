import type { JSX } from "solid-js";
import { Sidebar } from "./Sidebar.tsx";
import { BottomNav } from "./BottomNav.tsx";
import { RightSidebar } from "./RightSidebar.tsx";

export function AppLayout(props: { children?: JSX.Element }) {
  return (
    <div class="flex justify-center h-screen bg-neutral-900 text-white">
      <Sidebar />
      <main class="flex-1 flex flex-col min-h-screen pb-14 md:pb-0 overflow-hidden border-x border-neutral-800 max-w-2xl">
        {props.children}
      </main>
      <div class="hidden lg:block w-80 bg-neutral-900 shrink-0">
        <RightSidebar />
      </div>
      <BottomNav />
    </div>
  );
}
