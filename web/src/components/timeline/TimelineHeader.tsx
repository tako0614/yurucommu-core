import { Link } from 'react-router-dom';
import { HeartIcon } from '../icons/SocialIcons.tsx';

interface TimelineHeaderProps {
  onCreatePost: () => void;
  title: string;
}

export function TimelineHeader({
  onCreatePost,
  title,
}: TimelineHeaderProps) {
  return (
    <header className="sticky top-0 bg-neutral-900/80 backdrop-blur-sm z-10">
      <div className="flex items-center justify-between px-4 py-4">
        {/* Mobile: Create post button */}
        <button
          onClick={onCreatePost}
          aria-label="Create post"
          className="md:hidden p-2 text-white hover:text-neutral-400 transition-colors"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
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
    </header>
  );
}
