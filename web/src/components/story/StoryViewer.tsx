import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { ActorStories } from "../../types/index.ts";
import {
  deleteStory,
  likeStory,
  markStoryViewed,
  shareStory,
  unlikeStory,
  voteOnStory,
} from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { formatRelativeTime } from "../../lib/datetime.ts";
import { ErrorIcon } from "./viewer/StoryViewerIcons.tsx";
import { StoryViewerActionBar } from "./viewer/StoryViewerActionBar.tsx";
import { StoryViewerDeleteDialog } from "./viewer/StoryViewerDeleteDialog.tsx";
import { StoryViewerHeader } from "./viewer/StoryViewerHeader.tsx";
import { renderStoryOverlay } from "./viewer/StoryViewerOverlays.tsx";
import { StoryViewerProgress } from "./viewer/StoryViewerProgress.tsx";
import { parseStoryDuration } from "./viewer/storyViewerUtils.ts";

interface StoryViewerProps {
  actorStories: ActorStories[];
  initialActorIndex: number;
  currentUserApId?: string;
  onClose: () => void;
}
export function StoryViewer(props: StoryViewerProps) {
  const { t } = useI18n();
  const [localActorStories, setLocalActorStories] = createSignal(
    props.actorStories,
  );
  const [actorIndex, setActorIndex] = createSignal(props.initialActorIndex);
  const [storyIndex, setStoryIndex] = createSignal(0);
  const [progress, setProgress] = createSignal(0);
  const [isPaused, setIsPaused] = createSignal(false);
  let isPausedRef = false;
  const [containerSize, setContainerSize] = createSignal({
    width: 0,
    height: 0,
  });
  const [videoReady, setVideoReady] = createSignal(false);
  const [mediaError, setMediaError] = createSignal(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = createSignal(false);
  const [isMuted, setIsMuted] = createSignal(true);
  const [toastMessage, setToastMessage] = createSignal<string | null>(null);
  let containerRef!: HTMLDivElement;
  let storyContainerRef!: HTMLDivElement;
  let timerRef: ReturnType<typeof setTimeout> | null = null;
  let progressTimerRef: ReturnType<typeof setInterval> | null = null;

  const currentActorStories = createMemo(
    () => localActorStories()[actorIndex()],
  );
  const currentStory = createMemo(
    () => currentActorStories()?.stories[storyIndex()],
  );
  const isOwnStory = createMemo(
    () =>
      props.currentUserApId != null &&
      currentActorStories()?.actor.ap_id === props.currentUserApId,
  );
  const isLiked = createMemo(() => !!currentStory()?.liked);

  createEffect(() => {
    setLocalActorStories(props.actorStories);
  });

  createEffect(() => {
    const msg = toastMessage();
    if (!msg) return;
    const timeoutId = window.setTimeout(() => setToastMessage(null), 2000);
    onCleanup(() => window.clearTimeout(timeoutId));
  });

  // Update container size for overlay positioning
  createEffect(() => {
    // Track currentStory to re-run when story changes
    currentStory();
    const updateSize = () => {
      if (storyContainerRef) {
        const rect = storyContainerRef.getBoundingClientRect();
        setContainerSize({ width: rect.width, height: rect.height });
      }
    };

    updateSize();
    window.addEventListener("resize", updateSize);
    onCleanup(() => window.removeEventListener("resize", updateSize));
  });

  // Mark story as viewed when displaying
  createEffect(() => {
    const story = currentStory();
    if (story && !story.viewed) {
      markStoryViewed(story.ap_id).catch(console.error);
    }
  });

  // Reset media states when story changes
  createEffect(() => {
    // Track both indices
    actorIndex();
    storyIndex();
    setMediaError(false);
    setVideoReady(false);
    setShowDeleteConfirm(false);
  });

  // Check if current story is a video
  const isVideo = createMemo(
    () => currentStory()?.attachment?.mediaType?.startsWith("video/") ?? false,
  );

  // Keep ref in sync with state for use in interval callback
  createEffect(() => {
    isPausedRef = isPaused();
  });

  // Navigation functions
  const goNext = () => {
    const cas = currentActorStories();
    if (!cas?.stories) return;

    const currentStoriesLen = cas.stories.length;

    // Next story from same user
    if (storyIndex() < currentStoriesLen - 1) {
      setStoryIndex(storyIndex() + 1);
      return;
    }

    // Next user
    if (actorIndex() < localActorStories().length - 1) {
      setActorIndex(actorIndex() + 1);
      setStoryIndex(0);
      return;
    }

    // End of all stories
    props.onClose();
  };

  const goPrev = () => {
    // Previous story from same user
    if (storyIndex() > 0) {
      setStoryIndex(storyIndex() - 1);
      return;
    }

    // Previous user
    if (actorIndex() > 0) {
      setActorIndex(actorIndex() - 1);
      const prevActorStories = localActorStories()[actorIndex() - 1];
      const lastStoryIndex = prevActorStories.stories.length - 1;
      setStoryIndex(lastStoryIndex);
      return;
    }

    // At the beginning, restart current story
    setProgress(0);
  };

  // Auto-advance timer (for images only, videos use onEnded)
  const startTimer = () => {
    const story = currentStory();
    if (!story || isVideo()) return;

    const duration = parseStoryDuration(story.displayDuration);
    const startTime = Date.now();

    // Clear existing timers
    if (timerRef) clearTimeout(timerRef);
    if (progressTimerRef) clearInterval(progressTimerRef);

    // Progress update - use ref to avoid stale closure
    progressTimerRef = setInterval(() => {
      if (isPausedRef) return;
      const elapsed = Date.now() - startTime;
      setProgress(Math.min((elapsed / duration) * 100, 100));
    }, 50);

    // Auto-advance
    timerRef = setTimeout(() => {
      if (progressTimerRef) clearInterval(progressTimerRef);
      goNext();
    }, duration);
  };

  createEffect(() => {
    // Track dependencies
    actorIndex();
    storyIndex();
    const paused = isPaused();
    const video = isVideo();

    if (!paused && !video) {
      setProgress(0);
      startTimer();
    }

    onCleanup(() => {
      if (timerRef) clearTimeout(timerRef);
      if (progressTimerRef) clearInterval(progressTimerRef);
    });
  });

  const handleVote = async (storyApId: string, optionIndex: number) => {
    const result = await voteOnStory(storyApId, optionIndex);
    setLocalActorStories((prev) =>
      prev.map((group) => ({
        ...group,
        stories: group.stories.map((story) => {
          if (story.ap_id !== storyApId) return story;
          return {
            ...story,
            votes: result.votes,
            votes_total: result.total,
            user_vote: result.user_vote,
          };
        }),
      })),
    );
  };

  const handleLike = async () => {
    const story = currentStory();
    if (!story) return;
    try {
      const result = story.liked
        ? await unlikeStory(story.ap_id)
        : await likeStory(story.ap_id);
      setLocalActorStories((prev) =>
        prev.map((group) => ({
          ...group,
          stories: group.stories.map((s) =>
            s.ap_id === story.ap_id
              ? { ...s, liked: result.liked, like_count: result.like_count }
              : s,
          ),
        })),
      );
    } catch (err) {
      console.error("Failed to toggle story like:", err);
      setToastMessage(t("common.error"));
    }
  };

  const handleShare = async () => {
    const story = currentStory();
    if (!story) return;
    const shareUrl = story.ap_id;
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${
            currentActorStories()?.actor?.name ||
            currentActorStories()?.actor?.preferred_username ||
            "Story"
          }`,
          url: shareUrl,
        });
        try {
          const result = await shareStory(story.ap_id);
          setLocalActorStories((prev) =>
            prev.map((group) => ({
              ...group,
              stories: group.stories.map((s) =>
                s.ap_id === story.ap_id
                  ? { ...s, share_count: result.share_count }
                  : s,
              ),
            })),
          );
        } catch (err) {
          console.error("Failed to record story share:", err);
          setToastMessage(t("story.shareRecordFailed"));
        }
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(shareUrl);
        setToastMessage(t("story.shareCopied"));
        try {
          const result = await shareStory(story.ap_id);
          setLocalActorStories((prev) =>
            prev.map((group) => ({
              ...group,
              stories: group.stories.map((s) =>
                s.ap_id === story.ap_id
                  ? { ...s, share_count: result.share_count }
                  : s,
              ),
            })),
          );
        } catch (err) {
          console.error("Failed to record story share:", err);
          setToastMessage(t("story.shareRecordFailed"));
        }
      }
    } catch (err) {
      console.error("Failed to share story:", err);
      setToastMessage(t("story.shareFailed"));
    }
  };

  // Handle video ended event
  const handleVideoEnded = () => {
    goNext();
  };

  // Handle video time update for progress bar
  const handleVideoTimeUpdate = (e: Event) => {
    const video = e.currentTarget as HTMLVideoElement;
    if (video.duration) {
      setProgress((video.currentTime / video.duration) * 100);
    }
  };

  // Handle video loaded metadata
  const handleVideoLoadedMetadata = () => {
    setVideoReady(true);
    setProgress(0);
  };

  // Handle media error
  const handleMediaError = () => {
    setMediaError(true);
  };

  // Handle delete story
  const handleDeleteStory = () => {
    setShowDeleteConfirm(true);
  };

  // Confirm delete story
  const confirmDelete = async () => {
    const story = currentStory();
    if (!story) return;

    try {
      await deleteStory(story.ap_id);
      // Navigate to next story or close
      if (currentActorStories()!.stories.length === 1) {
        // Last story from this user
        if (actorIndex() < localActorStories().length - 1) {
          setActorIndex(actorIndex() + 1);
          setStoryIndex(0);
        } else {
          props.onClose();
        }
      } else {
        // Same user's next story
        goNext();
      }
    } catch (e) {
      console.error("Failed to delete story:", e);
      setToastMessage(t("common.error"));
    } finally {
      setShowDeleteConfirm(false);
    }
  };

  // Handle click/tap navigation
  const handleClick = (e: MouseEvent) => {
    const rect = containerRef?.getBoundingClientRect();
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
  createEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        goPrev();
      } else if (e.key === "ArrowRight" || e.key === " ") {
        goNext();
      } else if (e.key === "Escape") {
        props.onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  // Pause on touch/hold
  const handleTouchStart = () => setIsPaused(true);
  const handleTouchEnd = () => setIsPaused(false);

  return (
    <Show when={currentActorStories() && currentStory()}>
      <div class="fixed inset-0 z-51 bg-neutral-900">
        <StoryViewerProgress
          totalStories={currentActorStories()!.stories.length}
          storyIndex={storyIndex()}
          progress={progress()}
        />

        <StoryViewerHeader
          actor={currentActorStories()!.actor}
          timeLabel={formatRelativeTime(currentStory()!.published, {
            maxDays: 1,
          })}
          isVideo={isVideo()}
          isMuted={isMuted()}
          isOwnStory={Boolean(isOwnStory())}
          onToggleMute={() => setIsMuted(!isMuted())}
          onDelete={handleDeleteStory}
          onClose={props.onClose}
        />

        {/* Main content area - vertical 9:16 container */}
        <div
          ref={containerRef}
          class="absolute inset-0 flex items-center justify-center cursor-pointer"
          onClick={handleClick}
          onMouseDown={handleTouchStart}
          onMouseUp={handleTouchEnd}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* Vertical story container (9:16 aspect ratio) */}
          <div
            ref={storyContainerRef}
            class="relative w-full h-full sm:w-auto sm:h-[calc(100vh-2rem)] sm:aspect-[9/16] sm:max-h-[900px] bg-neutral-900 overflow-hidden sm:rounded-xl"
          >
            {/* Media content - directly from story.attachment */}
            <Show
              when={
                !mediaError() &&
                currentStory()!.attachment.mediaType.startsWith("image/")
              }
            >
              <img
                src={
                  currentStory()!.attachment.url ||
                  `/media/${currentStory()!.attachment.r2_key.replace(
                    /^uploads\//,
                    "",
                  )}`
                }
                alt=""
                class="w-full h-full object-cover"
                draggable={false}
                onError={handleMediaError}
              />
            </Show>
            <Show
              when={
                !mediaError() &&
                currentStory()!.attachment.mediaType.startsWith("video/")
              }
            >
              <video
                src={
                  currentStory()!.attachment.url ||
                  `/media/${currentStory()!.attachment.r2_key.replace(
                    /^uploads\//,
                    "",
                  )}`
                }
                class="w-full h-full object-cover"
                autoplay={videoReady()}
                muted={isMuted()}
                playsinline
                onEnded={handleVideoEnded}
                onTimeUpdate={handleVideoTimeUpdate}
                onLoadedMetadata={handleVideoLoadedMetadata}
                onError={handleMediaError}
              />
            </Show>

            {/* Media error fallback */}
            <Show when={mediaError()}>
              <div class="absolute inset-0 flex items-center justify-center bg-neutral-900">
                <div class="text-center text-neutral-400">
                  <ErrorIcon />
                  <p class="mt-2">{t("story.mediaLoadFailed")}</p>
                </div>
              </div>
            </Show>

            {/* Overlays rendering */}
            <Show when={currentStory()!.overlays && containerSize().width > 0}>
              <div class="absolute inset-0 pointer-events-none">
                <div class="pointer-events-auto">
                  <For each={currentStory()!.overlays}>
                    {(overlay) => (
                      <div>
                        {renderStoryOverlay(
                          t,
                          overlay,
                          containerSize(),
                          currentStory()!.ap_id,
                          currentStory()!.votes,
                          currentStory()!.votes_total,
                          currentStory()!.user_vote,
                          handleVote,
                        )}
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </div>
        </div>

        <Show when={toastMessage()}>
          <div class="absolute bottom-24 left-1/2 z-30 -translate-x-1/2 rounded-full bg-black/80 px-4 py-2 text-sm text-white shadow-lg">
            {toastMessage()}
          </div>
        </Show>

        <StoryViewerActionBar
          isLiked={isLiked()}
          placeholder={t("messages.placeholder")}
          onLike={handleLike}
          onShare={handleShare}
        />

        <StoryViewerDeleteDialog
          open={showDeleteConfirm()}
          onCancel={() => setShowDeleteConfirm(false)}
          onConfirm={confirmDelete}
        />
      </div>
    </Show>
  );
}

export default StoryViewer;
