import { For } from 'solid-js';

interface StoryViewerProgressProps {
  totalStories: number;
  storyIndex: number;
  progress: number;
}

export function StoryViewerProgress(props: StoryViewerProgressProps) {
  return (
    <div class="absolute top-0 left-0 right-0 z-20 px-2 pt-2 flex gap-1">
      <For each={Array.from({ length: props.totalStories })}>
        {(_, idx) => (
          <div class="flex-1 h-0.5 bg-neutral-700 rounded-full overflow-hidden">
            <div
              class="h-full bg-white transition-all duration-100"
              style={{
                width: idx() < props.storyIndex
                  ? '100%'
                  : idx() === props.storyIndex
                    ? `${props.progress}%`
                    : '0%',
              }}
            />
          </div>
        )}
      </For>
    </div>
  );
}
