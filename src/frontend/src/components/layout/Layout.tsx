import React from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

interface LayoutProps {
  notificationCount?: number;
}

export function Layout({ notificationCount }: LayoutProps) {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar notificationCount={notificationCount} />
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
