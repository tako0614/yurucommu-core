import type { JSX } from "solid-js";
import { useI18n } from "../../../lib/i18n.tsx";

interface StoryComposerHeaderProps {
  onClose: () => void;
  onText: () => void;
  onSticker: () => void;
  stickerActive: boolean;
  onDraw: () => void;
  drawActive: boolean;
  onImage: () => void;
  onVideo: () => void;
  hasVideo: boolean;
  onBackground: () => void;
  backgroundActive: boolean;
  uploading: boolean;
}

interface RailButtonProps {
  icon: JSX.Element;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}

// Instagram-style vertical tool rail button: a single circular icon button,
// label exposed to assistive tech via aria-label/title (no inline text so the
// rail stays compact on the portrait stage).
function RailButton(props: RailButtonProps) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={props.label}
      title={props.label}
      class={`flex h-11 w-11 items-center justify-center rounded-full text-white shadow-md backdrop-blur-sm transition-colors disabled:opacity-40 ${
        props.active
          ? "bg-white/30 ring-2 ring-white/80"
          : "bg-black/45 hover:bg-black/65"
      }`}
    >
      {props.icon}
    </button>
  );
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

const StickerIcon = () => (
  <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

const DrawIcon = () => (
  <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
    />
  </svg>
);

const ImageIcon = () => (
  <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={1.6}
      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
    />
  </svg>
);

const VideoIcon = () => (
  <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={1.6}
      d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
    />
  </svg>
);

// A small gradient swatch stands in for the background picker.
const BackgroundIcon = () => (
  <span class="h-6 w-6 rounded-full border border-white/70 bg-gradient-to-br from-[#667eea] via-[#f5576c] to-[#fee140]" />
);

export function StoryComposerHeader(props: StoryComposerHeaderProps) {
  const { t } = useI18n();
  return (
    <>
      {/* Close — top-left, anchored to the stage. */}
      <button
        type="button"
        onClick={props.onClose}
        aria-label={t("common.close")}
        class="absolute z-20 flex h-11 w-11 items-center justify-center rounded-full bg-black/45 text-white shadow-md backdrop-blur-sm transition-colors hover:bg-black/65"
        style={{
          top: "calc(env(safe-area-inset-top, 0px) + 12px)",
          left: "12px",
        }}
      >
        <CloseIcon />
      </button>

      {/* Tool rail — top-right vertical icon stack (Instagram layout). */}
      <div
        class="absolute right-3 z-20 flex flex-col gap-3"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <RailButton
          icon={<span class="text-xl font-bold leading-none">Aa</span>}
          label={t("story.text")}
          onClick={props.onText}
        />
        <RailButton
          icon={<StickerIcon />}
          label={t("story.stamp")}
          onClick={props.onSticker}
          active={props.stickerActive}
        />
        <RailButton
          icon={<DrawIcon />}
          label={t("story.drawing")}
          onClick={props.onDraw}
          active={props.drawActive}
        />
        <RailButton
          icon={<ImageIcon />}
          label={t("story.addPhoto")}
          onClick={props.onImage}
          disabled={props.uploading}
        />
        <RailButton
          icon={<VideoIcon />}
          label={t("story.addVideo")}
          onClick={props.onVideo}
          disabled={props.uploading}
          active={props.hasVideo}
        />
        <RailButton
          icon={<BackgroundIcon />}
          label={t("story.changeBackground")}
          onClick={props.onBackground}
          active={props.backgroundActive}
        />
      </div>
    </>
  );
}
