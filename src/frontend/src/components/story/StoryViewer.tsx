import { useState, useEffect, useRef, useCallback } from 'react';
import { ActorStories, StoryOverlay } from '../../types';
import { markStoryViewed, deleteStory, voteOnStory, likeStory, unlikeStory } from '../../lib/api';
import { UserAvatar } from '../UserAvatar';

interface StoryViewerProps {
  actorStories: ActorStories[];
  initialActorIndex: number;
  currentUserApId?: string;
  onClose: () => void;
}

const CloseIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const TrashIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);

const ErrorIcon = () => (
  <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
);

const MutedIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
  </svg>
);

const UnmutedIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
  </svg>
);

// Validate URL for XSS protection - only allow http: and https: protocols
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

// Parse ISO 8601 duration (e.g., "PT5S", "PT1M30S", "PT1H2M30S" -> ms)
function parseDuration(duration: string): number {
  let totalMs = 0;

  const hoursMatch = duration.match(/(\d+)H/);
  const minutesMatch = duration.match(/(\d+)M/);
  const secondsMatch = duration.match(/(\d+)S/);

  if (hoursMatch) totalMs += parseInt(hoursMatch[1]) * 3600000;
  if (minutesMatch) totalMs += parseInt(minutesMatch[1]) * 60000;
  if (secondsMatch) totalMs += parseInt(secondsMatch[1]) * 1000;

  // Default 5 seconds, max 60 seconds
  return totalMs > 0 ? Math.min(totalMs, 60000) : 5000;
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

// Render overlay based on type
function renderOverlay(
  overlay: StoryOverlay,
  containerSize: { width: number; height: number },
  storyApId: string,
  votes?: { [key: number]: number },
  votesTotal?: number,
  userVote?: number,
  onVote?: (storyApId: string, optionIndex: number) => Promise<void>
) {
  const { position } = overlay;

  // Convert relative position to pixels
  const left = position.x * containerSize.width - (position.width * containerSize.width) / 2;
  const top = position.y * containerSize.height - (position.height * containerSize.height) / 2;
  const width = position.width * containerSize.width;
  const height = position.height * containerSize.height;

  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  };

  // Render Question (Poll) overlay
  if (overlay.type === 'Question' && overlay.name && overlay.oneOf) {
    const hasVotes = votesTotal && votesTotal > 0;
    const hasUserVoted = userVote !== undefined && userVote !== null;

    return (
      <div key={`overlay-${overlay.name}`} style={style}>
        <div className="bg-black/60 backdrop-blur-sm rounded-xl p-3 w-full">
          <p className="text-white text-sm font-medium text-center mb-2">{overlay.name}</p>
          <div className="flex gap-2">
            {overlay.oneOf.map((option, idx) => {
              const voteCount = votes?.[idx] || 0;
              const percentage = hasVotes ? Math.round((voteCount / votesTotal!) * 100) : 0;
              const isSelected = userVote === idx;

              return (
                <button
                  key={idx}
                  className={`flex-1 relative overflow-hidden text-white text-sm py-2 px-3 rounded-lg transition-colors ${
                    isSelected ? 'ring-2 ring-white' : ''
                  } ${hasUserVoted ? 'cursor-default' : 'hover:bg-white/30'}`}
                  style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (hasUserVoted) return; // Already voted
                    try {
                      if (onVote) {
                        await onVote(storyApId, idx);
                      } else {
                        await voteOnStory(storyApId, idx);
                      }
                    } catch (err) {
                      console.error('Failed to vote:', err);
                    }
                  }}
                  disabled={hasUserVoted}
                >
                  {/* Vote bar (shown when results are available) */}
                  {hasVotes && (
                    <div
                      className="absolute inset-0 bg-white/20 transition-all"
                      style={{ width: `${percentage}%` }}
                    />
                  )}
                  <span className="relative z-10 flex items-center justify-between">
                    <span>{option.name}</span>
                    {hasVotes && (
                      <span className="text-xs ml-2">{percentage}%</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          {hasVotes && (
            <p className="text-white/60 text-xs text-center mt-2">{votesTotal}票</p>
          )}
        </div>
      </div>
    );
  }

  // Render Note (text) overlay
  if (overlay.type === 'Note' && overlay.name) {
    return (
      <div key={`overlay-note-${overlay.name}`} style={style}>
        <p className="text-white text-lg font-medium drop-shadow-lg bg-black/30 px-4 py-2 rounded-lg text-center">
          {overlay.name}
        </p>
      </div>
    );
  }

  // Render Link overlay
  if (overlay.type === 'Link' && (overlay as unknown as { href?: string }).href) {
    const linkOverlay = overlay as unknown as { href: string; name?: string };

    // URL validation - only allow safe protocols
    if (!isValidUrl(linkOverlay.href)) {
      return null; // Don't render invalid URLs
    }

    return (
      <div key={`overlay-link-${linkOverlay.href}`} style={style}>
        <a
          href={linkOverlay.href}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-white text-black text-sm font-medium px-4 py-2 rounded-full hover:bg-neutral-200 transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          {linkOverlay.name || 'リンクを開く'}
        </a>
      </div>
    );
  }

  // Default: render nothing for unknown types
  return null;
}

export function StoryViewer({ actorStories, initialActorIndex, currentUserApId, onClose }: StoryViewerProps) {
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

    const duration = parseDuration(currentStory.displayDuration);
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
    }
  }, [currentStory]);

  const handleShare = useCallback(async () => {
    if (!currentStory) return;
    const shareUrl = currentStory.ap_id;
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${currentActorStories?.actor?.name || currentActorStories?.actor?.preferred_username || 'Story'}`,
          url: shareUrl,
        });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(shareUrl);
        alert('リンクをコピーしました');
      }
    } catch (err) {
      console.error('Failed to share story:', err);
    }
  }, [currentStory, currentActorStories?.actor]);

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
    } finally {
      setShowDeleteConfirm(false);
    }
  }, [currentStory, currentActorStories, actorIndex, localActorStories.length, goNext, onClose]);

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
      {/* Progress bars - one per story */}
      <div className="absolute top-0 left-0 right-0 z-20 px-2 pt-2 flex gap-1">
        {Array.from({ length: totalStories }).map((_, idx) => (
          <div key={idx} className="flex-1 h-0.5 bg-neutral-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-white transition-all duration-100"
              style={{
                width: idx < storyIndex
                  ? '100%'
                  : idx === storyIndex
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
        <div className="flex items-center gap-1">
          {isVideo && (
            <button
              onClick={() => setIsMuted(!isMuted)}
              className="p-2 text-white hover:bg-white/10 rounded-full transition-colors"
            >
              {isMuted ? <MutedIcon /> : <UnmutedIcon />}
            </button>
          )}
          {isOwnStory && (
            <button
              onClick={handleDeleteStory}
              className="p-2 text-white hover:bg-white/10 rounded-full transition-colors"
            >
              <TrashIcon />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-2 text-white hover:bg-white/10 rounded-full transition-colors"
          >
            <CloseIcon />
          </button>
        </div>
      </div>

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
                <p className="mt-2">メディアを読み込めませんでした</p>
              </div>
            </div>
          )}

          {/* Overlays rendering */}
          {currentStory.overlays && containerSize.width > 0 && (
            <div className="absolute inset-0 pointer-events-none">
              <div className="pointer-events-auto">
                {currentStory.overlays.map((overlay, idx) => (
                  <div key={idx}>
                    {renderOverlay(
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

      {/* Action bar at bottom */}
      <div className="absolute bottom-0 left-0 right-0 z-20 p-4 flex items-center gap-3">
        {/* Message input */}
        <div className="flex-1 flex items-center gap-2 border border-white/40 rounded-full px-4 py-2">
          <input
            type="text"
            placeholder="メッセージを送信..."
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
        {/* Heart button */}
        <button
          className={`p-2 transition-colors ${isLiked ? 'text-red-400' : 'text-white hover:text-red-400'}`}
          onClick={(e) => {
            e.stopPropagation();
            handleLike();
          }}
        >
          <svg className="w-7 h-7" fill={isLiked ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
          </svg>
        </button>
        {/* Share/Send button */}
        <button
          className="p-2 text-white hover:text-white/70 transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            handleShare();
          }}
        >
          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
        </button>
      </div>

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
        <div className="absolute inset-0 z-30 bg-black/80 flex items-center justify-center">
          <div className="bg-neutral-800 rounded-2xl p-6 max-w-xs mx-4">
            <h3 className="text-white font-semibold text-lg mb-2">ストーリーを削除</h3>
            <p className="text-neutral-400 text-sm mb-4">このストーリーを削除しますか？この操作は取り消せません。</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 px-4 py-2 bg-neutral-700 hover:bg-neutral-600 rounded-lg text-white transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={confirmDelete}
                className="flex-1 px-4 py-2 bg-red-500 hover:bg-red-600 rounded-lg text-white transition-colors"
              >
                削除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
