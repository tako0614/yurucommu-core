import { Link } from 'react-router-dom';
import type { Actor, Community } from '../../types';
import { UserAvatar } from '../UserAvatar';
import { HeartIcon } from '../icons/SocialIcons';

interface TimelineHeaderProps {
  actor: Actor;
  communities: Community[];
  activeTab: string;
  onTabChange: (tab: string) => void;
  onOpenMenu: () => void;
  title: string;
  followingLabel: string;
}

export function TimelineHeader({
  actor,
  communities,
  activeTab,
  onTabChange,
  onOpenMenu,
  title,
  followingLabel,
}: TimelineHeaderProps) {
  return (
    <header className="sticky top-0 bg-black/80 backdrop-blur-sm border-b border-neutral-900 z-10">
      <div className="flex items-center justify-between px-4 py-3">
        {/* Mobile: User avatar button that opens menu */}
        <button onClick={onOpenMenu} aria-label="Open menu" className="md:hidden">
          <UserAvatar avatarUrl={actor.icon_url} name={actor.name || actor.username} size={32} />
        </button>
        {/* Desktop: Show text title */}
        <h1 className="hidden md:block text-xl font-bold">{title}</h1>
        {/* Mobile: Notification heart icon */}
        <Link
          to="/notifications"
          aria-label="Notifications"
          className="md:hidden p-2 text-white hover:text-pink-500 transition-colors"
        >
          <HeartIcon filled={false} />
        </Link>
      </div>
      <div className="flex overflow-x-auto scrollbar-hide border-b border-neutral-900">
        <button
          onClick={() => onTabChange('following')}
          className={`px-4 py-3 text-sm font-medium whitespace-nowrap relative transition-colors ${
            activeTab === 'following' ? 'text-white' : 'text-neutral-500 hover:bg-neutral-900/50'
          }`}
        >
          {followingLabel}
          {activeTab === 'following' && (
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-1 bg-blue-500 rounded-full" />
          )}
        </button>
        {communities.map((community) => (
          <button
            key={community.ap_id}
            onClick={() => onTabChange(community.ap_id)}
            className={`px-4 py-3 text-sm font-medium whitespace-nowrap relative transition-colors ${
              activeTab === community.ap_id ? 'text-white' : 'text-neutral-500 hover:bg-neutral-900/50'
            }`}
          >
            {community.name}
            {activeTab === community.ap_id && (
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-1 bg-blue-500 rounded-full" />
            )}
          </button>
        ))}
      </div>
    </header>
  );
}
