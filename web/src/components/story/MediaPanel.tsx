/**
 * Media Panel for Story Editor
 *
 * Controls image layer properties: filter presets, manual adjustments
 * (brightness, contrast, saturation), and opacity.
 */

import { createMemo, For } from "solid-js";
import { FILTER_PRESETS, MediaLayer } from "../../lib/story-canvas.ts";
import { LayerDownIcon, LayerUpIcon, TrashIcon } from "./ToolPanelIcons.tsx";

interface MediaPanelProps {
  layer: MediaLayer;
  onUpdate: (updates: Partial<MediaLayer>) => void;
  onDelete: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
}

export function MediaPanel(props: MediaPanelProps) {
  const currentFilter = createMemo(
    () => props.layer.filter || FILTER_PRESETS[0].filter,
  );

  return (
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="text-white font-medium">画像</h3>
        <div class="flex gap-1">
          <button
            onClick={props.onBringToFront}
            class="p-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors"
            title="前面へ"
          >
            <LayerUpIcon />
          </button>
          <button
            onClick={props.onSendToBack}
            class="p-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors"
            title="背面へ"
          >
            <LayerDownIcon />
          </button>
          <button
            onClick={props.onDelete}
            class="p-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors"
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      {/* Filter presets */}
      <div>
        <label class="text-neutral-400 text-sm">フィルター</label>
        <div class="grid grid-cols-4 gap-2 mt-2">
          <For each={FILTER_PRESETS}>
            {(preset) => (
              <button
                onClick={() => props.onUpdate({ filter: preset.filter })}
                class={`p-2 rounded-lg text-xs transition-colors ${
                  JSON.stringify(currentFilter()) ===
                  JSON.stringify(preset.filter)
                    ? "bg-blue-500 text-white"
                    : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
                }`}
              >
                {preset.name}
              </button>
            )}
          </For>
        </div>
      </div>

      {/* Manual adjustments */}
      <div class="space-y-3">
        <div>
          <label class="text-neutral-500 text-xs">
            明るさ: {currentFilter().brightness}%
          </label>
          <input
            type="range"
            min="0"
            max="200"
            value={currentFilter().brightness}
            onInput={(e) =>
              props.onUpdate({
                filter: {
                  ...currentFilter(),
                  brightness: parseInt(e.currentTarget.value),
                },
              })
            }
            class="w-full accent-blue-500"
          />
        </div>
        <div>
          <label class="text-neutral-500 text-xs">
            コントラスト: {currentFilter().contrast}%
          </label>
          <input
            type="range"
            min="0"
            max="200"
            value={currentFilter().contrast}
            onInput={(e) =>
              props.onUpdate({
                filter: {
                  ...currentFilter(),
                  contrast: parseInt(e.currentTarget.value),
                },
              })
            }
            class="w-full accent-blue-500"
          />
        </div>
        <div>
          <label class="text-neutral-500 text-xs">
            彩度: {currentFilter().saturation}%
          </label>
          <input
            type="range"
            min="0"
            max="200"
            value={currentFilter().saturation}
            onInput={(e) =>
              props.onUpdate({
                filter: {
                  ...currentFilter(),
                  saturation: parseInt(e.currentTarget.value),
                },
              })
            }
            class="w-full accent-blue-500"
          />
        </div>
      </div>

      {/* Opacity */}
      <div>
        <label class="text-neutral-500 text-xs">
          不透明度: {Math.round(props.layer.opacity * 100)}%
        </label>
        <input
          type="range"
          min="0"
          max="100"
          value={props.layer.opacity * 100}
          onInput={(e) =>
            props.onUpdate({ opacity: parseInt(e.currentTarget.value) / 100 })
          }
          class="w-full accent-blue-500"
        />
      </div>
    </div>
  );
}
