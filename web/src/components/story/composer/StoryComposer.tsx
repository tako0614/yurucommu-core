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

import { createEffect, createSignal, onCleanup } from "solid-js";
import { useAtomValue } from "solid-jotai";
import { inhabitedScopeAtom } from "../../../atoms/scope.ts";
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
  StoryComposerQuickActions,
  StoryComposerStickerPanel,
} from "./StoryComposerPanels.tsx";
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
  // Inhabited scope seeds the story audience (B0.3): a community scope binds the
  // story to that community; personal leaves it a personal story.
  const scope = useAtomValue(inhabitedScopeAtom);

  // Canvas state
  const [storyCanvas, setStoryCanvas] = createSignal<StoryCanvas | null>(null);
  const [renderKey, setRenderKey] = createSignal(0);
  const bumpRenderKey = () => setRenderKey((k) => k + 1);
  let canvasContainerRef!: HTMLDivElement;
  let displayCanvasRef!: HTMLCanvasElement;

  // UI state
  const [activeTab, setActiveTab] = createSignal<ToolTab>("none");
  const [uploading, setUploading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [displayScale, setDisplayScale] = createSignal(1);

  // Background state
  const [backgroundType] = createSignal<"solid" | "gradient">("gradient");
  const [solidColor] = createSignal("#000000");
  const [gradientColors] = createSignal(["#667eea", "#764ba2"]);
  const [gradientAngle] = createSignal(135);

  // Overlay state (for interactive elements)
  const [overlays] = createSignal<StoryOverlay[]>([]);

  // Snap guides state
  const [snapGuides, setSnapGuides] = createSignal<SnapGuide[]>([]);

  // Caption and audience state (Instagram-style)
  const [caption, setCaption] = createSignal("");
  const [showToolPanel, setShowToolPanel] = createSignal(false);
  const [activeTool, setActiveTool] = createSignal<
    "text" | "sticker" | "music" | "effect" | "resize" | null
  >(null);

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
    get communityApId() {
      const s = scope();
      return s.kind === "community" ? s.ap_id : undefined;
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

  // Initialize canvas
  createEffect(() => {
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

  // Calculate display scale
  createEffect(() => {
    const updateScale = () => {
      if (canvasContainerRef) {
        const containerWidth = canvasContainerRef.clientWidth;
        const scale = CANVAS_WIDTH / containerWidth;
        setDisplayScale(scale);
      }
    };
    updateScale();
    window.addEventListener("resize", updateScale);
    onCleanup(() => window.removeEventListener("resize", updateScale));
  });

  // Set container ref for interaction
  createEffect(() => {
    if (canvasContainerRef) {
      setContainerRef(canvasContainerRef);
    }
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

  // Handle tool button click
  const handleToolClick = (
    tool: "text" | "sticker" | "music" | "effect" | "resize",
  ) => {
    if (tool === "text") {
      textEditor.handleAddText();
      return;
    }
    if (tool === "sticker") {
      setActiveTool(activeTool() === "sticker" ? null : "sticker");
      setShowToolPanel(activeTool() !== "sticker");
      handleTabChange("sticker");
      return;
    }
    setActiveTool(activeTool() === tool ? null : tool);
    setShowToolPanel(activeTool() !== tool);
  };

  // --- Derived state ---

  const selectedLayer = () => getSelectedLayer();
  const canPost = () => {
    const sc = storyCanvas();
    return !!sc && (sc.getLayers().length > 1 || !!video.videoFile());
  };

  const getDisplayDimensions = () => {
    if (!canvasContainerRef) return { width: 360, height: 640 };
    const width = canvasContainerRef.clientWidth;
    const height = (width * CANVAS_HEIGHT) / CANVAS_WIDTH;
    return { width, height };
  };

  // --- Render ---

  return (
    <div class="fixed inset-0 bg-neutral-900 z-51">
      {/* Full screen canvas area with overlay UI */}
      <div class="relative w-full h-full pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <StoryComposerCanvas
          canvasContainerRef={canvasContainerRef}
          displayCanvasRef={displayCanvasRef}
          displayDimensions={getDisplayDimensions()}
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

        <StoryComposerHeader
          onClose={props.onClose}
          activeTool={activeTool()}
          onToolClick={handleToolClick}
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

        <StoryComposerQuickActions
          uploading={uploading()}
          hasVideo={!!video.videoFile()}
          isDrawing={interactionState().mode === "draw"}
          onSelectImage={() => imageUpload.fileInputRef?.click()}
          onSelectVideo={() => video.videoInputRef?.click()}
          onToggleDraw={() => handleTabChange("draw")}
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
      </div>

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
  );
}

export default StoryComposer;
