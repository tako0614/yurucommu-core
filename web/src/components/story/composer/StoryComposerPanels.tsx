import { Show } from "solid-js";
import { DrawingPanel } from "../DrawingPanel.tsx";
import { StickerPanel } from "../StickerPanel.tsx";
import { useI18n } from "../../../lib/i18n.tsx";

interface StoryComposerStickerPanelProps {
  open: boolean;
  onAddEmoji: (emoji: string) => void;
  onClose: () => void;
}

const CloseIcon = () => (
  <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M6 18L18 6M6 6l12 12"
    />
  </svg>
);

export function StoryComposerStickerPanel(
  props: StoryComposerStickerPanelProps,
) {
  const { t } = useI18n();
  return (
    <Show when={props.open}>
      <div
        class="absolute left-4 right-4 z-20 bg-neutral-900/95 backdrop-blur-sm rounded-2xl p-4 max-h-[40vh] overflow-y-auto"
        style={{
          bottom: "calc(max(env(safe-area-inset-bottom, 0px), 16px) + 130px)",
        }}
      >
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-white font-medium">{t("story.stamp")}</h3>
          <button
            onClick={props.onClose}
            aria-label={t("common.close")}
            class="text-white/60 hover:text-white p-1"
          >
            <CloseIcon />
          </button>
        </div>
        <StickerPanel onAddEmoji={props.onAddEmoji} />
      </div>
    </Show>
  );
}

interface DrawingSettings {
  color: string;
  width: number;
  opacity: number;
}

interface StoryComposerDrawingPanelProps {
  isDrawing: boolean;
  drawingSettings: DrawingSettings;
  onDrawingSettingsChange: (next: DrawingSettings) => void;
  onClear: () => void;
  onUndo: () => void;
  onDone: () => void;
}

export function StoryComposerDrawingPanel(
  props: StoryComposerDrawingPanelProps,
) {
  const { t } = useI18n();
  return (
    <Show when={props.isDrawing}>
      <div
        class="absolute left-20 z-20 bg-neutral-900/95 backdrop-blur-sm rounded-2xl p-4"
        style={{
          bottom: "calc(max(env(safe-area-inset-bottom, 0px), 16px) + 130px)",
        }}
      >
        <DrawingPanel
          color={props.drawingSettings.color}
          width={props.drawingSettings.width}
          opacity={props.drawingSettings.opacity}
          onColorChange={(color) =>
            props.onDrawingSettingsChange({ ...props.drawingSettings, color })
          }
          onWidthChange={(width) =>
            props.onDrawingSettingsChange({ ...props.drawingSettings, width })
          }
          onOpacityChange={(opacity) =>
            props.onDrawingSettingsChange({
              ...props.drawingSettings,
              opacity,
            })
          }
          onClear={props.onClear}
          onUndo={props.onUndo}
        />
        <button
          onClick={props.onDone}
          class="mt-3 w-full py-2 bg-white/10 hover:bg-white/20 rounded-lg text-white text-sm transition-colors"
        >
          {t("story.done")}
        </button>
      </div>
    </Show>
  );
}
