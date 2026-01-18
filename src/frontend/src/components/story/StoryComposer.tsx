/**
 * Story Composer
 *
 * Canvas-first story editor with WYSIWYG rendering.
 * All elements are rendered to Canvas for perfect preview-output matching.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { createStory, uploadMedia } from '../../lib/api';
import {
  StoryCanvas,
  createStoryCanvas,
  Layer,
  TextLayer,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
} from '../../lib/storyCanvas';
import {
  exportCanvasWithVideo,
  FFmpegError,
  VideoTransform,
} from '../../lib/ffmpeg';
import { useCanvasInteraction, SnapGuide } from '../../hooks/useCanvasInteraction';
import { useVideoTransform } from '../../hooks/useVideoTransform';
import { StoryOverlay } from '../../types';
import { TextEditorModal, TextData } from './TextEditorModal';
import { StoryComposerCanvas } from './composer/StoryComposerCanvas';
import { StoryComposerFooter } from './composer/StoryComposerFooter';
import { StoryComposerHeader } from './composer/StoryComposerHeader';
import { StoryComposerSelectionToolbar } from './composer/StoryComposerSelectionToolbar';
import {
  StoryComposerDrawingPanel,
  StoryComposerQuickActions,
  StoryComposerStickerPanel,
} from './composer/StoryComposerPanels';
import { StoryComposerStatusOverlay } from './composer/StoryComposerStatusOverlay';
import { useStoryBackground } from './composer/useStoryBackground';
import { useStoryCanvasRenderer } from './composer/useStoryCanvasRenderer';
import { useStoryVideo } from './composer/useStoryVideo';

interface StoryComposerProps {
  onClose: () => void;
  onSuccess: () => void;
}

// File size limits
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100MB

type ToolTab = 'background' | 'text' | 'sticker' | 'draw' | 'video' | 'none';

export function StoryComposer({ onClose, onSuccess }: StoryComposerProps) {
  // Canvas state
  const [storyCanvas, setStoryCanvas] = useState<StoryCanvas | null>(null);
  const [renderKey, setRenderKey] = useState(0);
  const bumpRenderKey = useCallback(() => setRenderKey(k => k + 1), [setRenderKey]);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // UI state
  const [activeTab, setActiveTab] = useState<ToolTab>('none');
  const [uploading, setUploading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [displayScale, setDisplayScale] = useState(1);

  // Background state
  const [backgroundType, setBackgroundType] = useState<'solid' | 'gradient'>('gradient');
  const [solidColor, setSolidColor] = useState('#000000');
  const [gradientColors, setGradientColors] = useState(['#667eea', '#764ba2']);
  const [gradientAngle, setGradientAngle] = useState(135);

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

  // Overlay state (for interactive elements)
  const [overlays, setOverlays] = useState<StoryOverlay[]>([]);

  // Track object URLs for cleanup to prevent memory leaks
  const objectUrlsRef = useRef<Set<string>>(new Set());

  // Text editor modal state
  const [isTextEditorOpen, setIsTextEditorOpen] = useState(false);
  const [editingTextLayerId, setEditingTextLayerId] = useState<string | null>(null);
  const [lastTapTime, setLastTapTime] = useState(0);

  // Snap guides state
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);

  // Caption and audience state (Instagram-style)
  const [caption, setCaption] = useState('');
  const [showToolPanel, setShowToolPanel] = useState(false);
  const [activeTool, setActiveTool] = useState<'text' | 'sticker' | 'music' | 'effect' | 'resize' | null>(null);

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

  // Initialize canvas
  useEffect(() => {
    const canvas = createStoryCanvas();

    // Set initial background
    canvas.setBackground({
      type: 'gradient',
      colors: gradientColors,
      angle: gradientAngle,
    });

    setStoryCanvas(canvas);

    // Initial render
    canvas.render().then(() => {
      setRenderKey(k => k + 1);
    });
  }, []);

  // Cleanup object URLs on unmount to prevent memory leaks
  useEffect(() => {
    const objectUrls = objectUrlsRef.current;
    return () => {
      objectUrls.forEach(url => {
        URL.revokeObjectURL(url);
      });
      objectUrls.clear();
    };
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

  // Handle image upload
  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !storyCanvas) return;

    if (!file.type.startsWith('image/')) {
      setError('画像ファイルを選択してください');
      return;
    }

    if (file.size > MAX_IMAGE_SIZE) {
      setError(`画像サイズが大きすぎます（最大${MAX_IMAGE_SIZE / 1024 / 1024}MB）`);
      return;
    }

    setUploading(true);
    try {
      const preview = URL.createObjectURL(file);
      // Track the object URL for cleanup
      objectUrlsRef.current.add(preview);
      const layer = await storyCanvas.createMediaLayer(preview);
      storyCanvas.addLayer(layer);
      selectLayer(layer.id);
      setRenderKey(k => k + 1);
      setActiveTab('none');
    } catch (err) {
      console.error('Failed to add image:', err);
      setError('画像の追加に失敗しました');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Open text editor modal (new text)
  const handleAddText = () => {
    setEditingTextLayerId(null);
    setIsTextEditorOpen(true);
  };

  // Open text editor modal (edit existing text)
  const handleEditText = useCallback((layerId: string) => {
    setEditingTextLayerId(layerId);
    setIsTextEditorOpen(true);
  }, []);

  // Get initial text data for modal (when editing existing text)
  const getInitialTextData = useCallback((): TextData | undefined => {
    if (!editingTextLayerId || !storyCanvas) return undefined;
    const layer = storyCanvas.getLayer(editingTextLayerId);
    if (!layer || layer.type !== 'text') return undefined;
    const textLayer = layer as TextLayer;
    return {
      content: textLayer.content,
      fontFamily: textLayer.fontFamily,
      fontSize: textLayer.fontSize,
      fontWeight: textLayer.fontWeight,
      fontStyle: textLayer.fontStyle,
      color: textLayer.color,
      backgroundColor: textLayer.backgroundColor,
      textAlign: textLayer.textAlign,
      stroke: textLayer.stroke,
    };
  }, [editingTextLayerId, storyCanvas]);

  // Save text from modal
  const handleTextSave = useCallback((textData: TextData) => {
    if (!storyCanvas) return;

    if (editingTextLayerId) {
      // Update existing layer
      storyCanvas.updateLayer(editingTextLayerId, {
        content: textData.content,
        fontFamily: textData.fontFamily,
        fontSize: textData.fontSize,
        fontWeight: textData.fontWeight,
        fontStyle: textData.fontStyle,
        color: textData.color,
        backgroundColor: textData.backgroundColor,
        textAlign: textData.textAlign,
        stroke: textData.stroke,
      });
    } else {
      // Create new layer with modal data
      const layer = storyCanvas.createTextLayer();
      layer.content = textData.content;
      layer.fontFamily = textData.fontFamily;
      layer.fontSize = textData.fontSize;
      layer.fontWeight = textData.fontWeight;
      layer.fontStyle = textData.fontStyle;
      layer.color = textData.color;
      layer.backgroundColor = textData.backgroundColor;
      layer.textAlign = textData.textAlign;
      layer.stroke = textData.stroke;
      storyCanvas.addLayer(layer);
      selectLayer(layer.id);
    }
    setRenderKey(k => k + 1);
    setActiveTab('none');
    setIsTextEditorOpen(false);
    setEditingTextLayerId(null);
  }, [storyCanvas, editingTextLayerId, selectLayer]);

  // Add emoji sticker
  const handleAddEmoji = (emoji: string) => {
    if (!storyCanvas) return;

    const layer = storyCanvas.createStickerLayer(emoji, true);
    storyCanvas.addLayer(layer);
    selectLayer(layer.id);
    setRenderKey(k => k + 1);
  };

  // Update selected layer
  const handleUpdateLayer = useCallback((updates: Partial<Layer>) => {
    if (!storyCanvas || !interactionState.selectedLayerId) return;

    storyCanvas.updateLayer(interactionState.selectedLayerId, updates);
    setRenderKey(k => k + 1);
  }, [storyCanvas, interactionState.selectedLayerId]);

  // Delete selected layer
  const handleDeleteLayer = useCallback(() => {
    if (!storyCanvas || !interactionState.selectedLayerId) return;

    storyCanvas.removeLayer(interactionState.selectedLayerId);
    selectLayer(null);
    setRenderKey(k => k + 1);
  }, [storyCanvas, interactionState.selectedLayerId, selectLayer]);

  // Bring to front
  const handleBringToFront = useCallback(() => {
    if (!storyCanvas || !interactionState.selectedLayerId) return;

    storyCanvas.bringToFront(interactionState.selectedLayerId);
    setRenderKey(k => k + 1);
  }, [storyCanvas, interactionState.selectedLayerId]);

  // Send to back
  const handleSendToBack = useCallback(() => {
    if (!storyCanvas || !interactionState.selectedLayerId) return;

    storyCanvas.sendToBack(interactionState.selectedLayerId);
    setRenderKey(k => k + 1);
  }, [storyCanvas, interactionState.selectedLayerId]);

  // Handle tool tab change
  const handleTabChange = (tab: ToolTab) => {
    setActiveTab(tab === activeTab ? 'none' : tab);

    // Switch interaction mode
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

    // Check for double-tap on text layer to edit
    if (storyCanvas && canvasContainerRef.current) {
      const rect = canvasContainerRef.current.getBoundingClientRect();
      const scale = CANVAS_WIDTH / rect.width;
      const canvasX = (clientX - rect.left) * scale;
      const canvasY = (clientY - rect.top) * scale;

      const hitLayer = storyCanvas.hitTest(canvasX, canvasY);
      if (hitLayer && hitLayer.type === 'text') {
        // Double-tap detection (within 300ms)
        if (now - lastTapTime < 300 && interactionState.selectedLayerId === hitLayer.id) {
          handleEditText(hitLayer.id);
          setLastTapTime(0);
          return;
        }
        setLastTapTime(now);
      } else {
        setLastTapTime(0);
      }
    }

    // Use normal pointer down (handles drag, pinch, rotate)
    handlePointerDown(e);
  };

  const videoTransform = useVideoTransform({
    enabled: !!videoPreview,
    scale: videoScale,
    position: videoPosition,
    rotation: videoRotation,
    setScale: setVideoScale,
    setPosition: setVideoPosition,
    setRotation: setVideoRotation,
  });

  // Calculate display duration based on content
  const calculateDuration = (): number => {
    if (!storyCanvas) return 5;

    const layers = storyCanvas.getLayers();
    let seconds = 3;

    const textLayers = layers.filter(l => l.type === 'text') as TextLayer[];
    seconds += textLayers.length * 2;

    for (const layer of textLayers) {
      seconds += Math.ceil(layer.content.length / 20);
    }

    return Math.max(3, Math.min(15, seconds));
  };

  // Post story
  const handlePost = async () => {
    if (!storyCanvas || posting) return;
    // Video mode requires FFmpeg to be ready
    if (videoFile && !ffmpegReady) {
      setError('動画処理の準備中です。しばらくお待ちください。');
      return;
    }

    setPosting(true);
    setProgress(0);
    setError(null);

    try {
      // Render canvas first
      await storyCanvas.render();
      const canvas = storyCanvas.getCanvas();

      let blob: Blob;
      let contentType: string;
      let duration: number;

      if (videoFile) {
        // Video mode: export canvas overlay on video through FFmpeg
        setProgress(10);
        const videoTransform: VideoTransform = {
          scale: videoScale,
          position: videoPosition,
          rotation: videoRotation,
          displayScale: displayScale,
        };
        const result = await exportCanvasWithVideo(
          canvas,
          videoFile,
          (p) => setProgress(10 + p * 0.6), // 10-70%
          videoTransform
        );
        blob = result.blob;
        contentType = 'video/mp4';
        duration = result.duration;
      } else {
        // Image mode: direct Canvas.toBlob() (no FFmpeg needed, faster)
        setProgress(10);
        blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (b) => {
              if (b) resolve(b);
              else reject(new Error('Failed to export canvas'));
            },
            'image/jpeg',
            0.92 // Quality 92%
          );
        });
        contentType = 'image/jpeg';
        duration = calculateDuration();
        setProgress(50);
      }

      // Upload to server
      setProgress(70);
      const filename = videoFile ? 'story.mp4' : 'story.jpg';
      const file = new File([blob], filename, { type: contentType });
      const result = await uploadMedia(file);

      // Create story
      setProgress(90);
      await createStory({
        attachment: {
          r2_key: result.r2_key,
          content_type: contentType,
        },
        displayDuration: `PT${Math.round(duration)}S`,
        overlays: overlays.length > 0 ? overlays : undefined,
      });

      setProgress(100);
      onSuccess();
      onClose();
    } catch (err) {
      console.error('Failed to create story:', err);
      if (err instanceof FFmpegError) {
        setError(`動画処理エラー: ${err.message}`);
      } else if (err instanceof Error) {
        setError(`エラー: ${err.message}`);
      } else {
        setError('ストーリーの作成に失敗しました');
      }
    } finally {
      setPosting(false);
      setProgress(0);
    }
  };

  const selectedLayer = getSelectedLayer();
  const canPost = !!storyCanvas && (storyCanvas.getLayers().length > 1 || !!videoFile);

  // Get display canvas dimensions
  const getDisplayDimensions = () => {
    if (!canvasContainerRef.current) return { width: 360, height: 640 };
    const width = canvasContainerRef.current.clientWidth;
    const height = (width * CANVAS_HEIGHT) / CANVAS_WIDTH;
    return { width, height };
  };

  const displayDimensions = getDisplayDimensions();

  // Handle tool button click
  const handleToolClick = (tool: 'text' | 'sticker' | 'music' | 'effect' | 'resize') => {
    if (tool === 'text') {
      handleAddText();
      return;
    }
    if (tool === 'sticker') {
      setActiveTool(activeTool === 'sticker' ? null : 'sticker');
      setShowToolPanel(activeTool !== 'sticker');
      handleTabChange('sticker');
      return;
    }
    // Other tools - toggle panel
    setActiveTool(activeTool === tool ? null : tool);
    setShowToolPanel(activeTool !== tool);
  };

  return (
    <div className="fixed inset-0 bg-black z-51">
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
          onEditText={handleEditText}
          onBringToFront={handleBringToFront}
          onSendToBack={handleSendToBack}
          onDelete={handleDeleteLayer}
        />

        <StoryComposerFooter
          caption={caption}
          onCaptionChange={setCaption}
          onPost={handlePost}
          canPost={canPost}
          posting={posting}
          progress={progress}
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
          onSelectImage={() => fileInputRef.current?.click()}
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
          posting={posting}
          progress={progress}
        />
      </div>

      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageSelect}
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
        isOpen={isTextEditorOpen}
        onClose={() => {
          setIsTextEditorOpen(false);
          setEditingTextLayerId(null);
        }}
        onSave={handleTextSave}
        initialText={getInitialTextData()}
      />
    </div>
  );
}

export default StoryComposer;
