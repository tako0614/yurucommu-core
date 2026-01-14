import { useState, useEffect, useRef, useCallback } from 'react';
import { ActorStories, Story, StoryFrame } from '../types';
import { markStoryViewed } from '../lib/api';
import { UserAvatar } from './UserAvatar';

interface StoryViewerProps {
  actorStories: ActorStories[];
  initialActorIndex: number;
  onClose: () => void;
}

const CloseIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

// Parse ISO 8601 duration (e.g., "PT5S" -> 5000ms)
function parseDuration(duration: string): number {
  const match = duration.match(/PT(\d+)S/);
  if (match) {
    return parseInt(match[1]) * 1000;
  }
  // Default to 5 seconds
  return 5000;
}

// Format relative time
function formatTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  return date.toLocaleDateString();
}

export function StoryViewer({ actorStories, initialActorIndex, onClose }: StoryViewerProps) {
  const [actorIndex, setActorIndex] = useState(initialActorIndex);
  const [storyIndex, setStoryIndex] = useState(0);
  const [frameIndex, setFrameIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const currentActorStories = actorStories[actorIndex];
  const currentStory = currentActorStories?.stories[storyIndex];
  const currentFrame = currentStory?.frames[frameIndex];

  // Mark story as viewed when displaying
  useEffect(() => {
    if (currentStory && !currentStory.viewed) {
      markStoryViewed(currentStory.ap_id).catch(console.error);
    }
  }, [currentStory?.ap_id]);

  // Auto-advance timer
  const startTimer = useCallback(() => {
    if (!currentFrame) return;

    const duration = parseDuration(currentFrame.displayDuration);
    const startTime = Date.now();

    // Clear existing timers
    if (timerRef.current) clearTimeout(timerRef.current);
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);

    // Progress update
    progressTimerRef.current = setInterval(() => {
      if (isPaused) return;
      const elapsed = Date.now() - startTime;
      setProgress(Math.min((elapsed / duration) * 100, 100));
    }, 50);

    // Auto-advance
    timerRef.current = setTimeout(() => {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
      goNext();
    }, duration);
  }, [currentFrame, isPaused]);

  useEffect(() => {
    if (!isPaused) {
      setProgress(0);
      startTimer();
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    };
  }, [actorIndex, storyIndex, frameIndex, isPaused, startTimer]);

  // Navigation functions
  const goNext = useCallback(() => {
    if (!currentActorStories) return;

    const currentStoriesLen = currentActorStories.stories.length;
    const currentFramesLen = currentStory?.frames.length || 0;

    // Next frame in current story
    if (frameIndex < currentFramesLen - 1) {
      setFrameIndex(frameIndex + 1);
      return;
    }

    // Next story from same user
    if (storyIndex < currentStoriesLen - 1) {
      setStoryIndex(storyIndex + 1);
      setFrameIndex(0);
      return;
    }

    // Next user
    if (actorIndex < actorStories.length - 1) {
      setActorIndex(actorIndex + 1);
      setStoryIndex(0);
      setFrameIndex(0);
      return;
    }

    // End of all stories
    onClose();
  }, [actorIndex, storyIndex, frameIndex, currentActorStories, currentStory, actorStories.length, onClose]);

  const goPrev = useCallback(() => {
    // Previous frame in current story
    if (frameIndex > 0) {
      setFrameIndex(frameIndex - 1);
      return;
    }

    // Previous story from same user
    if (storyIndex > 0) {
      setStoryIndex(storyIndex - 1);
      setFrameIndex(0);
      return;
    }

    // Previous user
    if (actorIndex > 0) {
      setActorIndex(actorIndex - 1);
      const prevActorStories = actorStories[actorIndex - 1];
      const lastStoryIndex = prevActorStories.stories.length - 1;
      setStoryIndex(lastStoryIndex);
      setFrameIndex(0);
      return;
    }

    // At the beginning, restart current frame
    setProgress(0);
  }, [actorIndex, storyIndex, frameIndex, actorStories]);

  // Handle click/tap navigation
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const width = rect.width;

    // Left third: go back, Right two-thirds: go forward
    if (x < width / 3) {
      goPrev();
    } else {
      goNext();
    }
  };

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        goPrev();
      } else if (e.key === 'ArrowRight' || e.key === ' ') {
        goNext();
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goNext, goPrev, onClose]);

  // Pause on touch/hold
  const handleTouchStart = () => setIsPaused(true);
  const handleTouchEnd = () => setIsPaused(false);

  if (!currentActorStories || !currentStory || !currentFrame) {
    return null;
  }

  const totalFrames = currentActorStories.stories.reduce((acc, s) => acc + s.frames.length, 0);
  const currentFrameGlobalIndex = currentActorStories.stories
    .slice(0, storyIndex)
    .reduce((acc, s) => acc + s.frames.length, 0) + frameIndex;

  return (
    <div className="fixed inset-0 z-50 bg-black">
      {/* Progress bars */}
      <div className="absolute top-0 left-0 right-0 z-20 px-2 pt-2 flex gap-1">
        {Array.from({ length: totalFrames }).map((_, idx) => (
          <div key={idx} className="flex-1 h-0.5 bg-neutral-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-white transition-all duration-100"
              style={{
                width: idx < currentFrameGlobalIndex
                  ? '100%'
                  : idx === currentFrameGlobalIndex
                    ? `${progress}%`
                    : '0%'
              }}
            />
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="absolute top-4 left-0 right-0 z-20 px-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <UserAvatar
            avatarUrl={currentActorStories.actor.icon_url}
            name={currentActorStories.actor.name || currentActorStories.actor.preferred_username}
            size={32}
          />
          <div>
            <p className="text-white text-sm font-medium">
              {currentActorStories.actor.name || currentActorStories.actor.preferred_username}
            </p>
            <p className="text-neutral-400 text-xs">{formatTime(currentStory.published)}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 text-white hover:bg-white/10 rounded-full transition-colors"
        >
          <CloseIcon />
        </button>
      </div>

      {/* Main content area */}
      <div
        ref={containerRef}
        className="absolute inset-0 flex items-center justify-center cursor-pointer"
        onClick={handleClick}
        onMouseDown={handleTouchStart}
        onMouseUp={handleTouchEnd}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Media content */}
        {currentFrame.attachment.mediaType.startsWith('image/') ? (
          <img
            src={currentFrame.attachment.url || `/media/${currentFrame.attachment.r2_key}`}
            alt=""
            className="max-w-full max-h-full object-contain"
            draggable={false}
          />
        ) : currentFrame.attachment.mediaType.startsWith('video/') ? (
          <video
            src={currentFrame.attachment.url || `/media/${currentFrame.attachment.r2_key}`}
            className="max-w-full max-h-full object-contain"
            autoPlay
            muted
            playsInline
          />
        ) : null}

        {/* Text overlay */}
        {currentFrame.content && (
          <div className="absolute bottom-24 left-4 right-4 text-center">
            <p className="text-white text-lg font-medium drop-shadow-lg bg-black/30 px-4 py-2 rounded-lg">
              {currentFrame.content}
            </p>
          </div>
        )}
      </div>

      {/* Navigation hints */}
      <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-2">
        {actorStories.map((as, idx) => (
          <button
            key={as.actor.ap_id}
            onClick={() => {
              setActorIndex(idx);
              setStoryIndex(0);
              setFrameIndex(0);
            }}
            className={`w-2 h-2 rounded-full transition-colors ${
              idx === actorIndex ? 'bg-white' : 'bg-white/30'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
