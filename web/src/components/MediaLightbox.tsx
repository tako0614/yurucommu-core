import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { Portal } from "solid-js/web";
import type { MediaAttachment } from "../types/index.ts";
import { useI18n } from "../lib/i18n.tsx";
import { useDialog } from "../lib/useDialog.ts";

/**
 * Resolve the displayable URL for a media attachment. Mirrors the inline
 * pattern used by post/story renderers (prefer the canonical `url`, else map
 * the R2 key into the `/media/` route).
 */
export function mediaAttachmentUrl(m: MediaAttachment): string {
  return m.url || `/media/${m.r2_key.replace(/^uploads\//, "")}`;
}

function isVideo(m: MediaAttachment): boolean {
  return (m.content_type || "").startsWith("video/");
}

interface MediaLightboxProps {
  attachments: MediaAttachment[];
  /** Index of the attachment to show first. */
  index: number;
  onClose: () => void;
}

const SWIPE_THRESHOLD = 50;

/**
 * Fullscreen overlay for viewing post/story image (and video) attachments.
 * Supports close (button + Escape + backdrop click), prev/next navigation
 * (buttons + arrow keys + touch swipe), and click/pinch zoom for images.
 * Client-only.
 */
export function MediaLightbox(props: MediaLightboxProps) {
  const { t } = useI18n();
  const [current, setCurrent] = createSignal(props.index);
  const [zoomed, setZoomed] = createSignal(false);
  let dialogRef: HTMLDivElement | undefined;
  let closeButtonRef: HTMLButtonElement | undefined;

  // Reset when a new lightbox session opens at a different index.
  createEffect(() => {
    setCurrent(props.index);
    setZoomed(false);
  });

  // Adopt the shared modal-dialog primitive for focus management: move focus to
  // the close button on open, trap Tab inside the overlay, restore focus on
  // close, and refcount the background scroll-lock + Escape-to-close. The
  // lightbox is always mounted-while-open (the parent gates it behind <Show>),
  // so isOpen is a constant true here. This replaces the component's own ad-hoc
  // Escape + scroll-lock wiring (which moved no focus and trapped no Tab).
  useDialog({
    isOpen: () => true,
    onClose: () => props.onClose(),
    container: () => dialogRef,
    initialFocus: () => closeButtonRef,
  });

  const count = createMemo(() => props.attachments.length);
  const clampedCurrent = createMemo(() => {
    const n = count();
    if (n === 0) return 0;
    return Math.min(Math.max(current(), 0), n - 1);
  });
  const active = createMemo<MediaAttachment | undefined>(
    () => props.attachments[clampedCurrent()],
  );
  const hasMultiple = createMemo(() => count() > 1);

  const goPrev = () => {
    setZoomed(false);
    setCurrent((i) => (i - 1 + count()) % count());
  };

  const goNext = () => {
    setZoomed(false);
    setCurrent((i) => (i + 1) % count());
  };

  // Keyboard: arrows to navigate. Escape + Tab-trap are handled by useDialog.
  createEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && hasMultiple()) {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight" && hasMultiple()) {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  // Touch handling: horizontal swipe to navigate, pinch to zoom (image only).
  let touchStartX = 0;
  let touchStartY = 0;
  let touchTracking = false;
  let pinching = false;

  const handleTouchStart = (e: TouchEvent) => {
    if (e.touches.length === 2) {
      pinching = true;
      touchTracking = false;
      return;
    }
    if (e.touches.length === 1) {
      pinching = false;
      touchTracking = true;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }
  };

  const handleTouchEnd = (e: TouchEvent) => {
    if (pinching) {
      // A pinch gesture just ended; toggle zoom for images instead of swiping.
      if (active() && !isVideo(active()!)) {
        setZoomed((z) => !z);
      }
      pinching = false;
      return;
    }
    if (!touchTracking) return;
    touchTracking = false;
    const touch = e.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - touchStartX;
    const dy = touch.clientY - touchStartY;
    // Only treat as a swipe when horizontal motion dominates and we are not
    // zoomed in (so a zoomed image can be panned by the browser).
    if (
      !zoomed() &&
      hasMultiple() &&
      Math.abs(dx) > SWIPE_THRESHOLD &&
      Math.abs(dx) > Math.abs(dy)
    ) {
      if (dx > 0) {
        goPrev();
      } else {
        goNext();
      }
    }
  };

  const stop = (e: Event) => e.stopPropagation();

  const toggleZoom = (e: MouseEvent) => {
    e.stopPropagation();
    setZoomed((z) => !z);
  };

  return (
    <Portal>
      <div
        ref={dialogRef}
        class="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center select-none"
        role="dialog"
        aria-modal="true"
        onClick={() => props.onClose()}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Close button */}
        <button
          ref={closeButtonRef}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            props.onClose();
          }}
          aria-label={t("lightbox.close")}
          class="absolute top-4 right-4 z-20 p-2 rounded-full bg-neutral-900/70 text-white hover:bg-neutral-800 transition-colors"
        >
          <svg
            class="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>

        {/* Counter */}
        <Show when={hasMultiple()}>
          <div class="absolute top-4 left-1/2 -translate-x-1/2 z-20 px-3 py-1 rounded-full bg-neutral-900/70 text-sm text-white">
            {t("lightbox.counter")
              .replace("{current}", String(clampedCurrent() + 1))
              .replace("{total}", String(count()))}
          </div>
        </Show>

        {/* Prev button */}
        <Show when={hasMultiple()}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goPrev();
            }}
            aria-label={t("lightbox.prev")}
            class="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 z-20 p-2 rounded-full bg-neutral-900/70 text-white hover:bg-neutral-800 transition-colors"
          >
            <svg
              class="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
        </Show>

        {/* Next button */}
        <Show when={hasMultiple()}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goNext();
            }}
            aria-label={t("lightbox.next")}
            class="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 z-20 p-2 rounded-full bg-neutral-900/70 text-white hover:bg-neutral-800 transition-colors"
          >
            <svg
              class="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
        </Show>

        {/* Media */}
        <Show when={active()}>
          <div
            class="relative max-w-full max-h-full flex flex-col items-center justify-center p-4"
            onClick={stop}
          >
            <Show
              when={!isVideo(active()!)}
              fallback={
                <video
                  src={mediaAttachmentUrl(active()!)}
                  controls
                  autoplay
                  muted
                  playsinline
                  class="max-w-[100vw] max-h-[90vh] object-contain"
                />
              }
            >
              <img
                src={mediaAttachmentUrl(active()!)}
                alt={active()!.name || ""}
                draggable={false}
                onClick={toggleZoom}
                class={`object-contain transition-transform duration-200 ${
                  zoomed()
                    ? "max-w-none max-h-none scale-150 cursor-zoom-out overflow-auto"
                    : "max-w-[100vw] max-h-[90vh] cursor-zoom-in"
                }`}
              />
            </Show>

            {/* Alt text */}
            <Show when={active()!.name}>
              <div class="mt-2 max-w-2xl px-3 py-1 text-center text-sm text-neutral-300">
                {active()!.name}
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </Portal>
  );
}

/**
 * Small helper hook: manage lightbox open/index state. Returns the state plus
 * an `open` callback intended to be wired into attachment click handlers.
 */
export function useMediaLightbox() {
  const [attachments, setAttachments] = createSignal<MediaAttachment[]>([]);
  const [index, setIndex] = createSignal(0);
  const [isOpen, setIsOpen] = createSignal(false);

  const open = (items: MediaAttachment[], startIndex: number) => {
    setAttachments(items);
    setIndex(startIndex);
    setIsOpen(true);
  };

  const close = () => setIsOpen(false);

  return { attachments, index, isOpen, open, close };
}

/**
 * Renders an attachment grid where each item opens the lightbox on tap.
 * `onOpen` receives the tapped index; callers should stopPropagation in their
 * own click handler context if the grid is nested inside a navigable element.
 */
interface AttachmentGridProps {
  attachments: MediaAttachment[];
  onOpen: (index: number, e: MouseEvent) => void;
  class?: string;
}

export function AttachmentGrid(props: AttachmentGridProps) {
  const altText = useI18n().t;
  return (
    <div
      class={`mt-3 grid gap-1 rounded-xl overflow-hidden ${
        props.attachments.length === 1 ? "grid-cols-1" : "grid-cols-2"
      } ${props.class ?? ""}`}
    >
      <For each={props.attachments}>
        {(m, idx) => (
          <Show
            when={isVideo(m)}
            fallback={
              <button
                type="button"
                onClick={(e) => props.onOpen(idx(), e)}
                aria-label={m.name || altText("lightbox.zoomIn")}
                class="block w-full cursor-zoom-in"
              >
                <img
                  src={mediaAttachmentUrl(m)}
                  alt={m.name || ""}
                  loading="lazy"
                  decoding="async"
                  class="w-full object-cover max-h-96 pointer-events-none"
                />
              </button>
            }
          >
            <button
              type="button"
              onClick={(e) => props.onOpen(idx(), e)}
              aria-label={altText("lightbox.zoomIn")}
              class="relative block w-full"
            >
              <video
                src={mediaAttachmentUrl(m)}
                class="w-full object-cover max-h-96 pointer-events-none"
                preload="metadata"
              />
              <span class="absolute inset-0 flex items-center justify-center">
                <span class="flex items-center justify-center w-12 h-12 rounded-full bg-black/60 text-white">
                  <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </span>
              </span>
            </button>
          </Show>
        )}
      </For>
    </div>
  );
}

export default MediaLightbox;
