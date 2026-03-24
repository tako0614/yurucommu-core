import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';
import { RightSidebar } from './RightSidebar';

export function AppLayout() {
  return (
    <div className="flex justify-center h-screen bg-neutral-900 text-white">
      <Sidebar />
      <main className="flex-1 flex flex-col min-h-screen pb-14 md:pb-0 overflow-hidden border-x border-neutral-800 max-w-2xl">
        <Outlet />
      </main>
      <div className="hidden lg:block w-80 bg-neutral-900 shrink-0">
        <RightSidebar />
      </div>
      <BottomNav />
    </div>
  );
}
