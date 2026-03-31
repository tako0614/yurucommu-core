import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { voteOnStory } from '../../../lib/api.ts';
import type { StoryOverlay } from '../../../types/index.ts';

// Validate URL for XSS protection - only allow http: and https: protocols
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

interface OverlayContainerSize {
  width: number;
  height: number;
}

export function renderStoryOverlay(
  overlay: StoryOverlay,
  containerSize: OverlayContainerSize,
  storyApId: string,
  votes?: { [key: number]: number },
  votesTotal?: number,
  userVote?: number,
  onVote?: (storyApId: string, optionIndex: number) => Promise<void>
) {
  const { position } = overlay;

  const left = position.x * containerSize.width - (position.width * containerSize.width) / 2;
  const top = position.y * containerSize.height - (position.height * containerSize.height) / 2;
  const width = position.width * containerSize.width;
  const height = position.height * containerSize.height;

  const style: JSX.CSSProperties = {
    position: 'absolute',
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
    display: 'flex',
    "flex-direction": 'column',
    "align-items": 'center',
    "justify-content": 'center',
  };

  if (overlay.type === 'Question' && overlay.name && overlay.oneOf) {
    const hasVotes = votesTotal && votesTotal > 0;
    const hasUserVoted = userVote !== undefined && userVote !== null;

    return (
      <div style={style}>
        <div class="bg-black/60 backdrop-blur-sm rounded-xl p-3 w-full">
          <p class="text-white text-sm font-medium text-center mb-2">{overlay.name}</p>
          <div class="flex gap-2">
            <For each={overlay.oneOf}>
              {(option, optionIndex) => {
                const voteCount = votes?.[optionIndex()] || 0;
                const percentage = hasVotes && votesTotal ? Math.round((voteCount / votesTotal) * 100) : 0;
                const isSelected = userVote === optionIndex();

                return (
                  <button
                    class={`flex-1 relative overflow-hidden text-white text-sm py-2 px-3 rounded-lg transition-colors ${isSelected ? 'ring-2 ring-white' : ''} ${hasUserVoted ? 'cursor-default' : 'hover:bg-white/30'}`}
                    style={{ "background-color": 'rgba(255,255,255,0.2)' }}
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (hasUserVoted) return;
                      try {
                        if (onVote) {
                          await onVote(storyApId, optionIndex());
                        } else {
                          await voteOnStory(storyApId, optionIndex());
                        }
                      } catch (err) {
                        console.error('Failed to vote:', err);
                      }
                    }}
                    disabled={hasUserVoted ?? undefined}
                  >
                    <Show when={hasVotes}>
                      <div
                        class="absolute inset-0 bg-white/20 transition-all"
                        style={{ width: `${percentage}%` }}
                      />
                    </Show>
                    <span class="relative z-10 flex items-center justify-between">
                      <span>{option.name}</span>
                      <Show when={hasVotes}>
                        <span class="text-xs ml-2">{percentage}%</span>
                      </Show>
                    </span>
                  </button>
                );
              }}
            </For>
          </div>
          <Show when={hasVotes}>
            <p class="text-white/60 text-xs text-center mt-2">{votesTotal}票</p>
          </Show>
        </div>
      </div>
    );
  }

  if (overlay.type === 'Note' && overlay.name) {
    return (
      <div style={style}>
        <p class="text-white text-lg font-medium drop-shadow-lg bg-black/30 px-4 py-2 rounded-lg text-center">
          {overlay.name}
        </p>
      </div>
    );
  }

  if (overlay.type === 'Link' && (overlay as unknown as { href?: string }).href) {
    const linkOverlay = overlay as unknown as { href: string; name?: string };

    if (!isValidUrl(linkOverlay.href)) {
      return null;
    }

    return (
      <div style={style}>
        <a
          href={linkOverlay.href}
          target="_blank"
          rel="noopener noreferrer"
          class="bg-white text-black text-sm font-medium px-4 py-2 rounded-full hover:bg-neutral-200 transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          {linkOverlay.name || 'リンクを開く'}
        </a>
      </div>
    );
  }

  return null;
}
