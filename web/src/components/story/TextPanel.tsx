/**
 * Text Panel for Story Editor
 *
 * Controls text layer properties: content, font, size, style, alignment,
 * color, background, stroke, and shadow.
 */

import { For, Show } from "solid-js";
import { FONTS, TextLayer } from "../../lib/story-canvas.ts";
import { ColorPicker } from "./ColorPicker.tsx";
import { LayerDownIcon, LayerUpIcon, TrashIcon } from "./ToolPanelIcons.tsx";
import { useI18n } from "../../lib/i18n.tsx";
import type { TranslationKey } from "../../lib/i18n.tsx";

interface TextPanelProps {
  layer: TextLayer;
  onUpdate: (updates: Partial<TextLayer>) => void;
  onDelete: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
}

export function TextPanel(props: TextPanelProps) {
  const { t } = useI18n();
  return (
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="text-white font-medium">{t("story.text")}</h3>
        <div class="flex gap-1">
          <button
            onClick={props.onBringToFront}
            class="p-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors"
            title={t("story.toFront")}
          >
            <LayerUpIcon />
          </button>
          <button
            onClick={props.onSendToBack}
            class="p-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors"
            title={t("story.toBack")}
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

      {/* Text content */}
      <div>
        <label class="text-neutral-400 text-sm">{t("story.text")}</label>
        <textarea
          value={props.layer.content}
          onInput={(e) => props.onUpdate({ content: e.currentTarget.value })}
          class="w-full mt-1 bg-neutral-800 text-white px-4 py-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          rows={3}
        />
      </div>

      {/* Font family */}
      <div>
        <label class="text-neutral-400 text-sm">{t("story.font")}</label>
        <div class="grid grid-cols-2 gap-2 mt-1">
          <For each={FONTS}>
            {(font) => (
              <button
                onClick={() => props.onUpdate({ fontFamily: font.family })}
                class={`px-3 py-2 rounded-lg text-sm transition-colors ${
                  props.layer.fontFamily === font.family
                    ? "bg-blue-500 text-white"
                    : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
                }`}
                style={{ "font-family": font.family }}
              >
                {t(font.name as TranslationKey)}
              </button>
            )}
          </For>
        </div>
      </div>

      {/* Font size */}
      <div>
        <label class="text-neutral-400 text-sm">
          {t("story.fontSize").replace("{value}", String(props.layer.fontSize))}
        </label>
        <input
          type="range"
          min="24"
          max="200"
          value={props.layer.fontSize}
          onInput={(e) =>
            props.onUpdate({ fontSize: parseInt(e.currentTarget.value) })
          }
          class="w-full mt-1 accent-blue-500"
        />
      </div>

      {/* Font style */}
      <div class="flex gap-2">
        <button
          onClick={() =>
            props.onUpdate({
              fontWeight: props.layer.fontWeight === "bold" ? "normal" : "bold",
            })
          }
          class={`flex-1 py-2 rounded-lg font-bold transition-colors ${
            props.layer.fontWeight === "bold"
              ? "bg-blue-500 text-white"
              : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
          }`}
        >
          B
        </button>
        <button
          onClick={() =>
            props.onUpdate({
              fontStyle:
                props.layer.fontStyle === "italic" ? "normal" : "italic",
            })
          }
          class={`flex-1 py-2 rounded-lg italic transition-colors ${
            props.layer.fontStyle === "italic"
              ? "bg-blue-500 text-white"
              : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
          }`}
        >
          I
        </button>
      </div>

      {/* Text alignment */}
      <div>
        <label class="text-neutral-400 text-sm">{t("story.align")}</label>
        <div class="flex gap-2 mt-1">
          <For each={["left", "center", "right"] as const}>
            {(align) => (
              <button
                onClick={() => props.onUpdate({ textAlign: align })}
                class={`flex-1 py-2 rounded-lg text-sm transition-colors ${
                  props.layer.textAlign === align
                    ? "bg-blue-500 text-white"
                    : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
                }`}
              >
                {align === "left"
                  ? t("story.alignLeft")
                  : align === "center"
                    ? t("story.alignCenter")
                    : t("story.alignRight")}
              </button>
            )}
          </For>
        </div>
      </div>

      {/* Text color */}
      <ColorPicker
        label={t("story.textColor")}
        color={props.layer.color}
        onChange={(color) => props.onUpdate({ color })}
      />

      {/* Background */}
      <div>
        <label class="text-neutral-400 text-sm">{t("story.background")}</label>
        <div class="flex gap-2 mt-1">
          <button
            onClick={() => props.onUpdate({ backgroundColor: undefined })}
            class={`flex-1 py-2 rounded-lg text-sm transition-colors ${
              !props.layer.backgroundColor
                ? "bg-blue-500 text-white"
                : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
            }`}
          >
            {t("story.none")}
          </button>
          <button
            onClick={() =>
              props.onUpdate({ backgroundColor: "rgba(0,0,0,0.5)" })
            }
            class={`flex-1 py-2 rounded-lg text-sm transition-colors ${
              props.layer.backgroundColor
                ? "bg-blue-500 text-white"
                : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
            }`}
          >
            {t("story.on")}
          </button>
        </div>
        <Show when={props.layer.backgroundColor}>
          <ColorPicker
            color={props.layer.backgroundColor!}
            onChange={(color) => props.onUpdate({ backgroundColor: color })}
          />
        </Show>
      </div>

      {/* Stroke */}
      <div>
        <label class="text-neutral-400 text-sm">{t("story.stroke")}</label>
        <div class="flex gap-2 mt-1">
          <button
            onClick={() => props.onUpdate({ stroke: undefined })}
            class={`flex-1 py-2 rounded-lg text-sm transition-colors ${
              !props.layer.stroke
                ? "bg-blue-500 text-white"
                : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
            }`}
          >
            {t("story.none")}
          </button>
          <button
            onClick={() =>
              props.onUpdate({ stroke: { color: "#000000", width: 4 } })
            }
            class={`flex-1 py-2 rounded-lg text-sm transition-colors ${
              props.layer.stroke
                ? "bg-blue-500 text-white"
                : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
            }`}
          >
            {t("story.on")}
          </button>
        </div>
        <Show when={props.layer.stroke}>
          <div class="mt-2 space-y-2">
            <ColorPicker
              color={props.layer.stroke!.color}
              onChange={(color) =>
                props.onUpdate({
                  stroke: { color, width: props.layer.stroke?.width ?? 4 },
                })
              }
            />
            <div>
              <label class="text-neutral-500 text-xs">
                {t("story.thickness").replace(
                  "{value}",
                  String(props.layer.stroke!.width),
                )}
              </label>
              <input
                type="range"
                min="1"
                max="20"
                value={props.layer.stroke!.width}
                onInput={(e) =>
                  props.onUpdate({
                    stroke: {
                      color: props.layer.stroke?.color ?? "#000000",
                      width: parseInt(e.currentTarget.value),
                    },
                  })
                }
                class="w-full accent-blue-500"
              />
            </div>
          </div>
        </Show>
      </div>

      {/* Shadow */}
      <div>
        <label class="text-neutral-400 text-sm">{t("story.shadow")}</label>
        <div class="flex gap-2 mt-1">
          <button
            onClick={() => props.onUpdate({ shadow: undefined })}
            class={`flex-1 py-2 rounded-lg text-sm transition-colors ${
              !props.layer.shadow
                ? "bg-blue-500 text-white"
                : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
            }`}
          >
            {t("story.none")}
          </button>
          <button
            onClick={() =>
              props.onUpdate({
                shadow: {
                  color: "rgba(0,0,0,0.5)",
                  blur: 10,
                  offsetX: 2,
                  offsetY: 2,
                },
              })
            }
            class={`flex-1 py-2 rounded-lg text-sm transition-colors ${
              props.layer.shadow
                ? "bg-blue-500 text-white"
                : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
            }`}
          >
            {t("story.on")}
          </button>
        </div>
      </div>
    </div>
  );
}
