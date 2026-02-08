import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Actor } from '../../types';
import type { HostedInstance } from '../../hooks/useAuth';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';
import { HostedInstanceSwitcherModal } from './HostedInstanceSwitcherModal';

interface AppLayoutProps {
  actor: Actor;
  isHosted?: boolean;
  instances?: HostedInstance[];
  currentInstanceId?: string | null;
  onSelectInstance?: (instanceId: string) => Promise<void> | void;
  onCreateInstance?: (username: string) => Promise<boolean>;
  onRebuildInstance?: (instanceId: string) => Promise<boolean> | void;
}

export function AppLayout({
  actor,
  isHosted,
  instances = [],
  currentInstanceId = null,
  onSelectInstance,
  onCreateInstance,
  onRebuildInstance,
}: AppLayoutProps) {
  const [showInstanceSwitcher, setShowInstanceSwitcher] = useState(false);

  const hasInstanceSwitcher =
    !!isHosted &&
    instances.length > 0 &&
    !!onSelectInstance &&
    !!onCreateInstance &&
    !!onRebuildInstance;

  const currentInstance =
    instances.find((instance) => instance.id === currentInstanceId) || instances[0] || null;

  return (
    <div className="flex justify-center h-screen bg-black text-white">
      <Sidebar
        actor={actor}
        currentInstance={currentInstance}
        showInstanceSwitcher={hasInstanceSwitcher}
        onOpenInstanceSwitcher={() => setShowInstanceSwitcher(true)}
      />
      <main className="flex-1 flex flex-col min-h-screen pb-14 md:pb-0 overflow-hidden border-x border-neutral-900 max-w-2xl">
        <Outlet />
      </main>
      <div className="hidden lg:block w-80 bg-black shrink-0" />
      <BottomNav
        showInstanceSwitcherButton={hasInstanceSwitcher}
        onOpenInstanceSwitcher={() => setShowInstanceSwitcher(true)}
      />
      {hasInstanceSwitcher && currentInstance && onSelectInstance && onCreateInstance && onRebuildInstance && (
        <HostedInstanceSwitcherModal
          isOpen={showInstanceSwitcher}
          onClose={() => setShowInstanceSwitcher(false)}
          instances={instances}
          currentInstanceId={currentInstance.id}
          onSelectInstance={onSelectInstance}
          onCreateInstance={onCreateInstance}
          onRebuildInstance={onRebuildInstance}
        />
      )}
    </div>
  );
}
