/**
 * Story Composer
 *
 * Canvas-first story editor with WYSIWYG rendering.
 * All elements are rendered to Canvas for perfect preview-output matching.
 *
 * This is the main orchestrator that delegates to:
 * - Sub-components: StoryComposerCanvas, StoryComposerHeader, StoryComposerFooter, etc.
 * - Custom hooks: useStoryVideo, useStoryBackground, useStoryCanvasRenderer,
 *   useStoryTextEditor, useStoryLayerActions, useStoryPost, useStoryImageUpload
 */

import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { useI18n } from "../../../lib/i18n.tsx";
import { useDialog } from "../../../lib/useDialog.ts";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  StoryCanvas,
} from "../../../lib/story-canvas.ts";
import {
  type SnapGuide,
  useCanvasInteraction,
} from "../../../hooks/useCanvasInteraction.ts";
import { useVideoTransform } from "../../../hooks/useVideoTransform.ts";
import type { StoryOverlay } from "../../../types/index.ts";
import { TextEditorModal } from "../TextEditorModal.tsx";
import { StoryComposerCanvas } from "./StoryComposerCanvas.tsx";
import { StoryComposerFooter } from "./StoryComposerFooter.tsx";
import { StoryComposerHeader } from "./StoryComposerHeader.tsx";
import { StoryComposerSelectionToolbar } from "./StoryComposerSelectionToolbar.tsx";
import {
  StoryComposerDrawingPanel,
  StoryComposerStickerPanel,
} from "./StoryComposerPanels.tsx";
import { StoryComposerBackgroundPanel } from "./StoryComposerBackgroundPanel.tsx";
import { StoryComposerStatusOverlay } from "./StoryComposerStatusOverlay.tsx";
import { useStoryBackground } from "./useStoryBackground.ts";
import { useStoryCanvasRenderer } from "./useStoryCanvasRenderer.ts";
import { useStoryVideo } from "./useStoryVideo.ts";
import { useStoryTextEditor } from "./useStoryTextEditor.ts";
import { useStoryLayerActions } from "./useStoryLayerActions.ts";
import { useStoryPost } from "./useStoryPost.ts";
import { useStoryImageUpload } from "./useStoryImageUpload.ts";

interface StoryComposerProps {
  onClose: () => void;
  onSuccess: () => void;
}

// File size limits
const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100MB

type ToolTab = "background" | "text" | "sticker" | "draw" | "video" | "none";

export function StoryComposer(props: StoryComposerProps) {
  const { t } = useI18n();

  // Canvas state
  const [storyCanvas, setStoryCanvas] = createSignal<StoryCanvas | null>(null);
  const [renderKey, setRenderKey] = createSignal(0);
  const bumpRenderKey = () => setRenderKey((k) => k + 1);
  // Element bindings owned by this component but rendered by StoryComposerCanvas.
  // Wired via callback refs (passing a bare `let` by value would never assign).
  let canvasContainerRef: HTMLDivElement | undefined;
  let displayCanvasRef: HTMLCanvasElement | undefined;

  // UI state
  const [activeTab, setActiveTab] = createSignal<ToolTab>("none");
  const [uploading, setUploading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [displayScale, setDisplayScale] = createSignal(1);
  // Backing-store size of the display canvas. Tracks the stage's CSS size ×
  // devicePixelRatio (capped at 2) so the WYSIWYG canvas stays crisp instead of
  // being a fixed low-res bitmap upscaled by CSS. Always 9:16 (matches the
  // 1080×1920 authoring canvas).
  const [displayDims, setDisplayDims] = createSignal({
    width: 540,
    height: 960,
  });

  // Background state — editable via the background panel (preset swatches +
  // custom solid/gradient picker). Defaults to the signature purple gradient.
  const [backgroundType, setBackgroundType] = createSignal<
    "solid" | "gradient"
  >("gradient");
  const [solidColor, setSolidColor] = createSignal("#000000");
  const [gradientColors, setGradientColors] = createSignal([
    "#667eea",
    "#764ba2",
  ]);
  const [gradientAngle, setGradientAngle] = createSignal(135);

  // Overlay state (for interactive elements)
  const [overlays] = createSignal<StoryOverlay[]>([]);

  // Snap guides state
  const [snapGuides, setSnapGuides] = createSignal<SnapGuide[]>([]);

  // Caption and audience state (Instagram-style)
  const [caption, setCaption] = createSignal("");
  const [showToolPanel, setShowToolPanel] = createSignal(false);
  const [activeTool, setActiveTool] = createSignal<"text" | "sticker" | null>(
    null,
  );
  const [showBackgroundPanel, setShowBackgroundPanel] = createSignal(false);

  // Full-screen editor: trap focus, lock scroll, and dismiss on Escape. Escape
  // first dismisses any open tool/background panel (a forgiving step-back),
  // then closes the whole composer. The TextEditorModal registers ABOVE this on
  // the shared dialog stack, so while it is open Escape closes IT, not the sheet.
  let composerRootRef: HTMLDivElement | undefined;
  const handleComposerEscape = () => {
    if (showBackgroundPanel()) {
      setShowBackgroundPanel(false);
      return;
    }
    if (showToolPanel()) {
      setShowToolPanel(false);
      setActiveTool(null);
      return;
    }
    props.onClose();
  };
  useDialog({
    isOpen: () => true,
    onClose: handleComposerEscape,
    container: () => composerRootRef,
  });

  // Double-tap detection for text editing
  let lastTapTime = 0;

  // --- Custom hooks ---

  const video = useStoryVideo({
    get storyCanvas() {
      return storyCanvas();
    },
    setUploading: (value) => setUploading(value),
    setError: (message) => setError(message),
    maxVideoSize: MAX_VIDEO_SIZE,
    onBackgroundChange: bumpRenderKey,
  });

  // Canvas interaction hook
  const {
    state: interactionState,
    setMode,
    setContainerRef,
    selectLayer,
    getSelectedLayer,
    handlePointerDown,
    handleWheel,
    drawingSettings,
    setDrawingSettings,
    clearDrawing,
    undoDrawing,
  } = useCanvasInteraction({
    get canvas() {
      return storyCanvas();
    },
    get displayScale() {
      return displayScale();
    },
    onUpdate: bumpRenderKey,
    onSnapGuidesChange: setSnapGuides,
  });

  const postActions = useStoryPost({
    get storyCanvas() {
      return storyCanvas();
    },
    get videoFile() {
      return video.videoFile();
    },
    get videoScale() {
      return video.videoScale();
    },
    get videoPosition() {
      return video.videoPosition();
    },
    get videoRotation() {
      return video.videoRotation();
    },
    get displayScale() {
      return displayScale();
    },
    get ffmpegReady() {
      return video.ffmpegReady();
    },
    get overlays() {
      return overlays();
    },
    get caption() {
      return caption();
    },
    // A story belongs to you (personal), decoupled from the home view filter —
    // narrowing your view never re-aims where a story lands.
    get communityApId() {
      return undefined;
    },
    setError,
    onSuccess: props.onSuccess,
    onClose: props.onClose,
  });

  const textEditor = useStoryTextEditor({
    get storyCanvas() {
      return storyCanvas();
    },
    selectLayer,
    onUpdate: () => {
      bumpRenderKey();
      setActiveTab("none");
    },
  });

  const layerActions = useStoryLayerActions({
    get storyCanvas() {
      return storyCanvas();
    },
    get selectedLayerId() {
      return interactionState().selectedLayerId;
    },
    selectLayer,
    onUpdate: bumpRenderKey,
  });

  const imageUpload = useStoryImageUpload({
    get storyCanvas() {
      return storyCanvas();
    },
    selectLayer,
    setUploading: (value) => setUploading(value),
    setError: (message) => setError(message),
    onUpdate: () => {
      bumpRenderKey();
      setActiveTab("none");
    },
  });

  const videoTransform = useVideoTransform({
    get enabled() {
      return !!video.videoPreview();
    },
    get scale() {
      return video.videoScale();
    },
    get position() {
      return video.videoPosition();
    },
    get rotation() {
      return video.videoRotation();
    },
    setScale: video.setVideoScale,
    setPosition: video.setVideoPosition,
    setRotation: video.setVideoRotation,
  });

  // --- Effects ---

  // Initialize the canvas ONCE. This must be onMount, not createEffect: reading
  // gradientColors()/gradientAngle() inside a createEffect tracked them, so every
  // gradient tweak re-ran this, built a fresh StoryCanvas (whose layers start
  // empty), and discarded all the user's text/stickers/drawings. Live background
  // changes are applied to the existing canvas by useStoryBackground; this just
  // seeds the initial background so there is no first-frame flash.
  onMount(() => {
    const canvas = new StoryCanvas();
    canvas.setBackground({
      type: "gradient",
      colors: gradientColors(),
      angle: gradientAngle(),
    });
    setStoryCanvas(canvas);
    canvas.render().then(() => {
      setRenderKey((k) => k + 1);
    });
  });

  // Track the stage size: drives both the CSS→canvas hit-test scale and the
  // display canvas backing-store resolution (crisp WYSIWYG). Called once the
  // container ref lands (real layout) and on every viewport resize.
  const syncStageSize = () => {
    if (!canvasContainerRef) return;
    const containerWidth = canvasContainerRef.clientWidth;
    if (containerWidth <= 0) return;
    setDisplayScale(CANVAS_WIDTH / containerWidth);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(containerWidth * dpr);
    setDisplayDims({
      width,
      height: Math.round((width * CANVAS_HEIGHT) / CANVAS_WIDTH),
    });
    // Resizing the canvas backing store clears it — redraw at the new size.
    bumpRenderKey();
  };

  createEffect(() => {
    syncStageSize();
    window.addEventListener("resize", syncStageSize);
    onCleanup(() => window.removeEventListener("resize", syncStageSize));
  });

  useStoryCanvasRenderer({
    get storyCanvas() {
      return storyCanvas();
    },
    get displayCanvasRef() {
      return displayCanvasRef;
    },
    get renderKey() {
      return renderKey();
    },
    get snapGuides() {
      return snapGuides();
    },
    getSelectedLayer,
  });

  useStoryBackground({
    get storyCanvas() {
      return storyCanvas();
    },
    get backgroundType() {
      return backgroundType();
    },
    get solidColor() {
      return solidColor();
    },
    get gradientColors() {
      return gradientColors();
    },
    get gradientAngle() {
      return gradientAngle();
    },
    onUpdate: bumpRenderKey,
  });

  // --- Event handlers ---

  const handleTabChange = (tab: ToolTab) => {
    setActiveTab(tab === activeTab() ? "none" : tab);
    if (tab === "draw") {
      setMode("draw");
    } else {
      setMode("select");
    }
  };

  // Custom pointer down that detects double-tap for text editing
  const handleCanvasPointerDown = (e: MouseEvent | TouchEvent) => {
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    const now = Date.now();

    const sc = storyCanvas();
    if (sc && canvasContainerRef) {
      const rect = canvasContainerRef.getBoundingClientRect();
      const scale = CANVAS_WIDTH / rect.width;
      const canvasX = (clientX - rect.left) * scale;
      const canvasY = (clientY - rect.top) * scale;

      const hitLayer = sc.hitTest(canvasX, canvasY);
      if (hitLayer && hitLayer.type === "text") {
        if (
          now - lastTapTime < 300 &&
          interactionState().selectedLayerId === hitLayer.id
        ) {
          textEditor.handleEditText(hitLayer.id);
          lastTapTime = 0;
          return;
        }
        lastTapTime = now;
      } else {
        lastTapTime = 0;
      }
    }

    handlePointerDown(e);
  };

  // Add emoji sticker
  const handleAddEmoji = (emoji: string) => {
    const sc = storyCanvas();
    if (!sc) return;
    const layer = sc.createStickerLayer(emoji, true);
    sc.addLayer(layer);
    selectLayer(layer.id);
    bumpRenderKey();
  };

  // --- Tool rail handlers (single top-right rail, Instagram layout) ---

  const handleOpenText = () => {
    setShowBackgroundPanel(false);
    setShowToolPanel(false);
    setActiveTool(null);
    textEditor.handleAddText();
  };

  const handleToggleSticker = () => {
    setShowBackgroundPanel(false);
    const next = activeTool() !== "sticker";
    setActiveTool(next ? "sticker" : null);
    setShowToolPanel(next);
    handleTabChange("sticker");
  };

  const handleToggleDraw = () => {
    setShowBackgroundPanel(false);
    setShowToolPanel(false);
    setActiveTool(null);
    handleTabChange("draw");
  };

  const handleToggleBackground = () => {
    setShowToolPanel(false);
    setActiveTool(null);
    setMode("select");
    setShowBackgroundPanel((v) => !v);
  };

  const handlePickImage = () => {
    setShowBackgroundPanel(false);
    imageUpload.fileInputRef?.click();
  };

  const handlePickVideo = () => {
    setShowBackgroundPanel(false);
    video.videoInputRef?.click();
  };

  // --- Derived state ---

  const selectedLayer = () => getSelectedLayer();
  // canPost / isCanvasEmpty read the (non-reactive) layer array, so they take a
  // dependency on renderKey() — which bumps on every canvas mutation — to stay
  // in sync when layers are added or removed.
  const canPost = () => {
    renderKey();
    const sc = storyCanvas();
    return !!sc && (sc.getLayers().length > 1 || !!video.videoFile());
  };
  // Empty == only the background layer and no video: show the "tap to add
  // text" affordance so a fresh canvas isn't a blank stage.
  const isCanvasEmpty = () => {
    renderKey();
    const sc = storyCanvas();
    return !!sc && sc.getLayers().length <= 1 && !video.videoFile();
  };

  // --- Render ---

  return (
    <div
      ref={(el) => (composerRootRef = el)}
      role="dialog"
      aria-modal="true"
      aria-label={t("story.composerAriaLabel")}
      class="fixed inset-0 z-[51] flex items-center justify-center bg-black"
    >
      {/* Portrait 9:16 stage. Every overlay control anchors to THIS card (not
          the viewport), so the editor reads correctly at any width: a centered
          phone-shaped column on desktop, full-bleed on mobile. */}
      <div
        class="relative overflow-hidden bg-neutral-950 shadow-2xl sm:rounded-3xl"
        style={{
          height: "min(100dvh, calc(100vw * 16 / 9))",
          "aspect-ratio": "9 / 16",
          "max-width": "100vw",
        }}
      >
        <StoryComposerCanvas
          canvasContainerRef={(el) => {
            canvasContainerRef = el;
            setContainerRef(el);
            // First real layout — compute the display scale/resolution now.
            queueMicrotask(syncStageSize);
          }}
          displayCanvasRef={(el) => {
            displayCanvasRef = el;
          }}
          displayDimensions={displayDims()}
          videoPreview={video.videoPreview()}
          videoRef={video.videoRef}
          videoPosition={video.videoPosition()}
          videoScale={video.videoScale()}
          videoRotation={video.videoRotation()}
          onCanvasPointerDown={handleCanvasPointerDown}
          onCanvasWheel={handleWheel}
          onVideoPointerDown={videoTransform.handlePointerDown}
          onVideoPointerMove={videoTransform.handlePointerMove}
          onVideoPointerUp={videoTransform.handlePointerUp}
          onVideoWheel={videoTransform.handleWheel}
          onVideoTouchStart={videoTransform.handleTouchStart}
          onVideoTouchMove={videoTransform.handleTouchMove}
          onVideoTouchEnd={videoTransform.handleTouchEnd}
        />

        {/* Empty-canvas affordance — only a background, nothing placed yet. */}
        <Show when={isCanvasEmpty()}>
          <div class="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center">
            <button
              type="button"
              onClick={handleOpenText}
              class="pointer-events-auto rounded-full bg-black/30 px-5 py-2.5 text-sm font-medium text-white/90 shadow-md backdrop-blur-sm"
            >
              {t("story.tapToAddText")}
            </button>
          </div>
        </Show>

        <StoryComposerHeader
          onClose={props.onClose}
          onText={handleOpenText}
          onSticker={handleToggleSticker}
          stickerActive={activeTool() === "sticker"}
          onDraw={handleToggleDraw}
          drawActive={interactionState().mode === "draw"}
          onImage={handlePickImage}
          onVideo={handlePickVideo}
          hasVideo={!!video.videoFile()}
          onBackground={handleToggleBackground}
          backgroundActive={showBackgroundPanel()}
          uploading={uploading()}
        />

        <StoryComposerSelectionToolbar
          selectedLayer={selectedLayer()}
          onEditText={textEditor.handleEditText}
          onBringToFront={layerActions.handleBringToFront}
          onSendToBack={layerActions.handleSendToBack}
          onDelete={layerActions.handleDeleteLayer}
        />

        <StoryComposerFooter
          caption={caption()}
          onCaptionChange={setCaption}
          onPost={postActions.handlePost}
          canPost={canPost()}
          posting={postActions.posting()}
          progress={postActions.progress()}
          videoFile={video.videoFile()}
          ffmpegReady={video.ffmpegReady()}
          error={error()}
          onDismissError={() => setError(null)}
          scopeLabel={null}
        />

        <StoryComposerStickerPanel
          open={showToolPanel() && activeTool() === "sticker"}
          onAddEmoji={(emoji) => {
            handleAddEmoji(emoji);
            setShowToolPanel(false);
            setActiveTool(null);
          }}
          onClose={() => {
            setShowToolPanel(false);
            setActiveTool(null);
          }}
        />

        <StoryComposerBackgroundPanel
          open={showBackgroundPanel()}
          fillType={backgroundType()}
          solidColor={solidColor()}
          gradientColors={gradientColors()}
          gradientAngle={gradientAngle()}
          onSolidColorChange={(color) => {
            setBackgroundType("solid");
            setSolidColor(color);
          }}
          onGradientChange={(colors, angle) => {
            setBackgroundType("gradient");
            setGradientColors(colors);
            setGradientAngle(angle);
          }}
          onFillTypeChange={setBackgroundType}
          onClose={() => setShowBackgroundPanel(false)}
        />

        <StoryComposerDrawingPanel
          isDrawing={interactionState().mode === "draw"}
          drawingSettings={drawingSettings()}
          onDrawingSettingsChange={setDrawingSettings}
          onClear={clearDrawing}
          onUndo={undoDrawing}
          onDone={() => setMode("select")}
        />

        <StoryComposerStatusOverlay
          ffmpegLoading={video.ffmpegLoading()}
          posting={postActions.posting()}
          progress={postActions.progress()}
        />

        {/* Hidden file inputs */}
        <input
          ref={(el) => {
            imageUpload.fileInputRef = el;
          }}
          type="file"
          accept="image/*"
          onInput={imageUpload.handleImageSelect}
          class="hidden"
        />
        <input
          ref={(el) => {
            video.videoInputRef = el;
          }}
          type="file"
          accept="video/*"
          onInput={video.handleVideoSelect}
          class="hidden"
        />

        {/* Text editor modal */}
        <TextEditorModal
          isOpen={textEditor.isTextEditorOpen()}
          onClose={textEditor.handleTextEditorClose}
          onSave={textEditor.handleTextSave}
          initialText={textEditor.getInitialTextData()}
        />
      </div>
    </div>
  );
}

export default StoryComposer;
