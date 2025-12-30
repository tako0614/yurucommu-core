import React from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

interface LayoutProps {
  notificationCount?: number;
}

export function Layout({ notificationCount }: LayoutProps) {
  return (
    <div className="app">
      <Sidebar notificationCount={notificationCount} />
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
