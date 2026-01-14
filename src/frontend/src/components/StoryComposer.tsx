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
  <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);

const TrashIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);

interface UploadedFrame {
  r2_key: string;
  content_type: string;
  preview: string;
  displayDuration: string;
  content: string;
}

const DURATION_OPTIONS = [
  { value: 'PT3S', label: '3s' },
  { value: 'PT5S', label: '5s' },
  { value: 'PT7S', label: '7s' },
  { value: 'PT10S', label: '10s' },
  { value: 'PT15S', label: '15s' },
];

export function StoryComposer({ onClose, onSuccess }: StoryComposerProps) {
  const [frames, setFrames] = useState<UploadedFrame[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [posting, setPosting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedFrame = frames[selectedIndex];

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (frames.length >= 10) break; // Max 10 frames

        const result = await uploadMedia(file);
        const preview = URL.createObjectURL(file);

        setFrames(prev => [...prev, {
          r2_key: result.r2_key,
          content_type: result.content_type,
          preview,
          displayDuration: 'PT5S',
          content: '',
        }]);
        setSelectedIndex(frames.length);
      }
    } catch (err) {
      console.error('Failed to upload:', err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeFrame = (index: number) => {
    setFrames(prev => prev.filter((_, i) => i !== index));
    if (selectedIndex >= frames.length - 1 && selectedIndex > 0) {
      setSelectedIndex(selectedIndex - 1);
    }
  };

  const updateFrameDuration = (duration: string) => {
    setFrames(prev => prev.map((f, i) =>
      i === selectedIndex ? { ...f, displayDuration: duration } : f
    ));
  };

  const updateFrameContent = (content: string) => {
    setFrames(prev => prev.map((f, i) =>
      i === selectedIndex ? { ...f, content } : f
    ));
  };

  const handlePost = async () => {
    if (frames.length === 0 || posting) return;

    setPosting(true);
    try {
      await createStory(frames.map(f => ({
        attachment: { r2_key: f.r2_key, content_type: f.content_type },
        displayDuration: f.displayDuration,
        content: f.content || undefined,
      })));
      onSuccess();
      onClose();
    } catch (e) {
      console.error('Failed to create story:', e);
    } finally {
      setPosting(false);
    }
  };

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
        <h2 className="text-white font-semibold">New Story</h2>
        <button
          onClick={handlePost}
          disabled={frames.length === 0 || posting}
          className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-neutral-700 disabled:text-neutral-500 rounded-full text-sm font-medium transition-colors"
        >
          {posting ? 'Posting...' : 'Share'}
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col">
        {frames.length === 0 ? (
          /* Empty state - upload prompt */
          <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-32 h-32 rounded-full bg-neutral-800 hover:bg-neutral-700 flex items-center justify-center transition-colors"
            >
              {uploading ? (
                <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <ImageIcon />
              )}
            </button>
            <p className="text-neutral-400 text-center">
              Tap to add photos or videos to your story
            </p>
            <p className="text-neutral-500 text-sm">
              Stories disappear after 24 hours
            </p>
          </div>
        ) : (
          /* Frame preview and editing */
          <div className="flex-1 flex flex-col">
            {/* Preview area */}
            <div className="flex-1 flex items-center justify-center p-4 relative">
              {selectedFrame && (
                <>
                  {selectedFrame.content_type.startsWith('image/') ? (
                    <img
                      src={selectedFrame.preview}
                      alt=""
                      className="max-w-full max-h-full object-contain rounded-lg"
                    />
                  ) : (
                    <video
                      src={selectedFrame.preview}
                      className="max-w-full max-h-full object-contain rounded-lg"
                      controls
                    />
                  )}
                  {/* Text overlay preview */}
                  {selectedFrame.content && (
                    <div className="absolute bottom-16 left-8 right-8 text-center">
                      <p className="text-white text-lg font-medium drop-shadow-lg bg-black/30 px-4 py-2 rounded-lg">
                        {selectedFrame.content}
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Frame editing controls */}
            {selectedFrame && (
              <div className="px-4 py-3 border-t border-neutral-800 space-y-3">
                {/* Duration selector */}
                <div className="flex items-center gap-2">
                  <span className="text-neutral-400 text-sm min-w-20">Duration:</span>
                  <div className="flex gap-2 flex-wrap">
                    {DURATION_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => updateFrameDuration(opt.value)}
                        className={`px-3 py-1 rounded-full text-sm transition-colors ${
                          selectedFrame.displayDuration === opt.value
                            ? 'bg-blue-500 text-white'
                            : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Text overlay input */}
                <div className="flex items-center gap-2">
                  <span className="text-neutral-400 text-sm min-w-20">Text:</span>
                  <input
                    type="text"
                    value={selectedFrame.content}
                    onChange={(e) => updateFrameContent(e.target.value)}
                    placeholder="Add text overlay..."
                    className="flex-1 bg-neutral-800 text-white px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                    maxLength={100}
                  />
                </div>
              </div>
            )}

            {/* Frame thumbnails */}
            <div className="px-4 py-3 border-t border-neutral-800">
              <div className="flex gap-2 overflow-x-auto scrollbar-hide">
                {frames.map((frame, idx) => (
                  <div
                    key={idx}
                    className={`relative flex-shrink-0 cursor-pointer ${
                      idx === selectedIndex ? 'ring-2 ring-blue-500 rounded-lg' : ''
                    }`}
                    onClick={() => setSelectedIndex(idx)}
                  >
                    <img
                      src={frame.preview}
                      alt=""
                      className="w-16 h-16 object-cover rounded-lg"
                    />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFrame(idx);
                      }}
                      className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center"
                    >
                      <TrashIcon />
                    </button>
                    <span className="absolute bottom-0 right-0 bg-black/70 text-white text-xs px-1 rounded">
                      {DURATION_OPTIONS.find(o => o.value === frame.displayDuration)?.label}
                    </span>
                  </div>
                ))}

                {/* Add more button */}
                {frames.length < 10 && (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,video/*"
                      multiple
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      className="w-16 h-16 flex-shrink-0 bg-neutral-800 hover:bg-neutral-700 rounded-lg flex items-center justify-center transition-colors"
                    >
                      {uploading ? (
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <svg className="w-6 h-6 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      )}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
