import { Outlet } from 'react-router-dom';
import { Member } from '../../types';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';

interface AppLayoutProps {
  member: Member;
  unreadNotifications?: number;
}

export function AppLayout({ member, unreadNotifications = 0 }: AppLayoutProps) {
  return (
    <div className="flex justify-center h-screen bg-black text-white">
      {/* Desktop Sidebar */}
      <Sidebar member={member} unreadNotifications={unreadNotifications} />

      {/* Main Content - centered */}
      <main className="flex-1 flex flex-col min-h-screen pb-14 md:pb-0 overflow-hidden border-x border-neutral-900 max-w-2xl">
        <Outlet />
      </main>

      {/* Right sidebar space (optional, for future use) */}
      <div className="hidden lg:block w-80 bg-black shrink-0" />

      {/* Mobile Bottom Nav */}
      <BottomNav unreadNotifications={unreadNotifications} />
    </div>
  );
}
