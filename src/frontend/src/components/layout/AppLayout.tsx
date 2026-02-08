import { Outlet } from 'react-router-dom';
import { Actor } from '../../types';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';

interface AppLayoutProps {
  actor: Actor;
}

export function AppLayout({ actor }: AppLayoutProps) {
  return (
    <div className="flex justify-center h-screen bg-black text-white">
      <Sidebar actor={actor} />
      <main className="flex-1 flex flex-col min-h-screen pb-14 md:pb-0 overflow-hidden border-x border-neutral-900 max-w-2xl">
        <Outlet />
      </main>
      <div className="hidden lg:block w-80 bg-black shrink-0" />
      <BottomNav />
    </div>
  );
}
