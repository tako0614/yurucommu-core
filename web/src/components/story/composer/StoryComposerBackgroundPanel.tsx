import { For, Show } from "solid-js";
import { BackgroundPanel } from "../BackgroundPanel.tsx";
import { useI18n } from "../../../lib/i18n.tsx";

// Instagram-style quick background presets: a row of one-tap swatches for the
// common case, with the full solid/gradient custom picker below.
const GRADIENT_PRESETS: { colors: string[]; angle: number }[] = [
  { colors: ["#667eea", "#764ba2"], angle: 135 },
  { colors: ["#f093fb", "#f5576c"], angle: 135 },
  { colors: ["#4facfe", "#00f2fe"], angle: 135 },
  { colors: ["#43e97b", "#38f9d7"], angle: 135 },
  { colors: ["#fa709a", "#fee140"], angle: 135 },
  { colors: ["#30cfd0", "#330867"], angle: 135 },
  { colors: ["#ff9a9e", "#fad0c4"], angle: 135 },
  { colors: ["#a18cd1", "#fbc2eb"], angle: 135 },
];

const SOLID_PRESETS = ["#000000", "#ffffff", "#262626", "#1d4ed8", "#dc2626"];

interface StoryComposerBackgroundPanelProps {
  open: boolean;
  fillType: "solid" | "gradient";
  solidColor: string;
  gradientColors: string[];
  gradientAngle: number;
  onSolidColorChange: (color: string) => void;
  onGradientChange: (colors: string[], angle: number) => void;
  onFillTypeChange: (type: "solid" | "gradient") => void;
  onClose: () => void;
}

const CloseIcon = () => (
  <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M6 18L18 6M6 6l12 12"
    />
  </svg>
);

export function StoryComposerBackgroundPanel(
  props: StoryComposerBackgroundPanelProps,
) {
  const { t } = useI18n();
  return (
    <Show when={props.open}>
      <div
        class="absolute left-3 right-3 z-30 max-h-[44%] overflow-y-auto rounded-2xl bg-neutral-900/95 p-4 shadow-2xl backdrop-blur-sm"
        style={{
          bottom: "calc(max(env(safe-area-inset-bottom, 0px), 12px) + 96px)",
        }}
      >
        <div class="mb-3 flex items-center justify-between">
          <h3 class="font-medium text-white">{t("story.background")}</h3>
          <button
            type="button"
            onClick={props.onClose}
            aria-label={t("common.close")}
            class="p-1 text-white/60 hover:text-white"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Quick preset swatches. */}
        <div class="mb-4 grid grid-cols-8 gap-2">
          <For each={GRADIENT_PRESETS}>
            {(preset) => {
              const active = () =>
                props.fillType === "gradient" &&
                props.gradientColors[0] === preset.colors[0] &&
                props.gradientColors[1] === preset.colors[1];
              return (
                <button
                  type="button"
                  onClick={() => {
                    props.onFillTypeChange("gradient");
                    props.onGradientChange(preset.colors, preset.angle);
                  }}
                  class={`aspect-square rounded-full ${
                    active()
                      ? "ring-2 ring-white ring-offset-2 ring-offset-neutral-900"
                      : ""
                  }`}
                  style={{
                    background: `linear-gradient(${preset.angle}deg, ${preset.colors[0]}, ${preset.colors[1]})`,
                  }}
                />
              );
            }}
          </For>
          <For each={SOLID_PRESETS}>
            {(color) => {
              const active = () =>
                props.fillType === "solid" && props.solidColor === color;
              return (
                <button
                  type="button"
                  onClick={() => {
                    props.onFillTypeChange("solid");
                    props.onSolidColorChange(color);
                  }}
                  class={`aspect-square rounded-full border border-white/20 ${
                    active()
                      ? "ring-2 ring-white ring-offset-2 ring-offset-neutral-900"
                      : ""
                  }`}
                  style={{ "background-color": color }}
                />
              );
            }}
          </For>
        </div>

        {/* Full custom picker (solid / gradient). */}
        <BackgroundPanel
          fillType={props.fillType}
          solidColor={props.solidColor}
          gradientColors={props.gradientColors}
          gradientAngle={props.gradientAngle}
          onSolidColorChange={props.onSolidColorChange}
          onGradientChange={props.onGradientChange}
          onFillTypeChange={props.onFillTypeChange}
        />
      </div>
    </Show>
  );
}
