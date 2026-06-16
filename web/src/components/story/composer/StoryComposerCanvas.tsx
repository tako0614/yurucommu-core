import { Show } from "solid-js";
import type { JSX } from "solid-js";
import { useI18n } from "../../../lib/i18n.tsx";

interface StoryComposerCanvasProps {
  canvasContainerRef: HTMLDivElement | undefined;
  displayCanvasRef: HTMLCanvasElement | undefined;
  displayDimensions: { width: number; height: number };
  videoPreview: string | null;
  videoRef: HTMLVideoElement | undefined;
  videoPosition: { x: number; y: number };
  videoScale: number;
  videoRotation: number;
  onCanvasPointerDown: (e: MouseEvent | TouchEvent) => void;
  onCanvasWheel: (e: WheelEvent) => void;
  onVideoPointerDown: JSX.EventHandler<HTMLDivElement, PointerEvent>;
  onVideoPointerMove: JSX.EventHandler<HTMLDivElement, PointerEvent>;
  onVideoPointerUp: JSX.EventHandler<HTMLDivElement, PointerEvent>;
  onVideoWheel: JSX.EventHandler<HTMLDivElement, WheelEvent>;
  onVideoTouchStart: JSX.EventHandler<HTMLDivElement, TouchEvent>;
  onVideoTouchMove: JSX.EventHandler<HTMLDivElement, TouchEvent>;
  onVideoTouchEnd: JSX.EventHandler<HTMLDivElement, TouchEvent>;
}

export function StoryComposerCanvas(props: StoryComposerCanvasProps) {
  const { t } = useI18n();
  return (
    <div
      ref={props.canvasContainerRef}
      class="absolute inset-0 flex items-center justify-center"
      onMouseDown={props.videoPreview ? undefined : props.onCanvasPointerDown}
      onTouchStart={props.videoPreview ? undefined : props.onCanvasPointerDown}
      onWheel={props.videoPreview ? undefined : props.onCanvasWheel}
    >
      <Show when={props.videoPreview}>
        <div
          class="absolute inset-0 overflow-hidden touch-none z-10"
          onPointerDown={props.onVideoPointerDown}
          onPointerMove={props.onVideoPointerMove}
          onPointerUp={props.onVideoPointerUp}
          onPointerCancel={props.onVideoPointerUp}
          onWheel={props.onVideoWheel}
          onTouchStart={props.onVideoTouchStart}
          onTouchMove={props.onVideoTouchMove}
          onTouchEnd={props.onVideoTouchEnd}
        >
          <video
            ref={props.videoRef}
            src={props.videoPreview!}
            class="absolute w-full h-full object-cover origin-center"
            style={{
              transform: `translate(${props.videoPosition.x}px, ${props.videoPosition.y}px) scale(${props.videoScale}) rotate(${props.videoRotation}deg)`,
            }}
            autoplay
            loop
            muted
            playsinline
          />
          <Show
            when={
              props.videoScale === 1 &&
              props.videoPosition.x === 0 &&
              props.videoPosition.y === 0 &&
              props.videoRotation === 0
            }
          >
            <div class="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-black/70 rounded-full pointer-events-none">
              <span class="text-white/80 text-xs">
                {t("story.gestureHint")}
              </span>
            </div>
          </Show>
        </div>
      </Show>

      <canvas
        ref={props.displayCanvasRef}
        width={props.displayDimensions.width}
        height={props.displayDimensions.height}
        class={`w-full h-full object-contain ${
          props.videoPreview ? "absolute inset-0" : ""
        }`}
        style={
          props.videoPreview
            ? { "mix-blend-mode": "normal", "pointer-events": "none" }
            : undefined
        }
      />
    </div>
  );
}
