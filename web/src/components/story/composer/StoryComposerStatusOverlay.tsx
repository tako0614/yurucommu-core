interface StoryComposerStatusOverlayProps {
  ffmpegLoading: boolean;
  posting: boolean;
  progress: number;
}

export function StoryComposerStatusOverlay({
  ffmpegLoading,
  posting,
  progress,
}: StoryComposerStatusOverlayProps) {
  return (
    <>
      {ffmpegLoading && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 bg-black/80 backdrop-blur-sm rounded-2xl px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
            <span className="text-white">動画機能を準備中...</span>
          </div>
        </div>
      )}

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
    </>
  );
}
