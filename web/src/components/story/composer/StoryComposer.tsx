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

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  StoryCanvas,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
} from '../../../lib/story-canvas';
import { useCanvasInteraction, type SnapGuide } from '../../../hooks/useCanvasInteraction';
import { useVideoTransform } from '../../../hooks/useVideoTransform';
import type { StoryOverlay } from '../../../types';
import { TextEditorModal } from '../TextEditorModal';
import { StoryComposerCanvas } from './StoryComposerCanvas';
import { StoryComposerFooter } from './StoryComposerFooter';
import { StoryComposerHeader } from './StoryComposerHeader';
import { StoryComposerSelectionToolbar } from './StoryComposerSelectionToolbar';
import {
  StoryComposerDrawingPanel,
  StoryComposerQuickActions,
  StoryComposerStickerPanel,
} from './StoryComposerPanels';
import { StoryComposerStatusOverlay } from './StoryComposerStatusOverlay';
import { useStoryBackground } from './useStoryBackground';
import { useStoryCanvasRenderer } from './useStoryCanvasRenderer';
import { useStoryVideo } from './useStoryVideo';
import { useStoryTextEditor } from './useStoryTextEditor';
import { useStoryLayerActions } from './useStoryLayerActions';
import { useStoryPost } from './useStoryPost';
import { useStoryImageUpload } from './useStoryImageUpload';

interface StoryComposerProps {
  onClose: () => void;
  onSuccess: () => void;
}

// File size limits
const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100MB

type ToolTab = 'background' | 'text' | 'sticker' | 'draw' | 'video' | 'none';

export function StoryComposer({ onClose, onSuccess }: StoryComposerProps) {
  // Canvas state
  const [storyCanvas, setStoryCanvas] = useState<StoryCanvas | null>(null);
  const [renderKey, setRenderKey] = useState(0);
  const bumpRenderKey = useCallback(() => setRenderKey(k => k + 1), [setRenderKey]);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement>(null);

  // UI state
  const [activeTab, setActiveTab] = useState<ToolTab>('none');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [displayScale, setDisplayScale] = useState(1);

  // Background state
  const [backgroundType] = useState<'solid' | 'gradient'>('gradient');
  const [solidColor] = useState('#000000');
  const [gradientColors] = useState(['#667eea', '#764ba2']);
  const [gradientAngle] = useState(135);

  // Overlay state (for interactive elements)
  const [overlays] = useState<StoryOverlay[]>([]);

  // Snap guides state
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);

  // Caption and audience state (Instagram-style)
  const [caption, setCaption] = useState('');
  const [showToolPanel, setShowToolPanel] = useState(false);
  const [activeTool, setActiveTool] = useState<'text' | 'sticker' | 'music' | 'effect' | 'resize' | null>(null);

  // Double-tap detection for text editing
  const [lastTapTime, setLastTapTime] = useState(0);

  // --- Custom hooks ---

  const {
    videoFile,
    videoPreview,
    videoInputRef,
    videoRef,
    videoScale,
    setVideoScale,
    videoPosition,
    setVideoPosition,
    videoRotation,
    setVideoRotation,
    ffmpegReady,
    ffmpegLoading,
    handleVideoSelect,
  } = useStoryVideo({
    storyCanvas,
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
    canvas: storyCanvas,
    displayScale: displayScale,
    onUpdate: bumpRenderKey,
    onSnapGuidesChange: setSnapGuides,
  });

  const postActions = useStoryPost({
    storyCanvas,
    videoFile,
    videoScale,
    videoPosition,
    videoRotation,
    displayScale,
    ffmpegReady,
    overlays,
    setError,
    onSuccess,
    onClose,
  });

  const textEditor = useStoryTextEditor({
    storyCanvas,
    selectLayer,
    onUpdate: () => {
      bumpRenderKey();
      setActiveTab('none');
    },
  });

  const layerActions = useStoryLayerActions({
    storyCanvas,
    selectedLayerId: interactionState.selectedLayerId,
    selectLayer,
    onUpdate: bumpRenderKey,
  });

  const imageUpload = useStoryImageUpload({
    storyCanvas,
    selectLayer,
    setUploading: (value) => setUploading(value),
    setError: (message) => setError(message),
    onUpdate: () => {
      bumpRenderKey();
      setActiveTab('none');
    },
  });

  const videoTransform = useVideoTransform({
    enabled: !!videoPreview,
    scale: videoScale,
    position: videoPosition,
    rotation: videoRotation,
    setScale: setVideoScale,
    setPosition: setVideoPosition,
    setRotation: setVideoRotation,
  });

  // --- Effects ---

  // Initialize canvas
  useEffect(() => {
    const canvas = new StoryCanvas();
    canvas.setBackground({
      type: 'gradient',
      colors: gradientColors,
      angle: gradientAngle,
    });
    setStoryCanvas(canvas);
    canvas.render().then(() => {
      setRenderKey(k => k + 1);
    });
  }, []);

  // Calculate display scale
  useEffect(() => {
    const updateScale = () => {
      if (canvasContainerRef.current) {
        const containerWidth = canvasContainerRef.current.clientWidth;
        const scale = CANVAS_WIDTH / containerWidth;
        setDisplayScale(scale);
      }
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  // Set container ref for interaction
  useEffect(() => {
    if (canvasContainerRef.current) {
      setContainerRef(canvasContainerRef.current);
    }
  }, [setContainerRef]);

  useStoryCanvasRenderer({
    storyCanvas,
    displayCanvasRef,
    renderKey,
    snapGuides,
    getSelectedLayer,
  });

  useStoryBackground({
    storyCanvas,
    backgroundType,
    solidColor,
    gradientColors,
    gradientAngle,
    onUpdate: bumpRenderKey,
  });

  // --- Event handlers ---

  const handleTabChange = (tab: ToolTab) => {
    setActiveTab(tab === activeTab ? 'none' : tab);
    if (tab === 'draw') {
      setMode('draw');
    } else {
      setMode('select');
    }
  };

  // Custom pointer down that detects double-tap for text editing
  const handleCanvasPointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const now = Date.now();

    if (storyCanvas && canvasContainerRef.current) {
      const rect = canvasContainerRef.current.getBoundingClientRect();
      const scale = CANVAS_WIDTH / rect.width;
      const canvasX = (clientX - rect.left) * scale;
      const canvasY = (clientY - rect.top) * scale;

      const hitLayer = storyCanvas.hitTest(canvasX, canvasY);
      if (hitLayer && hitLayer.type === 'text') {
        if (now - lastTapTime < 300 && interactionState.selectedLayerId === hitLayer.id) {
          textEditor.handleEditText(hitLayer.id);
          setLastTapTime(0);
          return;
        }
        setLastTapTime(now);
      } else {
        setLastTapTime(0);
      }
    }

    handlePointerDown(e);
  };

  // Add emoji sticker
  const handleAddEmoji = (emoji: string) => {
    if (!storyCanvas) return;
    const layer = storyCanvas.createStickerLayer(emoji, true);
    storyCanvas.addLayer(layer);
    selectLayer(layer.id);
    bumpRenderKey();
  };

  // Handle tool button click
  const handleToolClick = (tool: 'text' | 'sticker' | 'music' | 'effect' | 'resize') => {
    if (tool === 'text') {
      textEditor.handleAddText();
      return;
    }
    if (tool === 'sticker') {
      setActiveTool(activeTool === 'sticker' ? null : 'sticker');
      setShowToolPanel(activeTool !== 'sticker');
      handleTabChange('sticker');
      return;
    }
    setActiveTool(activeTool === tool ? null : tool);
    setShowToolPanel(activeTool !== tool);
  };

  // --- Derived state ---

  const selectedLayer = getSelectedLayer();
  const canPost = !!storyCanvas && (storyCanvas.getLayers().length > 1 || !!videoFile);

  const getDisplayDimensions = () => {
    if (!canvasContainerRef.current) return { width: 360, height: 640 };
    const width = canvasContainerRef.current.clientWidth;
    const height = (width * CANVAS_HEIGHT) / CANVAS_WIDTH;
    return { width, height };
  };

  const displayDimensions = getDisplayDimensions();

  // --- Render ---

  return (
    <div className="fixed inset-0 bg-neutral-900 z-51">
      {/* Full screen canvas area with overlay UI */}
      <div className="relative w-full h-full pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <StoryComposerCanvas
          canvasContainerRef={canvasContainerRef}
          displayCanvasRef={displayCanvasRef}
          displayDimensions={displayDimensions}
          videoPreview={videoPreview}
          videoRef={videoRef}
          videoPosition={videoPosition}
          videoScale={videoScale}
          videoRotation={videoRotation}
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
          onClose={onClose}
          activeTool={activeTool}
          onToolClick={handleToolClick}
        />

        <StoryComposerSelectionToolbar
          selectedLayer={selectedLayer}
          onEditText={textEditor.handleEditText}
          onBringToFront={layerActions.handleBringToFront}
          onSendToBack={layerActions.handleSendToBack}
          onDelete={layerActions.handleDeleteLayer}
        />

        <StoryComposerFooter
          caption={caption}
          onCaptionChange={setCaption}
          onPost={postActions.handlePost}
          canPost={canPost}
          posting={postActions.posting}
          progress={postActions.progress}
          videoFile={videoFile}
          ffmpegReady={ffmpegReady}
          error={error}
          onDismissError={() => setError(null)}
        />

        <StoryComposerStickerPanel
          open={showToolPanel && activeTool === 'sticker'}
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
          uploading={uploading}
          hasVideo={!!videoFile}
          isDrawing={interactionState.mode === 'draw'}
          onSelectImage={() => imageUpload.fileInputRef.current?.click()}
          onSelectVideo={() => videoInputRef.current?.click()}
          onToggleDraw={() => handleTabChange('draw')}
        />

        <StoryComposerDrawingPanel
          isDrawing={interactionState.mode === 'draw'}
          drawingSettings={drawingSettings}
          onDrawingSettingsChange={setDrawingSettings}
          onClear={clearDrawing}
          onUndo={undoDrawing}
          onDone={() => setMode('select')}
        />

        <StoryComposerStatusOverlay
          ffmpegLoading={ffmpegLoading}
          posting={postActions.posting}
          progress={postActions.progress}
        />
      </div>

      {/* Hidden file inputs */}
      <input
        ref={imageUpload.fileInputRef}
        type="file"
        accept="image/*"
        onChange={imageUpload.handleImageSelect}
        className="hidden"
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        onChange={handleVideoSelect}
        className="hidden"
      />

      {/* Text editor modal */}
      <TextEditorModal
        isOpen={textEditor.isTextEditorOpen}
        onClose={textEditor.handleTextEditorClose}
        onSave={textEditor.handleTextSave}
        initialText={textEditor.getInitialTextData()}
      />
    </div>
  );
}

export default StoryComposer;
