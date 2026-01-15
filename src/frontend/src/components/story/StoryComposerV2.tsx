/**
 * Story Composer V2
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
  MediaLayer,
  StickerLayer,
  BackgroundFill,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  FONTS,
} from '../../lib/storyCanvas';
import {
  initFFmpeg,
  exportCanvasWithVideo,
  getVideoDuration,
  isVideoFile,
  FFmpegError,
} from '../../lib/ffmpeg';
import { useCanvasInteraction, InteractionMode, SnapGuide } from '../../hooks/useCanvasInteraction';
import { StoryOverlay } from '../../types';
import {
  BackgroundPanel,
  MediaPanel,
  StickerPanel,
  DrawingPanel,
} from './ToolPanel';
import { TextEditorModal, TextData } from './TextEditorModal';

interface StoryComposerV2Props {
  onClose: () => void;
  onSuccess: () => void;
}

// Instagram-style right side tool button (label left, icon right, right-aligned)
const ToolButton = ({
  icon,
  label,
  onClick,
  active = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}) => (
  <button
    onClick={onClick}
    className="flex items-center justify-end gap-3 w-full"
  >
    <span className="text-white text-sm font-medium drop-shadow-md">{label}</span>
    <span className={`w-11 h-11 flex items-center justify-center rounded-full ${
      active ? 'bg-white/30' : 'bg-neutral-800/80'
    }`}>
      {icon}
    </span>
  </button>
);

// Back arrow icon
const BackIcon = () => (
  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
  </svg>
);

// Effect/sparkle icon
const EffectIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
  </svg>
);

// Resize icon
const ResizeIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" />
  </svg>
);

// Music icon
const MusicIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
  </svg>
);

// Chevron down icon
const ChevronDownIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);

// Send arrow icon
const SendIcon = () => (
  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
  </svg>
);

// File size limits
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100MB

// Icons
const CloseIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const ImageIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);

const TextIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
  </svg>
);

const StickerIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const DrawIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
  </svg>
);

const BackgroundIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
  </svg>
);

const VideoIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
  </svg>
);

type ToolTab = 'background' | 'text' | 'sticker' | 'draw' | 'video' | 'none';

export function StoryComposerV2({ onClose, onSuccess }: StoryComposerV2Props) {
  // Canvas state
  const [storyCanvas, setStoryCanvas] = useState<StoryCanvas | null>(null);
  const [renderKey, setRenderKey] = useState(0);
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
  const [ffmpegReady, setFfmpegReady] = useState(false);
  const [ffmpegLoading, setFfmpegLoading] = useState(false);

  // Video mode state
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<number>(5);
  const videoInputRef = useRef<HTMLInputElement>(null);

  // Background state
  const [backgroundType, setBackgroundType] = useState<'solid' | 'gradient'>('gradient');
  const [solidColor, setSolidColor] = useState('#000000');
  const [gradientColors, setGradientColors] = useState(['#667eea', '#764ba2']);
  const [gradientAngle, setGradientAngle] = useState(135);

  // Overlay state (for interactive elements)
  const [overlays, setOverlays] = useState<StoryOverlay[]>([]);

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
    onUpdate: () => setRenderKey(k => k + 1),
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

  // Initialize FFmpeg only when video is selected (lazy loading)
  useEffect(() => {
    if (!videoFile) return;
    if (ffmpegReady) return;

    const loadFFmpeg = async () => {
      setFfmpegLoading(true);
      try {
        await initFFmpeg();
        setFfmpegReady(true);
      } catch (e) {
        console.error('Failed to load FFmpeg:', e);
        setError('FFmpegの読み込みに失敗しました。動画機能は使用できません。');
      } finally {
        setFfmpegLoading(false);
      }
    };
    loadFFmpeg();
  }, [videoFile, ffmpegReady]);

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

  // Render canvas to display
  useEffect(() => {
    if (!storyCanvas || !displayCanvasRef.current) return;

    const render = async () => {
      await storyCanvas.render();

      // Draw to display canvas (scaled down)
      const displayCtx = displayCanvasRef.current!.getContext('2d')!;
      const displayWidth = displayCanvasRef.current!.width;
      const displayHeight = displayCanvasRef.current!.height;

      displayCtx.clearRect(0, 0, displayWidth, displayHeight);
      displayCtx.drawImage(
        storyCanvas.getCanvas(),
        0, 0, CANVAS_WIDTH, CANVAS_HEIGHT,
        0, 0, displayWidth, displayHeight
      );

      // Draw snap guides (Instagram-style alignment guides)
      const scale = displayWidth / CANVAS_WIDTH;
      drawSnapGuides(displayCtx, scale, displayWidth, displayHeight);

      // Draw selection indicator (subtle dashed border)
      const selectedLayer = getSelectedLayer();
      if (selectedLayer && selectedLayer.type !== 'background') {
        drawSelectionIndicator(displayCtx, selectedLayer, scale);
      }
    };

    render();
  }, [storyCanvas, renderKey, snapGuides, getSelectedLayer]);

  // Draw selection indicator (subtle dashed border, no handles)
  const drawSelectionIndicator = (
    ctx: CanvasRenderingContext2D,
    layer: Layer,
    scale: number
  ) => {
    const corners = storyCanvas?.getLayerCorners(layer);
    if (!corners) return;

    const scaledCorners = corners.map(c => ({
      x: c.x * scale,
      y: c.y * scale,
    }));

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);

    ctx.beginPath();
    ctx.moveTo(scaledCorners[0].x, scaledCorners[0].y);
    scaledCorners.forEach(c => ctx.lineTo(c.x, c.y));
    ctx.closePath();
    ctx.stroke();

    ctx.setLineDash([]);
  };

  // Draw snap guides (center alignment lines)
  const drawSnapGuides = (
    ctx: CanvasRenderingContext2D,
    scale: number,
    displayWidth: number,
    displayHeight: number
  ) => {
    if (snapGuides.length === 0) return;

    ctx.strokeStyle = '#FFD60A'; // Yellow guide line
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);

    for (const guide of snapGuides) {
      ctx.beginPath();
      if (guide.type === 'vertical') {
        const x = guide.position * scale;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, displayHeight);
      } else {
        const y = guide.position * scale;
        ctx.moveTo(0, y);
        ctx.lineTo(displayWidth, y);
      }
      ctx.stroke();
    }

    ctx.setLineDash([]);
  };

  // Handle background change
  useEffect(() => {
    if (!storyCanvas) return;

    let fill: BackgroundFill;
    if (backgroundType === 'solid') {
      fill = { type: 'solid', color: solidColor };
    } else {
      fill = { type: 'gradient', colors: gradientColors, angle: gradientAngle };
    }

    storyCanvas.setBackground(fill);
    setRenderKey(k => k + 1);
  }, [storyCanvas, backgroundType, solidColor, gradientColors, gradientAngle]);

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
        const result = await exportCanvasWithVideo(
          canvas,
          videoFile,
          (p) => setProgress(10 + p * 0.6) // 10-70%
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

  // Handle video file select
  const handleVideoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!isVideoFile(file)) {
      setError('動画ファイルを選択してください');
      return;
    }

    if (file.size > MAX_VIDEO_SIZE) {
      setError(`動画サイズが大きすぎます（最大${MAX_VIDEO_SIZE / 1024 / 1024}MB）`);
      return;
    }

    setUploading(true);
    try {
      const preview = URL.createObjectURL(file);
      const duration = await getVideoDuration(file);
      setVideoFile(file);
      setVideoPreview(preview);
      setVideoDuration(duration);
    } catch (err) {
      console.error('Failed to process video:', err);
      setError('動画の処理に失敗しました');
    } finally {
      setUploading(false);
      if (videoInputRef.current) videoInputRef.current.value = '';
    }
  };

  // Clear video
  const clearVideo = () => {
    if (videoPreview) {
      URL.revokeObjectURL(videoPreview);
    }
    setVideoFile(null);
    setVideoPreview(null);
  };

  const selectedLayer = getSelectedLayer();
  const canPost = storyCanvas && (storyCanvas.getLayers().length > 1 || videoFile); // Has content or video

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
        {/* Canvas container - full screen */}
        <div
          ref={canvasContainerRef}
          className="absolute inset-0 flex items-center justify-center"
          onMouseDown={handleCanvasPointerDown}
          onTouchStart={handleCanvasPointerDown}
          onWheel={handleWheel}
        >
          {/* Video preview (behind canvas) */}
          {videoPreview && (
            <video
              src={videoPreview}
              className="absolute inset-0 w-full h-full object-cover"
              autoPlay
              loop
              muted
              playsInline
            />
          )}

          {/* Canvas */}
          <canvas
            ref={displayCanvasRef}
            width={displayDimensions.width}
            height={displayDimensions.height}
            className={`w-full h-full object-contain ${videoPreview ? 'absolute inset-0' : ''}`}
            style={videoPreview ? { mixBlendMode: 'normal' } : undefined}
          />
        </div>

        {/* Back button - top left with safe area */}
        <button
          onClick={onClose}
          className="absolute z-10 p-2 bg-black/40 hover:bg-black/60 rounded-full text-white transition-colors"
          style={{ top: 'calc(env(safe-area-inset-top, 16px) + 16px)', left: '16px' }}
        >
          <BackIcon />
        </button>

        {/* Right side tool buttons - Instagram style */}
        <div
          className="absolute right-4 z-10 flex flex-col gap-4 w-36"
          style={{ top: 'calc(env(safe-area-inset-top, 16px) + 16px)' }}
        >
          <ToolButton
            icon={<span className="text-lg font-bold text-white">Aa</span>}
            label="テキスト"
            onClick={() => handleToolClick('text')}
            active={activeTool === 'text'}
          />
          <ToolButton
            icon={<StickerIcon />}
            label="スタンプ"
            onClick={() => handleToolClick('sticker')}
            active={activeTool === 'sticker'}
          />
          <ToolButton
            icon={<MusicIcon />}
            label="音楽"
            onClick={() => handleToolClick('music')}
            active={activeTool === 'music'}
          />
          <ToolButton
            icon={<EffectIcon />}
            label="エフェクト"
            onClick={() => handleToolClick('effect')}
            active={activeTool === 'effect'}
          />
          <ToolButton
            icon={<ResizeIcon />}
            label="サイズ変更"
            onClick={() => handleToolClick('resize')}
            active={activeTool === 'resize'}
          />
          {/* More options chevron */}
          <button className="flex items-center justify-end w-full">
            <span className="p-2 rounded-full bg-black/40">
              <ChevronDownIcon />
            </span>
          </button>
        </div>

        {/* Floating toolbar when layer is selected */}
        {selectedLayer && selectedLayer.type !== 'background' && (
          <div className="absolute top-1/2 left-4 z-10 -translate-y-1/2 flex flex-col gap-2 bg-black/70 backdrop-blur-sm rounded-2xl p-2 shadow-lg">
            {selectedLayer.type === 'text' && (
              <button
                onClick={() => handleEditText(selectedLayer.id)}
                className="p-3 text-white hover:bg-white/20 rounded-xl transition-colors"
                title="編集"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
            )}
            <button
              onClick={handleBringToFront}
              className="p-3 text-white hover:bg-white/20 rounded-xl transition-colors"
              title="前面へ"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            </button>
            <button
              onClick={handleSendToBack}
              className="p-3 text-white hover:bg-white/20 rounded-xl transition-colors"
              title="背面へ"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <button
              onClick={handleDeleteLayer}
              className="p-3 text-red-400 hover:bg-red-500/20 rounded-xl transition-colors"
              title="削除"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        )}

        {/* Bottom section - Caption and action buttons */}
        <div
          className="absolute left-0 right-0 bottom-0 z-10 bg-gradient-to-t from-black via-black/90 to-transparent"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 16px)' }}
        >
          {/* Caption input */}
          <div className="px-4 pt-8 pb-3">
            <input
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="キャプションを追加..."
              className="w-full bg-transparent text-white placeholder-white/50 text-base py-2 outline-none"
            />
          </div>

          {/* Action buttons - Stories / Close Friends / Send */}
          <div className="flex items-center gap-3 px-4 pb-2">
            {/* Stories button */}
            <button
              onClick={handlePost}
              disabled={!canPost || posting || (videoFile && !ffmpegReady)}
              className="flex-1 flex items-center justify-center gap-2 py-3.5 bg-gradient-to-r from-pink-500 via-red-500 to-yellow-500 rounded-full text-white font-medium disabled:opacity-50 transition-opacity"
            >
              <span className="w-7 h-7 rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 flex items-center justify-center border-2 border-black">
                <span className="w-4 h-4 rounded-full bg-black"></span>
              </span>
              <span>{posting ? `${Math.round(progress)}%` : 'ストーリーズ'}</span>
            </button>

            {/* Close Friends button */}
            <button
              onClick={handlePost}
              disabled={!canPost || posting || (videoFile && !ffmpegReady)}
              className="flex-1 flex items-center justify-center gap-2 py-3.5 bg-neutral-800 hover:bg-neutral-700 rounded-full text-white font-medium disabled:opacity-50 transition-all"
            >
              <span className="w-7 h-7 rounded-full bg-green-500 flex items-center justify-center">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              </span>
              <span>親しい友達</span>
            </button>

            {/* Send button */}
            <button
              onClick={handlePost}
              disabled={!canPost || posting || (videoFile && !ffmpegReady)}
              className="w-12 h-12 flex items-center justify-center bg-blue-500 hover:bg-blue-600 rounded-full text-white disabled:opacity-50 transition-all"
            >
              <SendIcon />
            </button>
          </div>

          {/* Error message */}
          {error && (
            <div className="mx-4 mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-xl">
              <p className="text-red-400 text-sm">{error}</p>
              <button
                onClick={() => setError(null)}
                className="text-red-400/70 text-xs mt-1 hover:text-red-400"
              >
                閉じる
              </button>
            </div>
          )}
        </div>

        {/* Tool panel overlay (for sticker, etc.) - positioned above bottom bar */}
        {showToolPanel && activeTool === 'sticker' && (
          <div
            className="absolute left-4 right-4 z-20 bg-neutral-900/95 backdrop-blur-sm rounded-2xl p-4 max-h-[40vh] overflow-y-auto"
            style={{ bottom: 'calc(max(env(safe-area-inset-bottom, 0px), 16px) + 130px)' }}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white font-medium">スタンプ</h3>
              <button
                onClick={() => {
                  setShowToolPanel(false);
                  setActiveTool(null);
                }}
                className="text-white/60 hover:text-white p-1"
              >
                <CloseIcon />
              </button>
            </div>
            <StickerPanel onAddEmoji={(emoji) => {
              handleAddEmoji(emoji);
              setShowToolPanel(false);
              setActiveTool(null);
            }} />
          </div>
        )}

        {/* Background/Media quick access - positioned above bottom bar */}
        <div
          className="absolute left-4 z-10 flex gap-2"
          style={{ bottom: 'calc(max(env(safe-area-inset-bottom, 0px), 16px) + 130px)' }}
        >
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="p-3 bg-black/60 hover:bg-black/80 rounded-full text-white transition-colors"
          >
            <ImageIcon />
          </button>
          <button
            onClick={() => videoInputRef.current?.click()}
            disabled={uploading}
            className={`p-3 rounded-full text-white transition-colors ${
              videoFile ? 'bg-blue-500' : 'bg-black/60 hover:bg-black/80'
            }`}
          >
            <VideoIcon />
          </button>
          <button
            onClick={() => handleTabChange('draw')}
            className={`p-3 rounded-full text-white transition-colors ${
              interactionState.mode === 'draw' ? 'bg-purple-500' : 'bg-black/60 hover:bg-black/80'
            }`}
          >
            <DrawIcon />
          </button>
        </div>

        {/* Drawing panel overlay - positioned above bottom bar */}
        {interactionState.mode === 'draw' && (
          <div
            className="absolute left-20 z-20 bg-neutral-900/95 backdrop-blur-sm rounded-2xl p-4"
            style={{ bottom: 'calc(max(env(safe-area-inset-bottom, 0px), 16px) + 130px)' }}
          >
            <DrawingPanel
              color={drawingSettings.color}
              width={drawingSettings.width}
              opacity={drawingSettings.opacity}
              onColorChange={(color) => setDrawingSettings(prev => ({ ...prev, color }))}
              onWidthChange={(width) => setDrawingSettings(prev => ({ ...prev, width }))}
              onOpacityChange={(opacity) => setDrawingSettings(prev => ({ ...prev, opacity }))}
              onClear={clearDrawing}
              onUndo={undoDrawing}
            />
            <button
              onClick={() => setMode('select')}
              className="mt-3 w-full py-2 bg-white/10 hover:bg-white/20 rounded-lg text-white text-sm transition-colors"
            >
              完了
            </button>
          </div>
        )}

        {/* FFmpeg loading indicator */}
        {ffmpegLoading && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 bg-black/80 backdrop-blur-sm rounded-2xl px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              <span className="text-white">動画機能を準備中...</span>
            </div>
          </div>
        )}

        {/* Posting progress indicator */}
        {posting && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 bg-black/80 backdrop-blur-sm rounded-2xl px-8 py-6">
            <div className="flex flex-col items-center gap-4">
              <div className="w-16 h-16 relative">
                <svg className="w-full h-full -rotate-90">
                  <circle
                    cx="32"
                    cy="32"
                    r="28"
                    fill="none"
                    stroke="rgba(255,255,255,0.2)"
                    strokeWidth="4"
                  />
                  <circle
                    cx="32"
                    cy="32"
                    r="28"
                    fill="none"
                    stroke="white"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeDasharray={`${progress * 1.76} 176`}
                  />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-white font-medium">
                  {Math.round(progress)}%
                </span>
              </div>
              <span className="text-white text-sm">投稿中...</span>
            </div>
          </div>
        )}
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

export default StoryComposerV2;
