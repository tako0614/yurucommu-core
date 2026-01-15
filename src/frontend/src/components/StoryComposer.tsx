import { useState, useRef, useCallback, useEffect } from 'react';
import { createStory, uploadMedia } from '../lib/api';
import { extractDominantColors } from '../lib/colorExtract';
import { useDragResize } from '../hooks/useDragResize';
import { ImageElement, TextElement, StoryCanvasElement, StoryOverlay } from '../types';
import {
  initFFmpeg,
  composeImageStory,
  composeVideoStory,
  getVideoDuration,
  isVideoFile,
  isImageFile,
  FFmpegError,
} from '../lib/ffmpeg';

interface StoryComposerProps {
  onClose: () => void;
  onSuccess: () => void;
}

// Icons
const CloseIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const ImageAddIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);

const VideoAddIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
  </svg>
);

const TextAddIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
  </svg>
);

const TrashIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);

const LayerUpIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
  </svg>
);

const LayerDownIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);

const PollIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
  </svg>
);

const LinkIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
  </svg>
);

const NoteIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
  </svg>
);

// Background presets
const BACKGROUNDS = [
  { id: 'black', label: '黒', value: '#000000' },
  { id: 'white', label: '白', value: '#ffffff' },
  { id: 'gray', label: 'グレー', value: '#374151' },
  { id: 'blue', label: '青', value: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' },
  { id: 'sunset', label: '夕焼け', value: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)' },
  { id: 'ocean', label: '海', value: 'linear-gradient(135deg, #667eea 0%, #00d4ff 100%)' },
  { id: 'forest', label: '森', value: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)' },
  { id: 'night', label: '夜', value: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)' },
  { id: 'pink', label: 'ピンク', value: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' },
];

// File size limits
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100MB

// Canvas dimensions (9:16 aspect ratio)
const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1920;

// Generate unique ID
function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

// Calculate display duration based on content
function calculateDuration(elements: StoryCanvasElement[]): number {
  let seconds = 3;

  const textElements = elements.filter(e => e.type === 'text') as TextElement[];
  seconds += textElements.length * 2;

  for (const el of textElements) {
    seconds += Math.ceil(el.content.length / 20);
  }

  const imageElements = elements.filter(e => e.type === 'image');
  if (imageElements.length >= 2) {
    seconds += 2;
  }

  return Math.max(3, Math.min(15, seconds));
}

// Draggable element wrapper
function DraggableElement({
  element,
  isSelected,
  canvasScale,
  onSelect,
  onUpdate,
}: {
  element: StoryCanvasElement;
  isSelected: boolean;
  canvasScale: number;
  onSelect: () => void;
  onUpdate: (updates: Partial<StoryCanvasElement>) => void;
}) {
  const { isDragging, handleMouseDown } = useDragResize(element, {
    canvasScale,
    onUpdate,
  });

  const style: React.CSSProperties = {
    position: 'absolute',
    left: element.x * canvasScale,
    top: element.y * canvasScale,
    width: element.width * canvasScale,
    height: element.height * canvasScale,
    zIndex: element.zIndex,
    cursor: isDragging ? 'grabbing' : 'grab',
  };

  return (
    <div
      style={style}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      onMouseDown={(e) => handleMouseDown(e, 'drag')}
      onTouchStart={(e) => handleMouseDown(e, 'drag')}
      className={`select-none ${isSelected ? 'ring-2 ring-blue-500 ring-offset-0' : ''}`}
    >
      {element.type === 'image' ? (
        <img
          src={(element as ImageElement).preview}
          alt=""
          className="w-full h-full object-cover pointer-events-none"
          draggable={false}
        />
      ) : (
        <div
          className="w-full h-full flex items-center justify-center p-2 pointer-events-none overflow-hidden"
          style={{
            fontSize: (element as TextElement).fontSize * canvasScale,
            fontWeight: (element as TextElement).fontWeight,
            color: (element as TextElement).color,
            backgroundColor: (element as TextElement).backgroundColor || 'transparent',
          }}
        >
          <span className="break-words text-center whitespace-pre-wrap">
            {(element as TextElement).content || 'テキスト'}
          </span>
        </div>
      )}

      {/* Resize handles */}
      {isSelected && (
        <>
          {['nw', 'ne', 'sw', 'se'].map((handle) => (
            <div
              key={handle}
              className={`absolute w-4 h-4 bg-white border-2 border-blue-500 rounded-full cursor-${
                handle === 'nw' || handle === 'se' ? 'nwse' : 'nesw'
              }-resize`}
              style={{
                top: handle.includes('n') ? -8 : 'auto',
                bottom: handle.includes('s') ? -8 : 'auto',
                left: handle.includes('w') ? -8 : 'auto',
                right: handle.includes('e') ? -8 : 'auto',
              }}
              onMouseDown={(e) => handleMouseDown(e, 'resize', handle)}
              onTouchStart={(e) => handleMouseDown(e, 'resize', handle)}
            />
          ))}
        </>
      )}
    </div>
  );
}

type EditorMode = 'image' | 'video';

export function StoryComposer({ onClose, onSuccess }: StoryComposerProps) {
  const [mode, setMode] = useState<EditorMode>('image');
  const [background, setBackground] = useState(BACKGROUNDS[3].value); // Default: blue gradient
  const [elements, setElements] = useState<StoryCanvasElement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [extractedColors, setExtractedColors] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showBgPicker, setShowBgPicker] = useState(false);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [editingTextValue, setEditingTextValue] = useState('');
  const [ffmpegReady, setFfmpegReady] = useState(false);
  const [ffmpegLoading, setFfmpegLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Video mode state
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<number>(5);

  // Overlay state
  const [overlays, setOverlays] = useState<StoryOverlay[]>([]);
  const [selectedOverlayIndex, setSelectedOverlayIndex] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasScale, setCanvasScale] = useState(1);

  // Calculate canvas scale based on container size
  useEffect(() => {
    const updateScale = () => {
      if (canvasRef.current) {
        const containerWidth = canvasRef.current.clientWidth;
        setCanvasScale(containerWidth / CANVAS_WIDTH);
      }
    };

    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  // Initialize FFmpeg on mount
  useEffect(() => {
    const loadFFmpeg = async () => {
      setFfmpegLoading(true);
      try {
        await initFFmpeg();
        setFfmpegReady(true);
      } catch (e) {
        console.error('Failed to load FFmpeg:', e);
      } finally {
        setFfmpegLoading(false);
      }
    };
    loadFFmpeg();
  }, []);

  const selectedElement = elements.find(e => e.id === selectedId);

  // Handle image file upload
  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !isImageFile(file)) return;

    // Size check
    if (file.size > MAX_IMAGE_SIZE) {
      setError(`画像サイズが大きすぎます（最大${MAX_IMAGE_SIZE / 1024 / 1024}MB）`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setUploading(true);
    try {
      const preview = URL.createObjectURL(file);

      // Extract colors from image
      const colors = await extractDominantColors(preview);
      setExtractedColors(prev => [...new Set([...prev, ...colors])].slice(0, 10));

      // Create new image element centered on canvas
      const newElement: ImageElement = {
        id: generateId(),
        type: 'image',
        x: CANVAS_WIDTH / 2 - 400,
        y: CANVAS_HEIGHT / 2 - 400,
        width: 800,
        height: 800,
        rotation: 0,
        zIndex: elements.length + 1,
        r2_key: '', // Will be set on upload
        content_type: file.type,
        preview,
        dominantColors: colors,
      };

      // Store file reference for later upload
      (newElement as any)._file = file;

      setElements(prev => [...prev, newElement]);
      setSelectedId(newElement.id);
    } catch (err) {
      console.error('Failed to process image:', err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Handle video file select
  const handleVideoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !isVideoFile(file)) return;

    // Size check
    if (file.size > MAX_VIDEO_SIZE) {
      setError(`動画サイズが大きすぎます（最大${MAX_VIDEO_SIZE / 1024 / 1024}MB）`);
      if (videoInputRef.current) videoInputRef.current.value = '';
      return;
    }

    setUploading(true);
    try {
      const preview = URL.createObjectURL(file);
      const duration = await getVideoDuration(file);

      setVideoFile(file);
      setVideoPreview(preview);
      setVideoDuration(duration);
      setMode('video');
    } catch (err) {
      console.error('Failed to process video:', err);
    } finally {
      setUploading(false);
      if (videoInputRef.current) videoInputRef.current.value = '';
    }
  };

  // Add text element
  const addTextElement = () => {
    const newElement: TextElement = {
      id: generateId(),
      type: 'text',
      x: CANVAS_WIDTH / 2 - 300,
      y: CANVAS_HEIGHT / 2 - 100,
      width: 600,
      height: 200,
      rotation: 0,
      zIndex: elements.length + 1,
      content: 'テキストを入力',
      fontSize: 48,
      fontWeight: 'bold',
      color: '#ffffff',
      backgroundColor: 'rgba(0,0,0,0.5)',
    };

    setElements(prev => [...prev, newElement]);
    setSelectedId(newElement.id);
    setEditingTextId(newElement.id);
    setEditingTextValue(newElement.content);
  };

  // Update element
  const updateElement = useCallback((id: string, updates: Partial<StoryCanvasElement>) => {
    setElements(prev => prev.map(el =>
      el.id === id ? { ...el, ...updates } as StoryCanvasElement : el
    ));
  }, []);

  // Delete selected element
  const deleteSelected = () => {
    if (selectedId) {
      setElements(prev => prev.filter(el => el.id !== selectedId));
      setSelectedId(null);
    }
  };

  // Move selected element to front
  const bringToFront = () => {
    if (!selectedId) return;
    const maxZ = Math.max(...elements.map(e => e.zIndex));
    updateElement(selectedId, { zIndex: maxZ + 1 });
  };

  // Move selected element to back
  const sendToBack = () => {
    if (!selectedId) return;
    const minZ = Math.min(...elements.map(e => e.zIndex));
    updateElement(selectedId, { zIndex: minZ - 1 });
  };

  // Deselect when clicking canvas background
  const handleCanvasClick = () => {
    setSelectedId(null);
    setEditingTextId(null);
    setSelectedOverlayIndex(null);
  };

  // Add poll overlay
  const addPollOverlay = () => {
    const newOverlay: StoryOverlay = {
      type: 'Question',
      name: '質問を入力',
      oneOf: [
        { type: 'Note', name: '選択肢1' },
        { type: 'Note', name: '選択肢2' },
      ],
      position: {
        x: 0.5,
        y: 0.75,
        width: 0.8,
        height: 0.15,
      },
    };
    setOverlays(prev => [...prev, newOverlay]);
    setSelectedOverlayIndex(overlays.length);
    setSelectedId(null);
  };

  // Add link overlay
  const addLinkOverlay = () => {
    const newOverlay: StoryOverlay = {
      type: 'Link',
      name: 'リンクを開く',
      href: '',
      position: {
        x: 0.5,
        y: 0.9,
        width: 0.6,
        height: 0.08,
      },
    };
    setOverlays(prev => [...prev, newOverlay]);
    setSelectedOverlayIndex(overlays.length);
    setSelectedId(null);
  };

  // Add note overlay
  const addNoteOverlay = () => {
    const newOverlay: StoryOverlay = {
      type: 'Note',
      name: 'テキストを入力',
      position: {
        x: 0.5,
        y: 0.5,
        width: 0.8,
        height: 0.1,
      },
    };
    setOverlays(prev => [...prev, newOverlay]);
    setSelectedOverlayIndex(overlays.length);
    setSelectedId(null);
  };

  // Update overlay
  const updateOverlay = (index: number, updates: Partial<StoryOverlay>) => {
    setOverlays(prev => prev.map((overlay, i) =>
      i === index ? { ...overlay, ...updates } : overlay
    ));
  };

  // Delete overlay
  const deleteOverlay = (index: number) => {
    setOverlays(prev => prev.filter((_, i) => i !== index));
    setSelectedOverlayIndex(null);
  };

  // Update poll option
  const updatePollOption = (overlayIndex: number, optionIndex: number, name: string) => {
    setOverlays(prev => prev.map((overlay, i) => {
      if (i !== overlayIndex || !overlay.oneOf) return overlay;
      const newOneOf = [...overlay.oneOf];
      newOneOf[optionIndex] = { ...newOneOf[optionIndex], name };
      return { ...overlay, oneOf: newOneOf };
    }));
  };

  // Add poll option
  const addPollOption = (overlayIndex: number) => {
    setOverlays(prev => prev.map((overlay, i) => {
      if (i !== overlayIndex || !overlay.oneOf || overlay.oneOf.length >= 4) return overlay;
      return {
        ...overlay,
        oneOf: [...overlay.oneOf, { type: 'Note', name: `選択肢${overlay.oneOf.length + 1}` }],
      };
    }));
  };

  // Remove poll option
  const removePollOption = (overlayIndex: number, optionIndex: number) => {
    setOverlays(prev => prev.map((overlay, i) => {
      if (i !== overlayIndex || !overlay.oneOf || overlay.oneOf.length <= 2) return overlay;
      return {
        ...overlay,
        oneOf: overlay.oneOf.filter((_, idx) => idx !== optionIndex),
      };
    }));
  };

  // Start editing text
  const handleTextDoubleClick = (element: TextElement) => {
    setEditingTextId(element.id);
    setEditingTextValue(element.content);
  };

  // Save text edit
  const saveTextEdit = () => {
    if (editingTextId) {
      updateElement(editingTextId, { content: editingTextValue });
      setEditingTextId(null);
    }
  };

  // Clear video and switch to image mode
  const clearVideo = () => {
    if (videoPreview) {
      URL.revokeObjectURL(videoPreview);
    }
    setVideoFile(null);
    setVideoPreview(null);
    setMode('image');
  };

  // Post story
  const handlePost = async () => {
    if (posting || !ffmpegReady) return;

    setPosting(true);
    setProgress(0);
    setError(null);

    try {
      let blob: Blob;
      let contentType: string;
      let duration: number;

      if (mode === 'video' && videoFile) {
        // Video mode: compose video with text overlays
        const textElements = elements.filter(e => e.type === 'text') as TextElement[];
        const result = await composeVideoStory(videoFile, textElements, setProgress);
        blob = result.blob;
        contentType = 'video/mp4';
        duration = result.duration;
      } else {
        // Image mode: compose image with all elements
        if (elements.length === 0) {
          // No elements, create simple background
          const canvas = document.createElement('canvas');
          canvas.width = CANVAS_WIDTH;
          canvas.height = CANVAS_HEIGHT;
          const ctx = canvas.getContext('2d')!;

          // Parse background
          if (background.startsWith('linear-gradient')) {
            const gradient = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
            const colorMatches = background.match(/#[a-fA-F0-9]{6}/g) || [];
            if (colorMatches.length >= 2) {
              gradient.addColorStop(0, colorMatches[0]!);
              gradient.addColorStop(1, colorMatches[colorMatches.length - 1]!);
            }
            ctx.fillStyle = gradient;
          } else {
            ctx.fillStyle = background;
          }
          ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

          blob = await new Promise<Blob>((resolve) => {
            canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.9);
          });
        } else {
          // Upload images first to get proper URLs for FFmpeg
          for (const el of elements) {
            if (el.type === 'image') {
              const imgEl = el as ImageElement & { _file?: File };
              const file = imgEl._file;
              if (file && !imgEl.r2_key) {
                const result = await uploadMedia(file);
                imgEl.r2_key = result.r2_key;
              }
            }
          }

          blob = await composeImageStory(background, elements, setProgress);
        }
        contentType = 'image/jpeg';
        duration = calculateDuration(elements);
      }

      // Upload composed media
      const file = new File([blob], mode === 'video' ? 'story.mp4' : 'story.jpg', { type: contentType });
      const result = await uploadMedia(file);

      // Create story
      await createStory({
        attachment: { r2_key: result.r2_key, content_type: contentType },
        displayDuration: `PT${Math.round(duration)}S`,
        overlays: overlays.length > 0 ? overlays : undefined,
      });

      onSuccess();
      onClose();
    } catch (e) {
      console.error('Failed to create story:', e);
      if (e instanceof FFmpegError) {
        setError(`メディア処理エラー: ${e.message}`);
      } else if (e instanceof Error) {
        setError(`エラー: ${e.message}`);
      } else {
        setError('ストーリーの作成に失敗しました');
      }
    } finally {
      setPosting(false);
      setProgress(0);
    }
  };

  const canPost = mode === 'video' ? !!videoFile : elements.length > 0 || background !== BACKGROUNDS[3].value;

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
        <button
          onClick={onClose}
          className="p-2 text-white hover:bg-white/10 rounded-full transition-colors"
        >
          <CloseIcon />
        </button>
        <h2 className="text-white font-semibold">
          {mode === 'video' ? '動画ストーリー' : 'ストーリー作成'}
        </h2>
        <button
          onClick={handlePost}
          disabled={!canPost || posting || !ffmpegReady}
          className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-neutral-700 disabled:text-neutral-500 rounded-full text-sm font-medium transition-colors"
        >
          {posting ? `${Math.round(progress)}%` : ffmpegLoading ? '準備中...' : '投稿'}
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Canvas area */}
        <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
          <div
            ref={canvasRef}
            className="relative w-full max-w-[360px] aspect-[9/16] rounded-2xl overflow-hidden shadow-2xl"
            style={{ background: mode === 'video' ? '#000' : background }}
            onClick={handleCanvasClick}
          >
            {/* Video preview */}
            {mode === 'video' && videoPreview && (
              <video
                src={videoPreview}
                className="absolute inset-0 w-full h-full object-cover"
                autoPlay
                loop
                muted
                playsInline
              />
            )}

            {/* Render elements (text only for video mode) */}
            {(mode === 'image' ? elements : elements.filter(e => e.type === 'text')).map((el) => (
              <DraggableElement
                key={el.id}
                element={el}
                isSelected={selectedId === el.id}
                canvasScale={canvasScale}
                onSelect={() => {
                  setSelectedId(el.id);
                  setSelectedOverlayIndex(null);
                  if (el.type === 'text') {
                    handleTextDoubleClick(el as TextElement);
                  }
                }}
                onUpdate={(updates) => updateElement(el.id, updates)}
              />
            ))}

            {/* Render overlays preview */}
            {overlays.map((overlay, idx) => (
              <div
                key={idx}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedOverlayIndex(idx);
                  setSelectedId(null);
                  setEditingTextId(null);
                }}
                className={`absolute cursor-pointer select-none transition-all ${
                  selectedOverlayIndex === idx ? 'ring-2 ring-blue-500' : ''
                }`}
                style={{
                  left: `${(overlay.position.x - overlay.position.width / 2) * 100}%`,
                  top: `${(overlay.position.y - overlay.position.height / 2) * 100}%`,
                  width: `${overlay.position.width * 100}%`,
                  height: `${overlay.position.height * 100}%`,
                  zIndex: 100 + idx,
                }}
              >
                {overlay.type === 'Question' && (
                  <div className="w-full h-full bg-white/95 backdrop-blur-sm rounded-xl p-2 flex flex-col">
                    <div className="text-center text-black font-medium text-xs truncate mb-1">
                      {overlay.name || '質問を入力'}
                    </div>
                    <div className="flex-1 flex gap-1">
                      {overlay.oneOf?.map((option, optIdx) => (
                        <div
                          key={optIdx}
                          className="flex-1 bg-neutral-200 rounded-lg flex items-center justify-center text-xs text-black truncate px-1"
                        >
                          {option.name}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {overlay.type === 'Link' && (
                  <div className="w-full h-full bg-blue-500/90 backdrop-blur-sm rounded-full flex items-center justify-center">
                    <div className="flex items-center gap-1 text-white font-medium text-xs">
                      <LinkIcon />
                      <span className="truncate">{overlay.name || 'リンクを開く'}</span>
                    </div>
                  </div>
                )}
                {overlay.type === 'Note' && (
                  <div className="w-full h-full bg-black/30 backdrop-blur-sm rounded-lg flex items-center justify-center p-2">
                    <span className="text-white font-medium text-sm text-center drop-shadow-lg truncate">
                      {overlay.name || 'テキストを入力'}
                    </span>
                  </div>
                )}
              </div>
            ))}

            {/* Empty state */}
            {mode === 'image' && elements.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center text-white/50">
                <p className="text-center px-4">
                  画像やテキストを追加して<br />ストーリーを作成しましょう
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Toolbar panel */}
        <div className="md:w-80 border-t md:border-t-0 md:border-l border-neutral-800 p-4 space-y-4 overflow-y-auto">
          {/* Mode switch */}
          {mode === 'video' && (
            <div className="flex items-center justify-between p-3 bg-neutral-800 rounded-xl">
              <div className="flex items-center gap-2">
                <VideoAddIcon />
                <span className="text-white text-sm">動画モード</span>
              </div>
              <button
                onClick={clearVideo}
                className="text-red-400 text-sm hover:text-red-300"
              >
                クリア
              </button>
            </div>
          )}

          {/* Add buttons */}
          <div className="flex gap-2">
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

            {mode === 'image' && (
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors"
              >
                {uploading ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <ImageAddIcon />
                )}
                <span className="text-white text-sm">画像</span>
              </button>
            )}

            {mode === 'image' && (
              <button
                onClick={() => videoInputRef.current?.click()}
                disabled={uploading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors"
              >
                <VideoAddIcon />
                <span className="text-white text-sm">動画</span>
              </button>
            )}

            <button
              onClick={addTextElement}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors"
            >
              <TextAddIcon />
              <span className="text-white text-sm">テキスト</span>
            </button>
          </div>

          {/* Overlay buttons */}
          <div className="flex gap-2">
            <button
              onClick={addPollOverlay}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors"
            >
              <PollIcon />
              <span className="text-white text-sm">投票</span>
            </button>
            <button
              onClick={addLinkOverlay}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors"
            >
              <LinkIcon />
              <span className="text-white text-sm">リンク</span>
            </button>
            <button
              onClick={addNoteOverlay}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors"
            >
              <NoteIcon />
              <span className="text-white text-sm">注釈</span>
            </button>
          </div>

          {/* Video duration info */}
          {mode === 'video' && videoFile && (
            <div className="p-3 bg-neutral-800/50 rounded-xl">
              <p className="text-neutral-400 text-sm">
                動画の長さ: {Math.round(videoDuration)}秒
                {videoDuration > 60 && ' (60秒に制限されます)'}
              </p>
              <p className="text-neutral-400 text-sm">
                ファイルサイズ: {(videoFile.size / 1024 / 1024).toFixed(1)}MB
              </p>
            </div>
          )}

          {/* Text editing (when text is selected) */}
          {editingTextId && selectedElement?.type === 'text' && (
            <div className="space-y-3">
              <label className="text-neutral-400 text-sm">テキスト</label>
              <textarea
                value={editingTextValue}
                onChange={(e) => setEditingTextValue(e.target.value)}
                onBlur={saveTextEdit}
                placeholder="テキストを入力..."
                className="w-full bg-neutral-800 text-white px-4 py-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                rows={3}
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  onClick={() => updateElement(editingTextId, { fontSize: Math.max(24, (selectedElement as TextElement).fontSize - 8) })}
                  className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-white text-sm"
                >
                  A-
                </button>
                <button
                  onClick={() => updateElement(editingTextId, { fontSize: Math.min(96, (selectedElement as TextElement).fontSize + 8) })}
                  className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-white text-sm"
                >
                  A+
                </button>
                <button
                  onClick={() => updateElement(editingTextId, {
                    fontWeight: (selectedElement as TextElement).fontWeight === 'bold' ? 'normal' : 'bold'
                  })}
                  className={`px-3 py-2 rounded-lg text-white text-sm font-bold ${
                    (selectedElement as TextElement).fontWeight === 'bold' ? 'bg-blue-500' : 'bg-neutral-800 hover:bg-neutral-700'
                  }`}
                >
                  B
                </button>
              </div>
            </div>
          )}

          {/* Element controls (when something is selected) */}
          {selectedId && (
            <div className="flex gap-2">
              <button
                onClick={deleteSelected}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-xl transition-colors"
              >
                <TrashIcon />
                <span className="text-sm">削除</span>
              </button>
              <button
                onClick={bringToFront}
                className="flex items-center justify-center px-4 py-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors"
                title="前面へ"
              >
                <LayerUpIcon />
              </button>
              <button
                onClick={sendToBack}
                className="flex items-center justify-center px-4 py-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors"
                title="背面へ"
              >
                <LayerDownIcon />
              </button>
            </div>
          )}

          {/* Overlay editing (when overlay is selected) */}
          {selectedOverlayIndex !== null && overlays[selectedOverlayIndex] && (
            <div className="space-y-3 p-3 bg-neutral-800/50 rounded-xl">
              {/* Poll (Question) overlay editing */}
              {overlays[selectedOverlayIndex].type === 'Question' && (
                <>
                  <label className="text-neutral-400 text-sm">質問</label>
                  <input
                    type="text"
                    value={overlays[selectedOverlayIndex].name || ''}
                    onChange={(e) => updateOverlay(selectedOverlayIndex, { name: e.target.value })}
                    placeholder="質問を入力..."
                    className="w-full bg-neutral-700 text-white px-4 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <label className="text-neutral-400 text-sm">選択肢</label>
                  {overlays[selectedOverlayIndex].oneOf?.map((option, idx) => (
                    <div key={idx} className="flex gap-2">
                      <input
                        type="text"
                        value={option.name}
                        onChange={(e) => updatePollOption(selectedOverlayIndex, idx, e.target.value)}
                        placeholder={`選択肢${idx + 1}`}
                        className="flex-1 bg-neutral-700 text-white px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      {overlays[selectedOverlayIndex].oneOf!.length > 2 && (
                        <button
                          onClick={() => removePollOption(selectedOverlayIndex, idx)}
                          className="px-2 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg"
                        >
                          <TrashIcon />
                        </button>
                      )}
                    </div>
                  ))}
                  {(overlays[selectedOverlayIndex].oneOf?.length || 0) < 4 && (
                    <button
                      onClick={() => addPollOption(selectedOverlayIndex)}
                      className="w-full px-4 py-2 bg-neutral-700 hover:bg-neutral-600 text-white rounded-lg text-sm"
                    >
                      + 選択肢を追加
                    </button>
                  )}
                  {/* Position presets */}
                  <label className="text-neutral-400 text-sm">位置</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => updateOverlay(selectedOverlayIndex, { position: { ...overlays[selectedOverlayIndex].position, y: 0.25 } })}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm ${overlays[selectedOverlayIndex].position.y === 0.25 ? 'bg-blue-500 text-white' : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'}`}
                    >
                      上
                    </button>
                    <button
                      onClick={() => updateOverlay(selectedOverlayIndex, { position: { ...overlays[selectedOverlayIndex].position, y: 0.5 } })}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm ${overlays[selectedOverlayIndex].position.y === 0.5 ? 'bg-blue-500 text-white' : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'}`}
                    >
                      中央
                    </button>
                    <button
                      onClick={() => updateOverlay(selectedOverlayIndex, { position: { ...overlays[selectedOverlayIndex].position, y: 0.75 } })}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm ${overlays[selectedOverlayIndex].position.y === 0.75 ? 'bg-blue-500 text-white' : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'}`}
                    >
                      下
                    </button>
                  </div>
                </>
              )}

              {/* Link overlay editing */}
              {overlays[selectedOverlayIndex].type === 'Link' && (
                <>
                  <label className="text-neutral-400 text-sm">リンクテキスト</label>
                  <input
                    type="text"
                    value={overlays[selectedOverlayIndex].name || ''}
                    onChange={(e) => updateOverlay(selectedOverlayIndex, { name: e.target.value })}
                    placeholder="リンクを開く"
                    className="w-full bg-neutral-700 text-white px-4 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <label className="text-neutral-400 text-sm">URL</label>
                  <input
                    type="url"
                    value={(overlays[selectedOverlayIndex].href as string) || ''}
                    onChange={(e) => updateOverlay(selectedOverlayIndex, { href: e.target.value })}
                    placeholder="https://example.com"
                    className="w-full bg-neutral-700 text-white px-4 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {/* Position presets */}
                  <label className="text-neutral-400 text-sm">位置</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => updateOverlay(selectedOverlayIndex, { position: { ...overlays[selectedOverlayIndex].position, y: 0.5 } })}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm ${overlays[selectedOverlayIndex].position.y === 0.5 ? 'bg-blue-500 text-white' : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'}`}
                    >
                      中央
                    </button>
                    <button
                      onClick={() => updateOverlay(selectedOverlayIndex, { position: { ...overlays[selectedOverlayIndex].position, y: 0.9 } })}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm ${overlays[selectedOverlayIndex].position.y === 0.9 ? 'bg-blue-500 text-white' : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'}`}
                    >
                      下
                    </button>
                  </div>
                </>
              )}

              {/* Note overlay editing */}
              {overlays[selectedOverlayIndex].type === 'Note' && (
                <>
                  <label className="text-neutral-400 text-sm">テキスト</label>
                  <input
                    type="text"
                    value={overlays[selectedOverlayIndex].name || ''}
                    onChange={(e) => updateOverlay(selectedOverlayIndex, { name: e.target.value })}
                    placeholder="テキストを入力..."
                    className="w-full bg-neutral-700 text-white px-4 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {/* Position presets */}
                  <label className="text-neutral-400 text-sm">位置</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => updateOverlay(selectedOverlayIndex, { position: { ...overlays[selectedOverlayIndex].position, y: 0.2 } })}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm ${overlays[selectedOverlayIndex].position.y === 0.2 ? 'bg-blue-500 text-white' : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'}`}
                    >
                      上
                    </button>
                    <button
                      onClick={() => updateOverlay(selectedOverlayIndex, { position: { ...overlays[selectedOverlayIndex].position, y: 0.5 } })}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm ${overlays[selectedOverlayIndex].position.y === 0.5 ? 'bg-blue-500 text-white' : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'}`}
                    >
                      中央
                    </button>
                    <button
                      onClick={() => updateOverlay(selectedOverlayIndex, { position: { ...overlays[selectedOverlayIndex].position, y: 0.8 } })}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm ${overlays[selectedOverlayIndex].position.y === 0.8 ? 'bg-blue-500 text-white' : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'}`}
                    >
                      下
                    </button>
                  </div>
                </>
              )}

              {/* Delete overlay button */}
              <button
                onClick={() => deleteOverlay(selectedOverlayIndex)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg"
              >
                <TrashIcon />
                <span className="text-sm">オーバーレイを削除</span>
              </button>
            </div>
          )}

          {/* Background picker (image mode only) */}
          {mode === 'image' && (
            <div>
              <button
                onClick={() => setShowBgPicker(!showBgPicker)}
                className="text-neutral-400 text-sm mb-2 hover:text-white transition-colors"
              >
                背景を選択 {showBgPicker ? '▲' : '▼'}
              </button>
              {showBgPicker && (
                <div className="space-y-3">
                  {/* Preset backgrounds */}
                  <div className="flex gap-2 flex-wrap">
                    {BACKGROUNDS.map((bg) => (
                      <button
                        key={bg.id}
                        onClick={() => setBackground(bg.value)}
                        className={`w-10 h-10 rounded-lg border-2 transition-all ${
                          background === bg.value ? 'border-white scale-110' : 'border-transparent'
                        }`}
                        style={{ background: bg.value }}
                        title={bg.label}
                      />
                    ))}
                  </div>

                  {/* Extracted colors */}
                  {extractedColors.length > 0 && (
                    <>
                      <p className="text-neutral-500 text-xs">画像から抽出した色</p>
                      <div className="flex gap-2 flex-wrap">
                        {extractedColors.map((color, i) => (
                          <button
                            key={i}
                            onClick={() => setBackground(color)}
                            className={`w-10 h-10 rounded-lg border-2 transition-all ${
                              background === color ? 'border-white scale-110' : 'border-transparent'
                            }`}
                            style={{ background: color }}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* FFmpeg status */}
          {ffmpegLoading && (
            <div className="flex items-center gap-2 text-neutral-500 text-sm">
              <div className="w-4 h-4 border-2 border-neutral-500/30 border-t-neutral-500 rounded-full animate-spin" />
              FFmpegを読み込み中...
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-xl">
              <p className="text-red-400 text-sm">{error}</p>
              <button
                onClick={() => setError(null)}
                className="text-red-400/70 text-xs mt-1 hover:text-red-400"
              >
                閉じる
              </button>
            </div>
          )}

          {/* Info */}
          <div className="text-neutral-500 text-xs space-y-1">
            <p>要素をドラッグして移動、角をドラッグしてリサイズできます</p>
            {mode === 'image' && (
              <p>表示時間は内容に応じて自動計算されます（3-15秒）</p>
            )}
            {mode === 'video' && (
              <p>動画は最大60秒まで投稿できます</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
