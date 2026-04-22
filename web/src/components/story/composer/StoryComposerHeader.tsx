import type { JSX } from "solid-js";

type Tool = "text" | "sticker" | "music" | "effect" | "resize";

interface StoryComposerHeaderProps {
  onClose: () => void;
  activeTool: Tool | null;
  onToolClick: (tool: Tool) => void;
}

interface ToolButtonProps {
  icon: JSX.Element;
  label: string;
  onClick: () => void;
  active?: boolean;
}

// Instagram-style right side tool button (label left, icon right, right-aligned)
function ToolButton(props: ToolButtonProps) {
  return (
    <button
      onClick={props.onClick}
      class="flex items-center justify-end gap-3 w-full"
    >
      <span class="text-white text-sm font-medium drop-shadow-md">
        {props.label}
      </span>
      <span
        class={`w-11 h-11 flex items-center justify-center rounded-full ${
          props.active ? "bg-white/30" : "bg-neutral-800/80"
        }`}
      >
        {props.icon}
      </span>
    </button>
  );
}

const BackIcon = () => (
  <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M15 19l-7-7 7-7"
    />
  </svg>
);

const EffectIcon = () => (
  <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
    />
  </svg>
);

const ResizeIcon = () => (
  <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5"
    />
  </svg>
);

const MusicIcon = () => (
  <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
    />
  </svg>
);

const ChevronDownIcon = () => (
  <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M19 9l-7 7-7-7"
    />
  </svg>
);

const StickerIcon = () => (
  <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

export function StoryComposerHeader(props: StoryComposerHeaderProps) {
  return (
    <>
      <button
        onClick={props.onClose}
        class="absolute z-10 p-2 bg-black/40 hover:bg-black/60 rounded-full text-white transition-colors"
        style={{
          top: "calc(env(safe-area-inset-top, 16px) + 16px)",
          left: "16px",
        }}
      >
        <BackIcon />
      </button>

      <div
        class="absolute right-4 z-10 flex flex-col gap-4 w-36"
        style={{ top: "calc(env(safe-area-inset-top, 16px) + 16px)" }}
      >
        <ToolButton
          icon={<span class="text-lg font-bold text-white">Aa</span>}
          label="テキスト"
          onClick={() => props.onToolClick("text")}
          active={props.activeTool === "text"}
        />
        <ToolButton
          icon={<StickerIcon />}
          label="スタンプ"
          onClick={() => props.onToolClick("sticker")}
          active={props.activeTool === "sticker"}
        />
        <ToolButton
          icon={<MusicIcon />}
          label="音楽"
          onClick={() => props.onToolClick("music")}
          active={props.activeTool === "music"}
        />
        <ToolButton
          icon={<EffectIcon />}
          label="エフェクト"
          onClick={() => props.onToolClick("effect")}
          active={props.activeTool === "effect"}
        />
        <ToolButton
          icon={<ResizeIcon />}
          label="サイズ変更"
          onClick={() => props.onToolClick("resize")}
          active={props.activeTool === "resize"}
        />
        <button class="flex items-center justify-end w-full">
          <span class="p-2 rounded-full bg-black/40">
            <ChevronDownIcon />
          </span>
        </button>
      </div>
    </>
  );
}
