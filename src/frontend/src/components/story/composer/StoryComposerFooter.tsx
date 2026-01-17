interface StoryComposerFooterProps {
  caption: string;
  onCaptionChange: (value: string) => void;
  onPost: () => void;
  canPost: boolean;
  posting: boolean;
  progress: number;
  videoFile: File | null;
  ffmpegReady: boolean;
  error: string | null;
  onDismissError: () => void;
}

const SendIcon = () => (
  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
  </svg>
);

export function StoryComposerFooter({
  caption,
  onCaptionChange,
  onPost,
  canPost,
  posting,
  progress,
  videoFile,
  ffmpegReady,
  error,
  onDismissError,
}: StoryComposerFooterProps) {
  const postDisabled = !canPost || posting || !!(videoFile && !ffmpegReady);

  return (
    <div
      className="absolute left-0 right-0 bottom-0 z-10 bg-gradient-to-t from-black via-black/90 to-transparent"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 16px)' }}
    >
      <div className="px-4 pt-8 pb-3">
        <input
          type="text"
          value={caption}
          onChange={(e) => onCaptionChange(e.target.value)}
          placeholder="キャプションを追加..."
          className="w-full bg-transparent text-white placeholder-white/50 text-base py-2 outline-none"
        />
      </div>

      <div className="flex items-center gap-3 px-4 pb-2">
        <button
          onClick={onPost}
          disabled={postDisabled}
          className="flex-1 flex items-center justify-center gap-2 py-3.5 bg-neutral-800 hover:bg-neutral-700 rounded-full text-white font-medium disabled:opacity-50 transition-all"
        >
          <span className="w-7 h-7 rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 flex items-center justify-center border-2 border-black">
            <span className="w-4 h-4 rounded-full bg-black"></span>
          </span>
          <span>{posting ? `${Math.round(progress)}%` : 'ストーリーズ'}</span>
        </button>

        <button
          onClick={onPost}
          disabled={postDisabled}
          className="flex-1 flex items-center justify-center gap-2 py-3.5 bg-neutral-800 hover:bg-neutral-700 rounded-full text-white font-medium disabled:opacity-50 transition-all"
        >
          <span className="w-7 h-7 rounded-full bg-green-500 flex items-center justify-center">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </span>
          <span>親しい友達</span>
        </button>

        <button
          onClick={onPost}
          disabled={postDisabled}
          className="w-12 h-12 flex items-center justify-center bg-blue-500 hover:bg-blue-600 rounded-full text-white disabled:opacity-50 transition-all"
        >
          <SendIcon />
        </button>
      </div>

      {error && (
        <div className="mx-4 mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-xl">
          <p className="text-red-400 text-sm">{error}</p>
          <button
            onClick={onDismissError}
            className="text-red-400/70 text-xs mt-1 hover:text-red-400"
          >
            閉じる
          </button>
        </div>
      )}
    </div>
  );
}
