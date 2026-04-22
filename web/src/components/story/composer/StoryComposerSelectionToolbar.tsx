import { Show } from "solid-js";
import type { Layer } from "../../../lib/story-canvas.ts";

interface StoryComposerSelectionToolbarProps {
  selectedLayer: Layer | null;
  onEditText: (layerId: string) => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onDelete: () => void;
}

export function StoryComposerSelectionToolbar(
  props: StoryComposerSelectionToolbarProps,
) {
  return (
    <Show
      when={props.selectedLayer && props.selectedLayer.type !== "background"}
    >
      <div class="absolute top-1/2 left-4 z-10 -translate-y-1/2 flex flex-col gap-2 bg-black/70 backdrop-blur-sm rounded-2xl p-2 shadow-lg">
        <Show when={props.selectedLayer!.type === "text"}>
          <button
            onClick={() => props.onEditText(props.selectedLayer!.id)}
            class="p-3 text-white hover:bg-white/20 rounded-xl transition-colors"
            title="編集"
          >
            <svg
              class="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
          </button>
        </Show>
        <button
          onClick={props.onBringToFront}
          class="p-3 text-white hover:bg-white/20 rounded-xl transition-colors"
          title="前面へ"
        >
          <svg
            class="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width={2}
              d="M5 15l7-7 7 7"
            />
          </svg>
        </button>
        <button
          onClick={props.onSendToBack}
          class="p-3 text-white hover:bg-white/20 rounded-xl transition-colors"
          title="背面へ"
        >
          <svg
            class="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>
        <button
          onClick={props.onDelete}
          class="p-3 text-red-400 hover:bg-red-500/20 rounded-xl transition-colors"
          title="削除"
        >
          <svg
            class="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </button>
      </div>
    </Show>
  );
}
