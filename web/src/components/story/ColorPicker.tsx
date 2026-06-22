/**
 * Color Picker Component
 *
 * Simple color picker with presets and custom color input.
 */

import { createSignal, For, Show } from "solid-js";
import { useI18n } from "../../lib/i18n.tsx";

interface ColorPickerProps {
  color: string;
  onChange: (color: string) => void;
  label?: string;
  showAlpha?: boolean;
}

// Color presets
const PRESET_COLORS = [
  "#ffffff",
  "#000000",
  "#ff0000",
  "#ff6b6b",
  "#ff9500",
  "#ffcc00",
  "#4cd964",
  "#34c759",
  "#5ac8fa",
  "#007aff",
  "#5856d6",
  "#af52de",
  "#ff2d55",
  "#ff375f",
  "#8e8e93",
  "#636366",
];

const GRADIENT_PRESETS = [
  { colors: ["#667eea", "#764ba2"], angle: 135 },
  { colors: ["#fa709a", "#fee140"], angle: 135 },
  { colors: ["#667eea", "#00d4ff"], angle: 135 },
  { colors: ["#11998e", "#38ef7d"], angle: 135 },
  { colors: ["#0f0c29", "#302b63", "#24243e"], angle: 135 },
  { colors: ["#f093fb", "#f5576c"], angle: 135 },
  { colors: ["#4facfe", "#00f2fe"], angle: 135 },
  { colors: ["#43e97b", "#38f9d7"], angle: 135 },
];

export function ColorPicker(props: ColorPickerProps) {
  const { t } = useI18n();
  const [showCustom, setShowCustom] = createSignal(false);
  const [customColor, setCustomColor] = createSignal(props.color);

  const handlePresetClick = (preset: string) => {
    props.onChange(preset);
    setCustomColor(preset);
  };

  const handleCustomChange = (
    e: InputEvent & { currentTarget: HTMLInputElement },
  ) => {
    const value = e.currentTarget.value;
    setCustomColor(value);
    props.onChange(value);
  };

  return (
    <div class="space-y-2">
      <Show when={props.label}>
        <label class="text-neutral-400 text-sm">{props.label}</label>
      </Show>

      {/* Preset colors */}
      <div class="grid grid-cols-8 gap-1">
        <For each={PRESET_COLORS}>
          {(preset) => (
            <button
              onClick={() => handlePresetClick(preset)}
              aria-label={t("story.selectColor").replace("{color}", preset)}
              aria-pressed={props.color === preset}
              class={`w-8 h-8 rounded-lg border-2 transition-all ${
                props.color === preset
                  ? "border-white scale-110 shadow-lg"
                  : "border-transparent hover:scale-105"
              }`}
              style={{ "background-color": preset }}
            />
          )}
        </For>
      </div>

      {/* Custom color toggle */}
      <button
        onClick={() => setShowCustom(!showCustom())}
        class="text-neutral-400 text-xs hover:text-white transition-colors"
      >
        {t("story.customColor")} {showCustom() ? "▲" : "▼"}
      </button>

      {/* Custom color input */}
      <Show when={showCustom()}>
        <div class="flex gap-2 items-center">
          <input
            type="color"
            value={customColor().startsWith("#") ? customColor() : "#ffffff"}
            onInput={handleCustomChange}
            class="w-10 h-10 rounded-lg cursor-pointer bg-transparent"
          />
          <input
            type="text"
            value={customColor()}
            onInput={handleCustomChange}
            placeholder="#ffffff"
            class="flex-1 bg-neutral-800 text-white px-3 py-2 rounded-lg text-sm outline-none focus:ring-2 ring-accent"
          />
        </div>
      </Show>
    </div>
  );
}

// Gradient picker variant
interface GradientPickerProps {
  colors: string[];
  angle: number;
  onChange: (colors: string[], angle: number) => void;
  label?: string;
}

export function GradientPicker(props: GradientPickerProps) {
  const { t } = useI18n();
  const getGradientStyle = (c: string[], a: number) => {
    return `linear-gradient(${a}deg, ${c.join(", ")})`;
  };

  return (
    <div class="space-y-2">
      <Show when={props.label}>
        <label class="text-neutral-400 text-sm">{props.label}</label>
      </Show>

      {/* Preset gradients */}
      <div class="grid grid-cols-4 gap-2">
        <For each={GRADIENT_PRESETS}>
          {(preset) => (
            <button
              onClick={() => props.onChange(preset.colors, preset.angle)}
              aria-label={t("story.selectGradient")}
              aria-pressed={
                JSON.stringify(props.colors) === JSON.stringify(preset.colors)
              }
              class={`w-full aspect-square rounded-lg border-2 transition-all ${
                JSON.stringify(props.colors) === JSON.stringify(preset.colors)
                  ? "border-white scale-105 shadow-lg"
                  : "border-transparent hover:scale-105"
              }`}
              style={{
                background: getGradientStyle(preset.colors, preset.angle),
              }}
            />
          )}
        </For>
      </div>

      {/* Custom gradient controls */}
      <div class="flex gap-2">
        <div class="flex-1">
          <label class="text-neutral-500 text-xs">
            {t("story.startColor")}
          </label>
          <input
            type="color"
            aria-label={t("story.startColor")}
            value={props.colors[0] || "#667eea"}
            onInput={(e) =>
              props.onChange(
                [e.currentTarget.value, props.colors[1] || "#764ba2"],
                props.angle,
              )
            }
            class="w-full h-8 rounded cursor-pointer bg-transparent"
          />
        </div>
        <div class="flex-1">
          <label class="text-neutral-500 text-xs">{t("story.endColor")}</label>
          <input
            type="color"
            aria-label={t("story.endColor")}
            value={props.colors[props.colors.length - 1] || "#764ba2"}
            onInput={(e) =>
              props.onChange(
                [props.colors[0] || "#667eea", e.currentTarget.value],
                props.angle,
              )
            }
            class="w-full h-8 rounded cursor-pointer bg-transparent"
          />
        </div>
      </div>

      {/* Angle slider */}
      <div>
        <label class="text-neutral-500 text-xs">
          {t("story.angle").replace("{value}", String(props.angle))}
        </label>
        <input
          type="range"
          min="0"
          max="360"
          aria-label={t("story.angle").replace("{value}", String(props.angle))}
          value={props.angle}
          onInput={(e) =>
            props.onChange(props.colors, parseInt(e.currentTarget.value))
          }
          class="w-full accent-blue-500"
        />
      </div>
    </div>
  );
}

export default ColorPicker;
