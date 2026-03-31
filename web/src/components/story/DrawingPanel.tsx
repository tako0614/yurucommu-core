/**
 * Drawing Panel for Story Editor
 *
 * Controls drawing tool properties: color, brush width, and opacity.
 */

import { ColorPicker } from './ColorPicker.tsx';

interface DrawingPanelProps {
  color: string;
  width: number;
  opacity: number;
  onColorChange: (color: string) => void;
  onWidthChange: (width: number) => void;
  onOpacityChange: (opacity: number) => void;
  onClear: () => void;
  onUndo: () => void;
}

export function DrawingPanel(props: DrawingPanelProps) {
  return (
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="text-white font-medium">描画</h3>
        <div class="flex gap-2">
          <button
            onClick={props.onUndo}
            class="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-sm transition-colors"
          >
            戻す
          </button>
          <button
            onClick={props.onClear}
            class="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg text-sm transition-colors"
          >
            クリア
          </button>
        </div>
      </div>

      {/* Color */}
      <ColorPicker label="色" color={props.color} onChange={props.onColorChange} />

      {/* Width */}
      <div>
        <label class="text-neutral-400 text-sm">太さ: {props.width}px</label>
        <input
          type="range"
          min="2"
          max="50"
          value={props.width}
          onInput={(e) => props.onWidthChange(parseInt(e.currentTarget.value))}
          class="w-full mt-1 accent-blue-500"
        />
        {/* Width preview */}
        <div class="flex items-center justify-center h-12 mt-2 bg-neutral-800 rounded-lg">
          <div
            class="rounded-full"
            style={{
              width: `${props.width}px`,
              height: `${props.width}px`,
              "background-color": props.color,
              opacity: props.opacity,
            }}
          />
        </div>
      </div>

      {/* Opacity */}
      <div>
        <label class="text-neutral-400 text-sm">不透明度: {Math.round(props.opacity * 100)}%</label>
        <input
          type="range"
          min="10"
          max="100"
          value={props.opacity * 100}
          onInput={(e) => props.onOpacityChange(parseInt(e.currentTarget.value) / 100)}
          class="w-full mt-1 accent-blue-500"
        />
      </div>
    </div>
  );
}
