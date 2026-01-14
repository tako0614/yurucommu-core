import { useState, useRef } from 'react';
import { createStory, uploadMedia } from '../lib/api';

interface StoryComposerProps {
  onClose: () => void;
  onSuccess: () => void;
}

const CloseIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const ImageIcon = () => (
  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);

const TextIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
  </svg>
);

// Preset backgrounds
const BACKGROUNDS = [
  { id: 'none', label: 'なし', value: '' },
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

const DURATION_OPTIONS = [
  { value: 'PT3S', label: '3秒' },
  { value: 'PT5S', label: '5秒' },
  { value: 'PT7S', label: '7秒' },
  { value: 'PT10S', label: '10秒' },
];

type EditorMode = 'select' | 'image' | 'text';

export function StoryComposer({ onClose, onSuccess }: StoryComposerProps) {
  const [mode, setMode] = useState<EditorMode>('select');
  const [background, setBackground] = useState(BACKGROUNDS[4].value); // Default: blue gradient
  const [textContent, setTextContent] = useState('');
  const [uploadedImage, setUploadedImage] = useState<{
    r2_key: string;
    content_type: string;
    preview: string;
  } | null>(null);
  const [duration, setDuration] = useState('PT5S');
  const [uploading, setUploading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [showBgPicker, setShowBgPicker] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const result = await uploadMedia(file);
      const preview = URL.createObjectURL(file);
      setUploadedImage({
        r2_key: result.r2_key,
        content_type: result.content_type,
        preview,
      });
      setMode('image');
    } catch (err) {
      console.error('Failed to upload:', err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePost = async () => {
    if (posting) return;

    // Need either image or text
    if (!uploadedImage && !textContent.trim()) return;

    setPosting(true);
    try {
      if (uploadedImage) {
        // Image story
        await createStory([{
          attachment: { r2_key: uploadedImage.r2_key, content_type: uploadedImage.content_type },
          displayDuration: duration,
          content: textContent || undefined,
        }]);
      } else {
        // Text-only story with background - need to generate an image
        // For now, we'll create a simple canvas-based image
        const canvas = document.createElement('canvas');
        canvas.width = 1080;
        canvas.height = 1920;
        const ctx = canvas.getContext('2d')!;

        // Draw background
        if (background.startsWith('linear-gradient')) {
          // Parse gradient and draw
          const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
          // Simple gradient parsing (for the presets)
          if (background.includes('#667eea') && background.includes('#764ba2')) {
            gradient.addColorStop(0, '#667eea');
            gradient.addColorStop(1, '#764ba2');
          } else if (background.includes('#fa709a')) {
            gradient.addColorStop(0, '#fa709a');
            gradient.addColorStop(1, '#fee140');
          } else if (background.includes('#00d4ff')) {
            gradient.addColorStop(0, '#667eea');
            gradient.addColorStop(1, '#00d4ff');
          } else if (background.includes('#11998e')) {
            gradient.addColorStop(0, '#11998e');
            gradient.addColorStop(1, '#38ef7d');
          } else if (background.includes('#0f0c29')) {
            gradient.addColorStop(0, '#0f0c29');
            gradient.addColorStop(0.5, '#302b63');
            gradient.addColorStop(1, '#24243e');
          } else if (background.includes('#f093fb')) {
            gradient.addColorStop(0, '#f093fb');
            gradient.addColorStop(1, '#f5576c');
          } else {
            gradient.addColorStop(0, '#667eea');
            gradient.addColorStop(1, '#764ba2');
          }
          ctx.fillStyle = gradient;
        } else {
          ctx.fillStyle = background || '#000000';
        }
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw text
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 72px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Word wrap
        const words = textContent.split(' ');
        const lines: string[] = [];
        let currentLine = '';
        const maxWidth = canvas.width - 120;

        for (const word of words) {
          const testLine = currentLine ? `${currentLine} ${word}` : word;
          const metrics = ctx.measureText(testLine);
          if (metrics.width > maxWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
          } else {
            currentLine = testLine;
          }
        }
        if (currentLine) lines.push(currentLine);

        const lineHeight = 90;
        const startY = canvas.height / 2 - ((lines.length - 1) * lineHeight) / 2;
        lines.forEach((line, i) => {
          ctx.fillText(line, canvas.width / 2, startY + i * lineHeight);
        });

        // Convert to blob and upload
        const blob = await new Promise<Blob>((resolve) => {
          canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.9);
        });
        const file = new File([blob], 'story.jpg', { type: 'image/jpeg' });
        const result = await uploadMedia(file);

        await createStory([{
          attachment: { r2_key: result.r2_key, content_type: 'image/jpeg' },
          displayDuration: duration,
        }]);
      }

      onSuccess();
      onClose();
    } catch (e) {
      console.error('Failed to create story:', e);
    } finally {
      setPosting(false);
    }
  };

  const clearImage = () => {
    setUploadedImage(null);
    setMode('select');
  };

  const canPost = uploadedImage || (mode === 'text' && textContent.trim());

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
        <h2 className="text-white font-semibold">ストーリー作成</h2>
        <button
          onClick={handlePost}
          disabled={!canPost || posting}
          className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-neutral-700 disabled:text-neutral-500 rounded-full text-sm font-medium transition-colors"
        >
          {posting ? '投稿中...' : '投稿'}
        </button>
      </div>

      {/* Main content - Vertical 9:16 editor */}
      <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
        <div
          className="relative w-full max-w-[360px] aspect-[9/16] rounded-2xl overflow-hidden shadow-2xl"
          style={{
            background: uploadedImage ? '#000' : (background || '#000'),
          }}
        >
          {/* Mode: Select */}
          {mode === 'select' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-6">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                onChange={handleFileSelect}
                className="hidden"
              />

              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="w-20 h-20 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
              >
                {uploading ? (
                  <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <ImageIcon />
                )}
              </button>
              <p className="text-white/70 text-sm">画像を追加</p>

              <div className="w-12 h-px bg-white/20" />

              <button
                onClick={() => setMode('text')}
                className="w-20 h-20 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
              >
                <TextIcon />
              </button>
              <p className="text-white/70 text-sm">テキストのみ</p>
            </div>
          )}

          {/* Mode: Image */}
          {mode === 'image' && uploadedImage && (
            <>
              {uploadedImage.content_type.startsWith('image/') ? (
                <img
                  src={uploadedImage.preview}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <video
                  src={uploadedImage.preview}
                  className="w-full h-full object-cover"
                  autoPlay
                  muted
                  loop
                  playsInline
                />
              )}

              {/* Text overlay */}
              {textContent && (
                <div className="absolute inset-x-4 bottom-20 text-center">
                  <p className="text-white text-xl font-bold drop-shadow-lg bg-black/40 px-4 py-3 rounded-xl">
                    {textContent}
                  </p>
                </div>
              )}

              {/* Clear button */}
              <button
                onClick={clearImage}
                className="absolute top-3 right-3 w-8 h-8 bg-black/50 hover:bg-black/70 rounded-full flex items-center justify-center transition-colors"
              >
                <CloseIcon />
              </button>
            </>
          )}

          {/* Mode: Text only */}
          {mode === 'text' && !uploadedImage && (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <p className="text-white text-2xl font-bold text-center drop-shadow-lg">
                {textContent || 'テキストを入力...'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Bottom controls */}
      <div className="px-4 py-4 border-t border-neutral-800 space-y-4">
        {/* Text input (for both image and text mode) */}
        {(mode === 'image' || mode === 'text') && (
          <input
            type="text"
            value={textContent}
            onChange={(e) => setTextContent(e.target.value)}
            placeholder={mode === 'text' ? 'テキストを入力...' : 'テキストを追加（任意）'}
            className="w-full bg-neutral-800 text-white px-4 py-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
            maxLength={200}
          />
        )}

        {/* Background picker (text mode only) */}
        {mode === 'text' && (
          <div>
            <button
              onClick={() => setShowBgPicker(!showBgPicker)}
              className="text-neutral-400 text-sm mb-2 hover:text-white transition-colors"
            >
              背景を選択 {showBgPicker ? '▲' : '▼'}
            </button>
            {showBgPicker && (
              <div className="flex gap-2 flex-wrap">
                {BACKGROUNDS.filter(b => b.id !== 'none').map((bg) => (
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
            )}
          </div>
        )}

        {/* Duration selector */}
        {(mode === 'image' || mode === 'text') && (
          <div className="flex items-center gap-3">
            <span className="text-neutral-400 text-sm">表示時間:</span>
            <div className="flex gap-2">
              {DURATION_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setDuration(opt.value)}
                  className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                    duration === opt.value
                      ? 'bg-blue-500 text-white'
                      : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
