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

export function DrawingPanel({
  color,
  width,
  opacity,
  onColorChange,
  onWidthChange,
  onOpacityChange,
  onClear,
  onUndo,
}: DrawingPanelProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-medium">描画</h3>
        <div className="flex gap-2">
          <button
            onClick={onUndo}
            className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-sm transition-colors"
          >
            戻す
          </button>
          <button
            onClick={onClear}
            className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg text-sm transition-colors"
          >
            クリア
          </button>
        </div>
      </div>

      {/* Color */}
      <ColorPicker label="色" color={color} onChange={onColorChange} />

      {/* Width */}
      <div>
        <label className="text-neutral-400 text-sm">太さ: {width}px</label>
        <input
          type="range"
          min="2"
          max="50"
          value={width}
          onChange={(e) => onWidthChange(parseInt(e.target.value))}
          className="w-full mt-1 accent-blue-500"
        />
        {/* Width preview */}
        <div className="flex items-center justify-center h-12 mt-2 bg-neutral-800 rounded-lg">
          <div
            className="rounded-full"
            style={{
              width: width,
              height: width,
              backgroundColor: color,
              opacity: opacity,
            }}
          />
        </div>
      </div>

      {/* Opacity */}
      <div>
        <label className="text-neutral-400 text-sm">不透明度: {Math.round(opacity * 100)}%</label>
        <input
          type="range"
          min="10"
          max="100"
          value={opacity * 100}
          onChange={(e) => onOpacityChange(parseInt(e.target.value) / 100)}
          className="w-full mt-1 accent-blue-500"
        />
      </div>
    </div>
  );
}
