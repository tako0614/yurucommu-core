import { UserAvatar } from '../../UserAvatar';
import { CloseIcon, MutedIcon, TrashIcon, UnmutedIcon } from './StoryViewerIcons';

interface StoryViewerHeaderProps {
  actor: { icon_url: string | null; name: string | null; preferred_username: string };
  timeLabel: string;
  isVideo: boolean;
  isMuted: boolean;
  isOwnStory: boolean;
  onToggleMute: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function StoryViewerHeader({
  actor,
  timeLabel,
  isVideo,
  isMuted,
  isOwnStory,
  onToggleMute,
  onDelete,
  onClose,
}: StoryViewerHeaderProps) {
  return (
    <div className="absolute top-4 left-0 right-0 z-20 px-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <UserAvatar
          avatarUrl={actor.icon_url}
          name={actor.name || actor.preferred_username}
          size={32}
        />
        <div>
          <p className="text-white text-sm font-medium">
            {actor.name || actor.preferred_username}
          </p>
          <p className="text-neutral-400 text-xs">
            {timeLabel}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {isVideo && (
          <button
            onClick={onToggleMute}
            aria-label={isMuted ? "Unmute video" : "Mute video"}
            className="p-2 text-white hover:bg-white/10 rounded-full transition-colors"
          >
            {isMuted ? <MutedIcon /> : <UnmutedIcon />}
          </button>
        )}
        {isOwnStory && (
          <button
            onClick={onDelete}
            aria-label="Delete story"
            className="p-2 text-white hover:bg-white/10 rounded-full transition-colors"
          >
            <TrashIcon />
          </button>
        )}
        <button
          onClick={onClose}
          aria-label="Close"
          className="p-2 text-white hover:bg-white/10 rounded-full transition-colors"
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}
