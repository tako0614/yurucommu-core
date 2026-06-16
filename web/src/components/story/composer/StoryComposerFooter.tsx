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

      <div class="flex items-center gap-3 px-4 pb-2">
        <button
          onClick={props.onPost}
          disabled={postDisabled()}
          class="flex-1 flex items-center justify-center gap-2 py-3.5 bg-neutral-800 hover:bg-neutral-700 rounded-full text-white font-medium disabled:opacity-50 transition-all"
        >
          <span class="w-7 h-7 rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 flex items-center justify-center border-2 border-black">
            <span class="w-4 h-4 rounded-full bg-neutral-900"></span>
          </span>
          <span>
            {props.posting
              ? `${Math.round(props.progress)}%`
              : t("story.stories")}
          </span>
        </button>

        <button
          onClick={props.onPost}
          disabled={postDisabled()}
          class="flex-1 flex items-center justify-center gap-2 py-3.5 bg-neutral-800 hover:bg-neutral-700 rounded-full text-white font-medium disabled:opacity-50 transition-all"
        >
          <span class="w-7 h-7 rounded-full bg-green-500 flex items-center justify-center">
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </span>
          <span>{t("story.closeFriends")}</span>
        </button>

        <button
          onClick={props.onPost}
          disabled={postDisabled()}
          class="w-12 h-12 flex items-center justify-center bg-blue-500 hover:bg-blue-600 rounded-full text-white disabled:opacity-50 transition-all"
        >
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
