import { NavLink } from 'react-router-dom';
import { Member } from '../../types';
import { useI18n, Language } from '../../lib/i18n';

interface SidebarProps {
  member: Member;
  unreadNotifications?: number;
}

// SVG Icons
const GroupIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
  </svg>
);

const MessageIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
  </svg>
);

const UsersIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
  </svg>
);

const BellIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
  </svg>
);

const LogoutIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
  </svg>
);

export function Sidebar({ member, unreadNotifications = 0 }: SidebarProps) {
  const { t, language, setLanguage } = useI18n();

  const toggleLanguage = () => {
    setLanguage(language === 'ja' ? 'en' : 'ja');
  };

  const navItems = [
    { to: '/', icon: GroupIcon, label: t('nav.groups') },
    { to: '/dm', icon: MessageIcon, label: t('nav.messages') },
    { to: '/members', icon: UsersIcon, label: t('nav.members') },
    { to: '/notifications', icon: BellIcon, label: t('nav.notifications'), badge: unreadNotifications },
  ];

  return (
    <aside className="hidden md:flex w-72 bg-black flex-col h-screen shrink-0">
      {/* Logo */}
      <div className="px-6 pt-8 pb-6">
        <h1 className="text-2xl font-bold text-white">Yurucommu</h1>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4">
        <div className="space-y-2">
          {navItems.map(({ to, icon: Icon, label, badge }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-4 px-4 py-3 rounded-full text-xl transition-colors ${
                  isActive
                    ? 'bg-neutral-900 text-white font-bold'
                    : 'text-neutral-400 hover:bg-neutral-900/50 hover:text-white'
                }`
              }
            >
              <Icon />
              <span className="flex-1">{label}</span>
              {badge && badge > 0 && (
                <span className="bg-blue-500 text-white text-xs font-bold px-2 py-0.5 rounded-full min-w-[20px] text-center">
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* Language & Logout */}
      <div className="px-4 pb-6 space-y-2">
        <button
          onClick={toggleLanguage}
          className="flex items-center gap-4 px-4 py-3 rounded-full text-xl text-neutral-400 hover:bg-neutral-900/50 hover:text-white transition-colors w-full"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
          </svg>
          <span>{language === 'ja' ? '日本語' : 'English'}</span>
        </button>
        <a
          href="/api/auth/logout"
          className="flex items-center gap-4 px-4 py-3 rounded-full text-xl text-neutral-400 hover:bg-neutral-900/50 hover:text-white transition-colors"
        >
          <LogoutIcon />
          <span>{t('nav.logout')}</span>
        </a>
      </div>
    </aside>
  );
}
