import type { JSX } from "solid-js";
import { useI18n } from "../../../lib/i18n.tsx";

type Tool = "text" | "sticker";

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
  const { t } = useI18n();
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
          label={t("story.text")}
          onClick={() => props.onToolClick("text")}
          active={props.activeTool === "text"}
        />
        <ToolButton
          icon={<StickerIcon />}
          label={t("story.stamp")}
          onClick={() => props.onToolClick("sticker")}
          active={props.activeTool === "sticker"}
        />
      </div>
    </>
  );
}
