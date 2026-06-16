import { For } from "solid-js";

interface PostSkeletonProps {
  /** Number of skeleton rows to render. Defaults to 5. */
  count?: number;
}

/**
 * Placeholder rows shown while a post list performs its initial load.
 * Mirrors the avatar + header + body + actions layout of a real post item
 * so the transition to loaded content stays visually stable.
 */
export function PostSkeleton(props: PostSkeletonProps) {
  const rows = () => Array.from({ length: props.count ?? 5 });
  return (
    <div aria-hidden="true">
      <For each={rows()}>
        {() => (
          <div class="flex gap-3 px-4 py-3 border-b border-neutral-900">
            <div class="w-12 h-12 rounded-full bg-neutral-800 animate-pulse shrink-0" />
            <div class="flex-1 min-w-0 space-y-2">
              <div class="flex items-center gap-2">
                <div class="h-3.5 w-28 rounded bg-neutral-800 animate-pulse" />
                <div class="h-3 w-20 rounded bg-neutral-800/70 animate-pulse" />
              </div>
              <div class="h-3.5 w-full rounded bg-neutral-800 animate-pulse" />
              <div class="h-3.5 w-4/5 rounded bg-neutral-800 animate-pulse" />
              <div class="flex items-center gap-6 pt-2">
                <div class="h-4 w-8 rounded bg-neutral-800/70 animate-pulse" />
                <div class="h-4 w-8 rounded bg-neutral-800/70 animate-pulse" />
                <div class="h-4 w-8 rounded bg-neutral-800/70 animate-pulse" />
              </div>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}

export default PostSkeleton;
