import { NavLink } from 'react-router-dom';
import { useI18n } from '../../lib/i18n';

interface BottomNavProps {
  unreadNotifications?: number;
}

// SVG Icons
const GroupIcon = ({ active }: { active: boolean }) => (
  <svg className="w-6 h-6" fill={active ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
  </svg>
);

const MessageIcon = ({ active }: { active: boolean }) => (
  <svg className="w-6 h-6" fill={active ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
  </svg>
);

const UsersIcon = ({ active }: { active: boolean }) => (
  <svg className="w-6 h-6" fill={active ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
  </svg>
);

const BellIcon = ({ active }: { active: boolean }) => (
  <svg className="w-6 h-6" fill={active ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
  </svg>
);

export function BottomNav({ unreadNotifications = 0 }: BottomNavProps) {
  const { t } = useI18n();

  const navItems = [
    { to: '/', icon: GroupIcon, label: t('nav.groups') },
    { to: '/dm', icon: MessageIcon, label: t('nav.messages') },
    { to: '/members', icon: UsersIcon, label: t('nav.members') },
    { to: '/notifications', icon: BellIcon, label: t('nav.notifications'), badge: unreadNotifications },
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 h-14 bg-black border-t border-neutral-900 flex items-center justify-around z-50">
      {navItems.map(({ to, icon: Icon, label, badge }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `flex flex-col items-center justify-center p-2 relative ${
              isActive ? 'text-white' : 'text-neutral-500'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <span className="relative">
                <Icon active={isActive} />
                {badge && badge > 0 && (
                  <span className="absolute -top-1 -right-2 bg-blue-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                    {badge > 9 ? '9+' : badge}
                  </span>
                )}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
