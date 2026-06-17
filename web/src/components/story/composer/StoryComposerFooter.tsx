import { Show } from "solid-js";
import { useI18n } from "../../../lib/i18n.tsx";

interface StoryComposerFooterProps {
  caption: string;
  onCaptionChange: (value: string) => void;
  onPost: () => void;
  canPost: boolean;
  posting: boolean;
  progress: number;
  videoFile: File | null;
  ffmpegReady: boolean;
  error: string | null;
  onDismissError: () => void;
  // Inhabited scope the story will be shared to. `null` => personal story
  // (self + followers). A non-null label is the community display name and
  // binds the story to that community (reach == members).
  scopeLabel: string | null;
}

const SendIcon = () => (
  <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
  </svg>
);

export function StoryComposerFooter(props: StoryComposerFooterProps) {
  const { t } = useI18n();
  const postDisabled = () =>
    !props.canPost ||
    props.posting ||
    !!(props.videoFile && !props.ffmpegReady);

  // The single post button is labelled by the inhabited scope: a community
  // scope shares "to #<community>", personal shares "to your story".
  const postLabel = () =>
    props.scopeLabel
      ? t("story.shareToCommunity").replace("{name}", props.scopeLabel)
      : t("story.shareToStory");

  return (
    <div
      class="absolute left-0 right-0 bottom-0 z-10 bg-gradient-to-t from-black via-black/90 to-transparent"
      style={{
        "padding-bottom": "max(env(safe-area-inset-bottom, 0px), 16px)",
      }}
    >
      <div class="px-4 pt-8 pb-3">
        <input
          type="text"
          value={props.caption}
          onInput={(e) => props.onCaptionChange(e.currentTarget.value)}
          placeholder={t("story.captionPlaceholder")}
          class="w-full bg-transparent text-white placeholder-white/50 text-base py-2 outline-none"
        />
      </div>

      {/* Current scope indicator: shows where the story will be shared. */}
      <div class="flex items-center gap-2 px-4 pb-2 text-white/60 text-xs">
        <span class="w-2 h-2 rounded-full bg-white/40"></span>
        <span>{postLabel()}</span>
      </div>

      <div class="flex items-center gap-3 px-4 pb-2">
        <button
          onClick={props.onPost}
          disabled={postDisabled()}
          class="flex-1 flex items-center justify-center gap-2 py-3.5 bg-accent rounded-full text-white font-medium disabled:opacity-50 transition-all"
        >
          <span>
            {props.posting ? `${Math.round(props.progress)}%` : postLabel()}
          </span>
          <SendIcon />
        </button>
      </div>

      <Show when={props.error}>
        <div class="mx-4 mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-xl">
          <p class="text-red-400 text-sm">{props.error}</p>
          <button
            onClick={props.onDismissError}
            class="text-red-400/70 text-xs mt-1 hover:text-red-400"
          >
            {t("story.close")}
          </button>
        </div>
      </Show>
    </div>
  );
}
