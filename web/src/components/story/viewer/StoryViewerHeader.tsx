import { Show } from 'solid-js';
import { UserAvatar } from '../../UserAvatar.tsx';
import { CloseIcon, MutedIcon, TrashIcon, UnmutedIcon } from './StoryViewerIcons.tsx';

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

export function StoryViewerHeader(props: StoryViewerHeaderProps) {
  return (
    <div class="absolute top-4 left-0 right-0 z-20 px-4 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <UserAvatar
          avatarUrl={props.actor.icon_url}
          name={props.actor.name || props.actor.preferred_username}
          size={32}
        />
        <div>
          <p class="text-white text-sm font-medium">
            {props.actor.name || props.actor.preferred_username}
          </p>
          <p class="text-neutral-400 text-xs">
            {props.timeLabel}
          </p>
        </div>
      </div>
      <div class="flex items-center gap-1">
        <Show when={props.isVideo}>
          <button
            onClick={props.onToggleMute}
            aria-label={props.isMuted ? "Unmute video" : "Mute video"}
            class="p-2 text-white hover:bg-white/10 rounded-full transition-colors"
          >
            {props.isMuted ? <MutedIcon /> : <UnmutedIcon />}
          </button>
        </Show>
        <Show when={props.isOwnStory}>
          <button
            onClick={props.onDelete}
            aria-label="Delete story"
            class="p-2 text-white hover:bg-white/10 rounded-full transition-colors"
          >
            <TrashIcon />
          </button>
        </Show>
        <button
          onClick={props.onClose}
          aria-label="Close"
          class="p-2 text-white hover:bg-white/10 rounded-full transition-colors"
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}
