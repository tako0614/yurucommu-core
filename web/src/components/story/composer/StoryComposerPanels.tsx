import { Show } from 'solid-js';
import { DrawingPanel, StickerPanel } from '../ToolPanel.tsx';

interface StoryComposerStickerPanelProps {
  open: boolean;
  onAddEmoji: (emoji: string) => void;
  onClose: () => void;
}

const CloseIcon = () => (
  <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

export function StoryComposerStickerPanel(props: StoryComposerStickerPanelProps) {
  return (
    <Show when={props.open}>
      <div
        class="absolute left-4 right-4 z-20 bg-neutral-900/95 backdrop-blur-sm rounded-2xl p-4 max-h-[40vh] overflow-y-auto"
        style={{ bottom: 'calc(max(env(safe-area-inset-bottom, 0px), 16px) + 130px)' }}
      >
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-white font-medium">スタンプ</h3>
          <button
            onClick={props.onClose}
            aria-label="Close"
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

export function StoryComposerDrawingPanel(props: StoryComposerDrawingPanelProps) {
  return (
    <Show when={props.isDrawing}>
      <div
        class="absolute left-20 z-20 bg-neutral-900/95 backdrop-blur-sm rounded-2xl p-4"
        style={{ bottom: 'calc(max(env(safe-area-inset-bottom, 0px), 16px) + 130px)' }}
      >
        <DrawingPanel
          color={props.drawingSettings.color}
          width={props.drawingSettings.width}
          opacity={props.drawingSettings.opacity}
          onColorChange={(color) => props.onDrawingSettingsChange({ ...props.drawingSettings, color })}
          onWidthChange={(width) => props.onDrawingSettingsChange({ ...props.drawingSettings, width })}
          onOpacityChange={(opacity) => props.onDrawingSettingsChange({ ...props.drawingSettings, opacity })}
          onClear={props.onClear}
          onUndo={props.onUndo}
        />
        <button
          onClick={props.onDone}
          class="mt-3 w-full py-2 bg-white/10 hover:bg-white/20 rounded-lg text-white text-sm transition-colors"
        >
          完了
        </button>
      </div>
    </Show>
  );
}

interface StoryComposerQuickActionsProps {
  uploading: boolean;
  hasVideo: boolean;
  isDrawing: boolean;
  onSelectImage: () => void;
  onSelectVideo: () => void;
  onToggleDraw: () => void;
}

const ImageIcon = () => (
  <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);

const VideoIcon = () => (
  <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
  </svg>
);

const DrawIcon = () => (
  <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
  </svg>
);

export function StoryComposerQuickActions(props: StoryComposerQuickActionsProps) {
  return (
    <div
      class="absolute left-4 z-10 flex gap-2"
      style={{ bottom: 'calc(max(env(safe-area-inset-bottom, 0px), 16px) + 130px)' }}
    >
      <button
        onClick={props.onSelectImage}
        disabled={props.uploading}
        class="p-3 bg-black/60 hover:bg-black/80 rounded-full text-white transition-colors"
      >
        <ImageIcon />
      </button>
      <button
        onClick={props.onSelectVideo}
        disabled={props.uploading}
        class={`p-3 rounded-full text-white transition-colors ${props.hasVideo ? 'bg-blue-500' : 'bg-black/60 hover:bg-black/80'}`}
      >
        <VideoIcon />
      </button>
      <button
        onClick={props.onToggleDraw}
        class={`p-3 rounded-full text-white transition-colors ${props.isDrawing ? 'bg-purple-500' : 'bg-black/60 hover:bg-black/80'}`}
      >
        <DrawIcon />
      </button>
    </div>
  );
}
