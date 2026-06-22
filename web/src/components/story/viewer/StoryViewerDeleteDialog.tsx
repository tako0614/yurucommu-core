import { Show } from "solid-js";
import { useI18n } from "../../../lib/i18n.tsx";

interface StoryViewerDeleteDialogProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function StoryViewerDeleteDialog(props: StoryViewerDeleteDialogProps) {
  const { t } = useI18n();
  return (
    <Show when={props.open}>
      {/* Backdrop click cancels (Escape is handled by the viewer's gated
          keydown, which routes Escape here while this prompt is open). */}
      <div
        class="absolute inset-0 z-30 bg-black/80 flex items-center justify-center"
        onClick={props.onCancel}
      >
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="story-delete-title"
          aria-describedby="story-delete-desc"
          class="bg-neutral-800 rounded-2xl p-6 max-w-xs mx-4"
          onClick={(e) => e.stopPropagation()}
        >
          <h3
            id="story-delete-title"
            class="text-white font-semibold text-lg mb-2"
          >
            {t("story.deleteTitle")}
          </h3>
          <p id="story-delete-desc" class="text-neutral-400 text-sm mb-4">
            {t("story.deleteConfirm")}
          </p>
          <div class="flex gap-3">
            <button
              // Focus the non-destructive Cancel action when the prompt opens.
              ref={(el) => queueMicrotask(() => el.focus())}
              onClick={props.onCancel}
              class="flex-1 px-4 py-2 bg-neutral-700 hover:bg-neutral-600 rounded-lg text-white transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={props.onConfirm}
              class="flex-1 px-4 py-2 bg-red-500 hover:bg-red-600 rounded-lg text-white transition-colors"
            >
              {t("common.delete")}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
