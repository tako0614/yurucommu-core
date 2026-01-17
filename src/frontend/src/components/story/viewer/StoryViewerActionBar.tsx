interface StoryViewerActionBarProps {
  isLiked: boolean;
  onLike: () => void;
  onShare: () => void;
}

export function StoryViewerActionBar({ isLiked, onLike, onShare }: StoryViewerActionBarProps) {
  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 p-4 flex items-center gap-3">
      <div className="flex-1 flex items-center gap-2 border border-white/40 rounded-full px-4 py-2">
        <input
          type="text"
          placeholder="繝｡繝・そ繝ｼ繧ｸ繧帝∽ｿ｡..."
          className="flex-1 bg-transparent text-white placeholder-white/50 text-sm outline-none"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
        />
        <button
          className="text-white/70 hover:text-white transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </button>
      </div>
      <button
        className={`p-2 transition-colors ${isLiked ? 'text-red-400' : 'text-white hover:text-red-400'}`}
        onClick={(e) => {
          e.stopPropagation();
          onLike();
        }}
      >
        <svg className="w-7 h-7" fill={isLiked ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
        </svg>
      </button>
      <button
        className="p-2 text-white hover:text-white/70 transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          onShare();
        }}
      >
        <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
        </svg>
      </button>
    </div>
  );
}
