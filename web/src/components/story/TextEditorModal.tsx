/**
 * Instagram-style Text Editor Modal
 *
 * Full-screen text editing experience with:
 * - Direct text input in center
 * - Font, color, alignment controls at bottom
 * - Background style presets (none, semi-transparent, solid)
 * - Real-time preview
 */

import { createEffect, createSignal, For, Show } from "solid-js";
import { FONTS } from "../../lib/story-canvas.ts";

// Text style presets (Instagram-like A, A, A buttons)
const TEXT_STYLES = [
  { id: "none", label: "A", bg: "transparent", description: "なし" },
  { id: "semi", label: "A", bg: "rgba(0,0,0,0.5)", description: "半透明" },
  { id: "solid", label: "A", bg: "#000000", description: "塗り" },
] as const;

// Color palette
const COLORS = [
  "#FFFFFF",
  "#000000",
  "#FF3B30",
  "#FF9500",
  "#FFCC00",
  "#34C759",
  "#007AFF",
  "#5856D6",
  "#AF52DE",
  "#FF2D55",
];

interface TextEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (text: TextData) => void;
  initialText?: TextData;
}

export interface TextData {
  content: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: "normal" | "bold";
  fontStyle: "normal" | "italic";
  color: string;
  backgroundColor?: string;
  textAlign: "left" | "center" | "right";
  stroke?: { color: string; width: number };
}

const defaultTextData: TextData = {
  content: "",
  fontFamily: FONTS[0]?.family || "sans-serif",
  fontSize: 64,
  fontWeight: "bold",
  fontStyle: "normal",
  color: "#FFFFFF",
  backgroundColor: undefined,
  textAlign: "center",
  stroke: { color: "#000000", width: 3 },
};

export function TextEditorModal(props: TextEditorModalProps) {
  const [text, setText] = createSignal<TextData>(
    props.initialText || defaultTextData,
  );
  const [showFontPicker, setShowFontPicker] = createSignal(false);
  const [showColorPicker, setShowColorPicker] = createSignal(false);
  let inputRef!: HTMLTextAreaElement;

  // Focus input when modal opens
  createEffect(() => {
    if (props.isOpen && inputRef) {
      const timeoutId = setTimeout(() => {
        inputRef?.focus();
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  });

  // Reset state when initialText changes
  createEffect(() => {
    if (props.isOpen) {
      setText(props.initialText || defaultTextData);
    }
  });

  const handleSave = () => {
    const t = text();
    if (t.content.trim()) {
      props.onSave(t);
    }
    props.onClose();
  };

  const handleStyleChange = (styleId: string) => {
    const style = TEXT_STYLES.find((s) => s.id === styleId);
    if (style) {
      setText((prev) => ({
        ...prev,
        backgroundColor: style.bg === "transparent" ? undefined : style.bg,
      }));
    }
  };

  const getCurrentStyle = () => {
    const t = text();
    if (!t.backgroundColor) return "none";
    if (t.backgroundColor.includes("rgba")) return "semi";
    return "solid";
  };

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-[60] bg-black/90 flex flex-col">
        {/* Header */}
        <div class="flex items-center justify-between px-4 py-3">
          <button
            onClick={props.onClose}
            class="text-white text-lg font-medium"
          >
            キャンセル
          </button>
          <div class="flex gap-2">
            {/* Font picker toggle */}
            <button
              onClick={() => {
                setShowFontPicker(!showFontPicker());
                setShowColorPicker(false);
              }}
              class={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                showFontPicker()
                  ? "bg-white text-black"
                  : "bg-white/20 text-white"
              }`}
            >
              Aa
            </button>
            {/* Color picker toggle */}
            <button
              onClick={() => {
                setShowColorPicker(!showColorPicker());
                setShowFontPicker(false);
              }}
              class="w-8 h-8 rounded-full border-2 border-white"
              style={{ "background-color": text().color }}
            />
          </div>
          <button
            onClick={handleSave}
            class="text-blue-400 text-lg font-semibold"
          >
            完了
          </button>
        </div>

        {/* Font picker dropdown */}
        <Show when={showFontPicker()}>
          <div class="px-4 py-2 bg-black/50">
            <div class="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
              <For each={FONTS}>
                {(font) => (
                  <button
                    onClick={() =>
                      setText((prev) => ({ ...prev, fontFamily: font.family }))}
                    class={`px-4 py-2 rounded-full whitespace-nowrap text-sm transition-colors ${
                      text().fontFamily === font.family
                        ? "bg-white text-black"
                        : "bg-white/20 text-white"
                    }`}
                    style={{ "font-family": font.family }}
                  >
                    {font.name}
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* Color picker dropdown */}
        <Show when={showColorPicker()}>
          <div class="px-4 py-3 bg-black/50">
            <div class="flex gap-2 justify-center">
              <For each={COLORS}>
                {(color) => (
                  <button
                    onClick={() => setText((prev) => ({ ...prev, color }))}
                    class={`w-8 h-8 rounded-full transition-transform ${
                      text().color === color
                        ? "scale-125 ring-2 ring-white ring-offset-2 ring-offset-black"
                        : ""
                    }`}
                    style={{ "background-color": color }}
                  />
                )}
              </For>
              {/* Custom color input */}
              <label class="w-8 h-8 rounded-full bg-gradient-to-br from-red-500 via-green-500 to-blue-500 cursor-pointer flex items-center justify-center">
                <input
                  type="color"
                  value={text().color}
                  onInput={(e) =>
                    setText((prev) => ({
                      ...prev,
                      color: e.currentTarget.value,
                    }))}
                  class="opacity-0 absolute w-0 h-0"
                />
                <span class="text-white text-xs">+</span>
              </label>
            </div>
          </div>
        </Show>

        {/* Main text input area */}
        <div class="flex-1 flex items-center justify-center p-8">
          <div
            class="w-full max-w-md"
            style={{
              "background-color": text().backgroundColor,
              padding: text().backgroundColor ? "16px 24px" : "0",
              "border-radius": text().backgroundColor ? "12px" : "0",
            }}
          >
            <textarea
              ref={inputRef}
              value={text().content}
              onInput={(e) =>
                setText((prev) => ({
                  ...prev,
                  content: e.currentTarget.value,
                }))}
              placeholder="テキストを入力"
              class="w-full bg-transparent border-none outline-none resize-none text-center"
              style={{
                "font-family": text().fontFamily,
                "font-size": `${Math.min(text().fontSize, 48)}px`,
                "font-weight": text().fontWeight,
                "font-style": text().fontStyle,
                color: text().color,
                "text-align": text().textAlign,
                "text-shadow": text().stroke
                  ? `
                    -${text().stroke!.width}px -${text().stroke!.width}px 0 ${
                    text().stroke!.color
                  },
                    ${text().stroke!.width}px -${text().stroke!.width}px 0 ${
                    text().stroke!.color
                  },
                    -${text().stroke!.width}px ${text().stroke!.width}px 0 ${
                    text().stroke!.color
                  },
                    ${text().stroke!.width}px ${text().stroke!.width}px 0 ${
                    text().stroke!.color
                  }
                  `
                  : "none",
                "line-height": "1.4",
                "min-height": "100px",
              }}
              rows={3}
            />
          </div>
        </div>

        {/* Bottom toolbar */}
        <div class="px-4 py-4 bg-black/50 space-y-4">
          {/* Text style buttons (A, A, A) */}
          <div class="flex justify-center gap-4">
            <For each={TEXT_STYLES}>
              {(style) => (
                <button
                  onClick={() => handleStyleChange(style.id)}
                  class={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-lg transition-all ${
                    getCurrentStyle() === style.id
                      ? "ring-2 ring-white scale-110"
                      : ""
                  }`}
                  style={{
                    "background-color": style.id === "none"
                      ? "transparent"
                      : style.bg,
                    color: "#fff",
                    border: style.id === "none"
                      ? "2px solid rgba(255,255,255,0.5)"
                      : "none",
                  }}
                >
                  A
                </button>
              )}
            </For>
          </div>

          {/* Alignment */}
          <div class="flex justify-center gap-2">
            <For each={["left", "center", "right"] as const}>
              {(align) => (
                <button
                  onClick={() =>
                    setText((prev) => ({ ...prev, textAlign: align }))}
                  class={`w-12 h-10 rounded-lg flex items-center justify-center transition-colors ${
                    text().textAlign === align
                      ? "bg-white text-black"
                      : "bg-white/20 text-white"
                  }`}
                >
                  <Show when={align === "left"}>
                    <svg
                      class="w-5 h-5"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M2 4.75A.75.75 0 012.75 4h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 4.75zm0 5A.75.75 0 012.75 9h9.5a.75.75 0 010 1.5h-9.5A.75.75 0 012 9.75zm0 5a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75a.75.75 0 01-.75-.75z"
                        clip-rule="evenodd"
                      />
                    </svg>
                  </Show>
                  <Show when={align === "center"}>
                    <svg
                      class="w-5 h-5"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M2 4.75A.75.75 0 012.75 4h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 4.75zm2.5 5a.75.75 0 01.75-.75h9.5a.75.75 0 010 1.5h-9.5a.75.75 0 01-.75-.75zm-2.5 5a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75a.75.75 0 01-.75-.75z"
                        clip-rule="evenodd"
                      />
                    </svg>
                  </Show>
                  <Show when={align === "right"}>
                    <svg
                      class="w-5 h-5"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M2 4.75A.75.75 0 012.75 4h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 4.75zm5 5a.75.75 0 01.75-.75h9.5a.75.75 0 010 1.5h-9.5A.75.75 0 017 9.75zm-5 5a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75a.75.75 0 01-.75-.75z"
                        clip-rule="evenodd"
                      />
                    </svg>
                  </Show>
                </button>
              )}
            </For>
          </div>

          {/* Font size slider */}
          <div class="flex items-center gap-3 px-2">
            <span class="text-white/60 text-xs">A</span>
            <input
              type="range"
              min="24"
              max="120"
              value={text().fontSize}
              onInput={(e) =>
                setText((prev) => ({
                  ...prev,
                  fontSize: parseInt(e.currentTarget.value),
                }))}
              class="flex-1 accent-white h-1"
            />
            <span class="text-white text-sm">A</span>
          </div>

          {/* Bold / Italic toggle */}
          <div class="flex justify-center gap-2">
            <button
              onClick={() =>
                setText((prev) => ({
                  ...prev,
                  fontWeight: prev.fontWeight === "bold" ? "normal" : "bold",
                }))}
              class={`w-12 h-10 rounded-lg flex items-center justify-center font-bold transition-colors ${
                text().fontWeight === "bold"
                  ? "bg-white text-black"
                  : "bg-white/20 text-white"
              }`}
            >
              B
            </button>
            <button
              onClick={() =>
                setText((prev) => ({
                  ...prev,
                  fontStyle: prev.fontStyle === "italic" ? "normal" : "italic",
                }))}
              class={`w-12 h-10 rounded-lg flex items-center justify-center italic transition-colors ${
                text().fontStyle === "italic"
                  ? "bg-white text-black"
                  : "bg-white/20 text-white"
              }`}
            >
              I
            </button>
            <button
              onClick={() =>
                setText((prev) => ({
                  ...prev,
                  stroke: prev.stroke
                    ? undefined
                    : { color: "#000000", width: 3 },
                }))}
              class={`w-12 h-10 rounded-lg flex items-center justify-center font-bold transition-colors ${
                text().stroke ? "bg-white text-black" : "bg-white/20 text-white"
              }`}
              style={{
                "text-shadow":
                  "1px 1px 0 #666, -1px -1px 0 #666, 1px -1px 0 #666, -1px 1px 0 #666",
              }}
            >
              A
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}

export default TextEditorModal;
