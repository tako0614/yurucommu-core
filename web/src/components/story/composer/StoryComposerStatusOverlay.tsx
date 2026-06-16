import { Show } from "solid-js";
import { useI18n } from "../../../lib/i18n.tsx";

interface StoryComposerStatusOverlayProps {
  ffmpegLoading: boolean;
  posting: boolean;
  progress: number;
}

export function StoryComposerStatusOverlay(
  props: StoryComposerStatusOverlayProps,
) {
  const { t } = useI18n();
  return (
    <>
      <Show when={props.ffmpegLoading}>
        <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 bg-black/80 backdrop-blur-sm rounded-2xl px-6 py-4">
          <div class="flex items-center gap-3">
            <div class="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
            <span class="text-white">{t("story.videoPreparing")}</span>
          </div>
        </div>
      </Show>

      <Show when={props.posting}>
        <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 bg-black/80 backdrop-blur-sm rounded-2xl px-8 py-6">
          <div class="flex flex-col items-center gap-4">
            <div class="w-16 h-16 relative">
              <svg class="w-full h-full -rotate-90">
                <circle
                  cx="32"
                  cy="32"
                  r="28"
                  fill="none"
                  stroke="rgba(255,255,255,0.2)"
                  stroke-width="4"
                />
                <circle
                  cx="32"
                  cy="32"
                  r="28"
                  fill="none"
                  stroke="white"
                  stroke-width="4"
                  stroke-linecap="round"
                  stroke-dasharray={`${props.progress * 1.76} 176`}
                />
              </svg>
              <span class="absolute inset-0 flex items-center justify-center text-white font-medium">
                {Math.round(props.progress)}%
              </span>
            </div>
            <span class="text-white text-sm">{t("posts.posting")}</span>
          </div>
        </div>
      </Show>
    </>
  );
}
