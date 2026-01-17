import { useState, useEffect, useRef, useCallback } from 'react';
import { ActorStories } from '../../types';
import { markStoryViewed, deleteStory, voteOnStory, likeStory, unlikeStory, shareStory } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { formatRelativeTime } from '../../lib/datetime';
import { ErrorIcon } from './viewer/StoryViewerIcons';
import { StoryViewerActionBar } from './viewer/StoryViewerActionBar';
import { StoryViewerDeleteDialog } from './viewer/StoryViewerDeleteDialog';
import { StoryViewerHeader } from './viewer/StoryViewerHeader';
import { renderStoryOverlay } from './viewer/StoryViewerOverlays';
import { StoryViewerProgress } from './viewer/StoryViewerProgress';
import { parseStoryDuration } from './viewer/storyViewerUtils';

interface StoryViewerProps {
  actorStories: ActorStories[];
  initialActorIndex: number;
  currentUserApId?: string;
  onClose: () => void;
}
export function StoryViewer({ actorStories, initialActorIndex, currentUserApId, onClose }: StoryViewerProps) {
  const { t } = useI18n();
  const [localActorStories, setLocalActorStories] = useState(actorStories);
  const [actorIndex, setActorIndex] = useState(initialActorIndex);
  const [storyIndex, setStoryIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [videoReady, setVideoReady] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const storyContainerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const currentActorStories = localActorStories[actorIndex];
  const currentStory = currentActorStories?.stories[storyIndex];
  const isOwnStory = currentUserApId && currentActorStories?.actor.ap_id === currentUserApId;
  const isLiked = !!currentStory?.liked;

  useEffect(() => {
    setLocalActorStories(actorStories);
  }, [actorStories]);

  useEffect(() => {
    if (!toastMessage) return;
    const timeoutId = window.setTimeout(() => setToastMessage(null), 2000);
    return () => window.clearTimeout(timeoutId);
  }, [toastMessage]);

  // Update container size for overlay positioning
  useEffect(() => {
    const updateSize = () => {
      if (storyContainerRef.current) {
        const rect = storyContainerRef.current.getBoundingClientRect();
        setContainerSize({ width: rect.width, height: rect.height });
      }
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, [currentStory]);

  // Mark story as viewed when displaying
  useEffect(() => {
    if (currentStory && !currentStory.viewed) {
      markStoryViewed(currentStory.ap_id).catch(console.error);
    }
  }, [currentStory?.ap_id]);

  // Reset media states when story changes
  useEffect(() => {
    setMediaError(false);
    setVideoReady(false);
    setShowDeleteConfirm(false);
  }, [actorIndex, storyIndex]);

  // Check if current story is a video
  const isVideo = currentStory?.attachment?.mediaType?.startsWith('video/') ?? false;

  // Auto-advance timer (for images only, videos use onEnded)
  const startTimer = useCallback(() => {
    if (!currentStory || isVideo) return;

    const duration = parseStoryDuration(currentStory.displayDuration);
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
  }, [currentStory, isPaused, isVideo]);

  useEffect(() => {
    if (!isPaused && !isVideo) {
      setProgress(0);
      startTimer();
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    };
  }, [actorIndex, storyIndex, isPaused, startTimer, isVideo]);

  // Navigation functions (defined first for dependency order)
  const goNext = useCallback(() => {
    if (!currentActorStories) return;

    const currentStoriesLen = currentActorStories.stories.length;

    // Next story from same user
    if (storyIndex < currentStoriesLen - 1) {
      setStoryIndex(storyIndex + 1);
      return;
    }

    // Next user
    if (actorIndex < localActorStories.length - 1) {
      setActorIndex(actorIndex + 1);
      setStoryIndex(0);
      return;
    }

    // End of all stories
    onClose();
  }, [actorIndex, storyIndex, currentActorStories, localActorStories.length, onClose]);

  const goPrev = useCallback(() => {
    // Previous story from same user
    if (storyIndex > 0) {
      setStoryIndex(storyIndex - 1);
      return;
    }

    // Previous user
    if (actorIndex > 0) {
      setActorIndex(actorIndex - 1);
      const prevActorStories = localActorStories[actorIndex - 1];
      const lastStoryIndex = prevActorStories.stories.length - 1;
      setStoryIndex(lastStoryIndex);
      return;
    }

    // At the beginning, restart current story
    setProgress(0);
  }, [actorIndex, storyIndex, localActorStories]);

  const handleVote = useCallback(async (storyApId: string, optionIndex: number) => {
    const result = await voteOnStory(storyApId, optionIndex);
    setLocalActorStories(prev =>
      prev.map(group => ({
        ...group,
        stories: group.stories.map(story => {
          if (story.ap_id !== storyApId) return story;
          return {
            ...story,
            votes: result.votes,
            votes_total: result.total,
            user_vote: result.user_vote,
          };
        }),
      }))
    );
  }, []);

  const handleLike = useCallback(async () => {
    if (!currentStory) return;
    try {
      const result = currentStory.liked
        ? await unlikeStory(currentStory.ap_id)
        : await likeStory(currentStory.ap_id);
      setLocalActorStories(prev =>
        prev.map(group => ({
          ...group,
          stories: group.stories.map(story =>
            story.ap_id === currentStory.ap_id
              ? { ...story, liked: result.liked, like_count: result.like_count }
              : story
          ),
        }))
      );
    } catch (err) {
      console.error('Failed to toggle story like:', err);
      setToastMessage(t('common.error'));
    }
  }, [currentStory, t]);

  const handleShare = useCallback(async () => {
    if (!currentStory) return;
    const shareUrl = currentStory.ap_id;
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${currentActorStories?.actor?.name || currentActorStories?.actor?.preferred_username || 'Story'}`,
          url: shareUrl,
        });
        try {
          const result = await shareStory(currentStory.ap_id);
          setLocalActorStories(prev =>
            prev.map(group => ({
              ...group,
              stories: group.stories.map(story =>
                story.ap_id === currentStory.ap_id
                  ? { ...story, share_count: result.share_count }
                  : story
              ),
            }))
          );
        } catch (err) {
          console.error('Failed to record story share:', err);
          setToastMessage(t('story.shareRecordFailed'));
        }
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(shareUrl);
        setToastMessage(t('story.shareCopied'));
        try {
          const result = await shareStory(currentStory.ap_id);
          setLocalActorStories(prev =>
            prev.map(group => ({
              ...group,
              stories: group.stories.map(story =>
                story.ap_id === currentStory.ap_id
                  ? { ...story, share_count: result.share_count }
                  : story
              ),
            }))
          );
        } catch (err) {
          console.error('Failed to record story share:', err);
          setToastMessage(t('story.shareRecordFailed'));
        }
      }
    } catch (err) {
      console.error('Failed to share story:', err);
      setToastMessage(t('story.shareFailed'));
    }
  }, [currentStory, currentActorStories?.actor, t]);

  // Handle video ended event
  const handleVideoEnded = useCallback(() => {
    goNext();
  }, [goNext]);

  // Handle video time update for progress bar
  const handleVideoTimeUpdate = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    if (video.duration) {
      setProgress((video.currentTime / video.duration) * 100);
    }
  }, []);

  // Handle video loaded metadata
  const handleVideoLoadedMetadata = useCallback(() => {
    setVideoReady(true);
    setProgress(0);
  }, []);

  // Handle media error
  const handleMediaError = useCallback(() => {
    setMediaError(true);
  }, []);

  // Handle delete story
  const handleDeleteStory = useCallback(() => {
    setShowDeleteConfirm(true);
  }, []);

  // Confirm delete story
  const confirmDelete = useCallback(async () => {
    if (!currentStory) return;

    try {
      await deleteStory(currentStory.ap_id);
      // Navigate to next story or close
      if (currentActorStories.stories.length === 1) {
        // Last story from this user
        if (actorIndex < localActorStories.length - 1) {
          setActorIndex(actorIndex + 1);
          setStoryIndex(0);
        } else {
          onClose();
        }
      } else {
        // Same user's next story
        goNext();
      }
    } catch (e) {
      console.error('Failed to delete story:', e);
      setToastMessage(t('common.error'));
    } finally {
      setShowDeleteConfirm(false);
    }
  }, [currentStory, currentActorStories, actorIndex, localActorStories.length, goNext, onClose, t]);

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

  if (!currentActorStories || !currentStory) {
    return null;
  }

  // Total stories for this user (for progress bar)
  const totalStories = currentActorStories.stories.length;

  return (
    <div className="fixed inset-0 z-51 bg-black">
      <StoryViewerProgress
        totalStories={totalStories}
        storyIndex={storyIndex}
        progress={progress}
      />

      <StoryViewerHeader
        actor={currentActorStories.actor}
        timeLabel={formatRelativeTime(currentStory.published, { maxDays: 1 })}
        isVideo={isVideo}
        isMuted={isMuted}
        isOwnStory={Boolean(isOwnStory)}
        onToggleMute={() => setIsMuted(!isMuted)}
        onDelete={handleDeleteStory}
        onClose={onClose}
      />

      {/* Main content area - vertical 9:16 container */}
      <div
        ref={containerRef}
        className="absolute inset-0 flex items-center justify-center cursor-pointer"
        onClick={handleClick}
        onMouseDown={handleTouchStart}
        onMouseUp={handleTouchEnd}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Vertical story container (9:16 aspect ratio) */}
        <div
          ref={storyContainerRef}
          className="relative w-full h-full sm:w-auto sm:h-[calc(100vh-2rem)] sm:aspect-[9/16] sm:max-h-[900px] bg-neutral-900 overflow-hidden sm:rounded-xl"
        >
          {/* Media content - directly from story.attachment */}
          {!mediaError && currentStory.attachment.mediaType.startsWith('image/') ? (
            <img
              src={currentStory.attachment.url || `/media/${currentStory.attachment.r2_key}`}
              alt=""
              className="w-full h-full object-cover"
              draggable={false}
              onError={handleMediaError}
            />
          ) : !mediaError && currentStory.attachment.mediaType.startsWith('video/') ? (
            <video
              src={currentStory.attachment.url || `/media/${currentStory.attachment.r2_key}`}
              className="w-full h-full object-cover"
              autoPlay={videoReady}
              muted={isMuted}
              playsInline
              onEnded={handleVideoEnded}
              onTimeUpdate={handleVideoTimeUpdate}
              onLoadedMetadata={handleVideoLoadedMetadata}
              onError={handleMediaError}
            />
          ) : null}

          {/* Media error fallback */}
          {mediaError && (
            <div className="absolute inset-0 flex items-center justify-center bg-neutral-900">
              <div className="text-center text-neutral-400">
                <ErrorIcon />
                <p className="mt-2">繝｡繝・ぅ繧｢繧定ｪｭ縺ｿ霎ｼ繧√∪縺帙ｓ縺ｧ縺励◆</p>
              </div>
            </div>
          )}

          {/* Overlays rendering */}
          {currentStory.overlays && containerSize.width > 0 && (
            <div className="absolute inset-0 pointer-events-none">
              <div className="pointer-events-auto">
                {currentStory.overlays.map((overlay, idx) => (
                  <div key={idx}>
                    {renderStoryOverlay(
                      overlay,
                      containerSize,
                      currentStory.ap_id,
                      currentStory.votes,
                      currentStory.votes_total,
                      currentStory.user_vote,
                      handleVote
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {toastMessage && (
        <div className="absolute bottom-24 left-1/2 z-30 -translate-x-1/2 rounded-full bg-black/80 px-4 py-2 text-sm text-white shadow-lg">
          {toastMessage}
        </div>
      )}

      <StoryViewerActionBar
        isLiked={isLiked}
        onLike={handleLike}
        onShare={handleShare}
      />

      <StoryViewerDeleteDialog
        open={showDeleteConfirm}
        onCancel={() => setShowDeleteConfirm(false)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

