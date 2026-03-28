/**
 * Media Panel for Story Editor
 *
 * Controls image layer properties: filter presets, manual adjustments
 * (brightness, contrast, saturation), and opacity.
 */

import { FILTER_PRESETS, MediaLayer } from '../../lib/story-canvas';
import { TrashIcon, LayerUpIcon, LayerDownIcon } from './ToolPanelIcons';

interface MediaPanelProps {
  layer: MediaLayer;
  onUpdate: (updates: Partial<MediaLayer>) => void;
  onDelete: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
}

export function MediaPanel({
  layer,
  onUpdate,
  onDelete,
  onBringToFront,
  onSendToBack,
}: MediaPanelProps) {
  const currentFilter = layer.filter || FILTER_PRESETS[0].filter;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-medium">画像</h3>
        <div className="flex gap-1">
          <button
            onClick={onBringToFront}
            className="p-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors"
            title="前面へ"
          >
            <LayerUpIcon />
          </button>
          <button
            onClick={onSendToBack}
            className="p-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors"
            title="背面へ"
          >
            <LayerDownIcon />
          </button>
          <button
            onClick={onDelete}
            className="p-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors"
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      {/* Filter presets */}
      <div>
        <label className="text-neutral-400 text-sm">フィルター</label>
        <div className="grid grid-cols-4 gap-2 mt-2">
          {FILTER_PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => onUpdate({ filter: preset.filter })}
              className={`p-2 rounded-lg text-xs transition-colors ${
                JSON.stringify(currentFilter) === JSON.stringify(preset.filter)
                  ? 'bg-blue-500 text-white'
                  : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
              }`}
            >
              {preset.name}
            </button>
          ))}
        </div>
      </div>

      {/* Manual adjustments */}
      <div className="space-y-3">
        <div>
          <label className="text-neutral-500 text-xs">明るさ: {currentFilter.brightness}%</label>
          <input
            type="range"
            min="0"
            max="200"
            value={currentFilter.brightness}
            onChange={(e) => onUpdate({ filter: { ...currentFilter, brightness: parseInt(e.target.value) } })}
            className="w-full accent-blue-500"
          />
        </div>
        <div>
          <label className="text-neutral-500 text-xs">コントラスト: {currentFilter.contrast}%</label>
          <input
            type="range"
            min="0"
            max="200"
            value={currentFilter.contrast}
            onChange={(e) => onUpdate({ filter: { ...currentFilter, contrast: parseInt(e.target.value) } })}
            className="w-full accent-blue-500"
          />
        </div>
        <div>
          <label className="text-neutral-500 text-xs">彩度: {currentFilter.saturation}%</label>
          <input
            type="range"
            min="0"
            max="200"
            value={currentFilter.saturation}
            onChange={(e) => onUpdate({ filter: { ...currentFilter, saturation: parseInt(e.target.value) } })}
            className="w-full accent-blue-500"
          />
        </div>
      </div>

      {/* Opacity */}
      <div>
        <label className="text-neutral-500 text-xs">不透明度: {Math.round(layer.opacity * 100)}%</label>
        <input
          type="range"
          min="0"
          max="100"
          value={layer.opacity * 100}
          onChange={(e) => onUpdate({ opacity: parseInt(e.target.value) / 100 })}
          className="w-full accent-blue-500"
        />
      </div>
    </div>
  );
}
