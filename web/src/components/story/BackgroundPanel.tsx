/**
 * Background Panel for Story Editor
 *
 * Controls background fill type (solid or gradient) and color selection.
 */

import { Show } from "solid-js";
import { ColorPicker, GradientPicker } from "./ColorPicker.tsx";
import { useI18n } from "../../lib/i18n.tsx";

interface BackgroundPanelProps {
  fillType: "solid" | "gradient";
  solidColor: string;
  gradientColors: string[];
  gradientAngle: number;
  onSolidColorChange: (color: string) => void;
  onGradientChange: (colors: string[], angle: number) => void;
  onFillTypeChange: (type: "solid" | "gradient") => void;
}

export function BackgroundPanel(props: BackgroundPanelProps) {
  const { t } = useI18n();
  return (
    <div class="space-y-4">
      <h3 class="text-white font-medium">{t("story.background")}</h3>

      {/* Fill type toggle */}
      <div class="flex gap-2">
        <button
          onClick={() => props.onFillTypeChange("solid")}
          class={`flex-1 py-2 rounded-lg text-sm transition-colors ${
            props.fillType === "solid"
              ? "bg-accent text-white"
              : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
          }`}
        >
          {t("story.solid")}
        </button>
        <button
          onClick={() => props.onFillTypeChange("gradient")}
          class={`flex-1 py-2 rounded-lg text-sm transition-colors ${
            props.fillType === "gradient"
              ? "bg-accent text-white"
              : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
          }`}
        >
          {t("story.gradient")}
        </button>
      </div>

      {/* Color picker based on fill type */}
      <Show
        when={props.fillType === "solid"}
        fallback={
          <GradientPicker
            colors={props.gradientColors}
            angle={props.gradientAngle}
            onChange={props.onGradientChange}
          />
        }
      >
        <ColorPicker
          color={props.solidColor}
          onChange={props.onSolidColorChange}
        />
      </Show>
    </div>
  );
}
