import { JSX, Show } from "solid-js";

interface EmptyStateProps {
  /** Decorative icon shown above the text. */
  icon: JSX.Element;
  /** Primary localized message. */
  title: string;
  /** Optional secondary localized hint. */
  hint?: string;
}

/**
 * Shared empty-state block: a muted circular icon, a primary message and an
 * optional hint. Used by the primary list views (timeline, notifications,
 * search, bookmarks) so empty states look consistent.
 */
export function EmptyState(props: EmptyStateProps) {
  return (
    <div class="flex flex-col items-center justify-center p-8 text-center min-h-[40vh]">
      <div class="w-20 h-20 mb-4 rounded-full bg-neutral-800 flex items-center justify-center text-neutral-500">
        {props.icon}
      </div>
      <p class="text-neutral-400 text-lg font-medium">{props.title}</p>
      <Show when={props.hint}>
        <p class="text-neutral-500 text-sm mt-2">{props.hint}</p>
      </Show>
    </div>
  );
}

export default EmptyState;
