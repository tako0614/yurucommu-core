import React from 'react';
import { NavLink } from 'react-router-dom';
import { Avatar } from '../common';
import { useAuthStore } from '../../stores/authStore';

interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}

function NavItem({ to, icon, label, badge }: NavItemProps) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => `
        flex items-center gap-3 px-4 py-3 rounded-lg
        transition-colors
        ${isActive
          ? 'bg-blue-50 text-blue-600'
          : 'text-gray-700 hover:bg-gray-100'
        }
      `}
    >
      <span className="w-6 h-6">{icon}</span>
      <span className="font-medium">{label}</span>
      {badge && badge > 0 && (
        <span className="ml-auto bg-red-500 text-white text-xs font-medium px-2 py-0.5 rounded-full">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </NavLink>
  );
}

// Icons
const HomeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);

const BellIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 01-3.46 0" />
  </svg>
);

const UserIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const SettingsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
  </svg>
);

const LogoutIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

interface SidebarProps {
  notificationCount?: number;
}

export function Sidebar({ notificationCount = 0 }: SidebarProps) {
  const { user, logout } = useAuthStore();

  const handleLogout = async () => {
    await logout();
    window.location.href = '/login';
  };

  return (
    <aside className="w-64 h-screen bg-white border-r border-gray-200 flex flex-col">
      {/* Logo */}
      <div className="p-4 border-b border-gray-200">
        <h1 className="text-xl font-bold text-gray-900">yurucommu</h1>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        <NavItem to="/" icon={<HomeIcon />} label="Home" />
        <NavItem
          to="/notifications"
          icon={<BellIcon />}
          label="Notifications"
          badge={notificationCount}
        />
        <NavItem to="/profile" icon={<UserIcon />} label="Profile" />
        <NavItem to="/settings" icon={<SettingsIcon />} label="Settings" />
      </nav>

      {/* User */}
      {user && (
        <div className="p-4 border-t border-gray-200">
          <div className="flex items-center gap-3 mb-3">
            <Avatar
              src={user.avatar_url}
              alt={user.display_name}
              size="md"
            />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900 truncate">
                {user.display_name}
              </p>
              <p className="text-sm text-gray-500 truncate">
                @{user.username}
              </p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 w-full px-3 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <span className="w-5 h-5"><LogoutIcon /></span>
            <span>Sign Out</span>
          </button>
        </div>
      )}
    </aside>
  );
}
