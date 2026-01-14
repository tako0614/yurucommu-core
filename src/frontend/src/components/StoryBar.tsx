import { ActorStories, Actor } from '../types';
import { UserAvatar } from './UserAvatar';

interface StoryBarProps {
  actor: Actor;
  actorStories: ActorStories[];
  loading?: boolean;
  onStoryClick: (actorStories: ActorStories, index: number) => void;
  onAddStory: () => void;
}

const PlusIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
  </svg>
);

export function StoryBar({ actor, actorStories, loading = false, onStoryClick, onAddStory }: StoryBarProps) {

  // Check if current user has any stories
  const myStories = actorStories.find(as => as.actor.ap_id === actor.ap_id);
  const hasMyStories = myStories && myStories.stories.length > 0;

  // Other users' stories (excluding self)
  const otherStories = actorStories.filter(as => as.actor.ap_id !== actor.ap_id);

  if (loading) {
    return (
      <div className="px-4 py-3 border-b border-neutral-900">
        <div className="flex gap-4 overflow-x-auto scrollbar-hide">
          <div className="flex flex-col items-center gap-1 flex-shrink-0">
            <div className="w-16 h-16 rounded-full bg-neutral-800 animate-pulse" />
            <div className="w-12 h-3 bg-neutral-800 rounded animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  // If no stories and user can add one, show just the add button
  if (actorStories.length === 0 && !hasMyStories) {
    return (
      <div className="px-4 py-3 border-b border-neutral-900">
        <div className="flex gap-4 overflow-x-auto scrollbar-hide">
          <button
            onClick={onAddStory}
            className="flex flex-col items-center gap-1 flex-shrink-0 group"
          >
            <div className="relative">
              <div className="w-16 h-16 rounded-full ring-2 ring-neutral-700 flex items-center justify-center">
                <UserAvatar avatarUrl={actor.icon_url} name={actor.name || actor.username} size={60} />
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center ring-2 ring-black">
                <PlusIcon />
              </div>
            </div>
            <span className="text-xs text-neutral-400 max-w-16 truncate">
              Your story
            </span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 border-b border-neutral-900">
      <div className="flex gap-4 overflow-x-auto scrollbar-hide">
        {/* Add story button (always first) */}
        <button
          onClick={hasMyStories ? () => onStoryClick(myStories!, 0) : onAddStory}
          className="flex flex-col items-center gap-1 flex-shrink-0 group"
        >
          <div className="relative">
            <div className={`w-16 h-16 rounded-full p-0.5 ${
              hasMyStories
                ? (myStories!.has_unviewed ? 'bg-gradient-to-tr from-yellow-500 to-pink-500' : 'bg-neutral-600')
                : 'ring-2 ring-neutral-700'
            }`}>
              <div className="w-full h-full rounded-full bg-black p-0.5">
                <UserAvatar avatarUrl={actor.icon_url} name={actor.name || actor.username} size={56} />
              </div>
            </div>
            {!hasMyStories && (
              <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center ring-2 ring-black">
                <PlusIcon />
              </div>
            )}
          </div>
          <span className="text-xs text-neutral-400 max-w-16 truncate">
            {hasMyStories ? 'Your story' : 'Add story'}
          </span>
        </button>

        {/* Other users' stories */}
        {otherStories.map((as, idx) => (
          <button
            key={as.actor.ap_id}
            onClick={() => onStoryClick(as, idx)}
            className="flex flex-col items-center gap-1 flex-shrink-0 group"
          >
            <div className={`w-16 h-16 rounded-full p-0.5 ${
              as.has_unviewed
                ? 'bg-gradient-to-tr from-yellow-500 to-pink-500'
                : 'bg-neutral-600'
            }`}>
              <div className="w-full h-full rounded-full bg-black p-0.5">
                <UserAvatar
                  avatarUrl={as.actor.icon_url}
                  name={as.actor.name || as.actor.preferred_username}
                  size={56}
                />
              </div>
            </div>
            <span className="text-xs text-neutral-400 max-w-16 truncate">
              {as.actor.name || as.actor.preferred_username}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
