interface StoryViewerProgressProps {
  totalStories: number;
  storyIndex: number;
  progress: number;
}

export function StoryViewerProgress({ totalStories, storyIndex, progress }: StoryViewerProgressProps) {
  return (
    <div className="absolute top-0 left-0 right-0 z-20 px-2 pt-2 flex gap-1">
      {Array.from({ length: totalStories }).map((_, idx) => (
        <div key={`progress-${idx}`} className="flex-1 h-0.5 bg-neutral-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-white transition-all duration-100"
            style={{
              width: idx < storyIndex
                ? '100%'
                : idx === storyIndex
                  ? `${progress}%`
                  : '0%',
            }}
          />
        </div>
      ))}
    </div>
  );
}
