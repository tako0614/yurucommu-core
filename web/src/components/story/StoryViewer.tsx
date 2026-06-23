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
  sendUserDMMessage,
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

// How long a video may sit un-ready (never reaching loadedmetadata) before the
// watchdog advances past it, so a stalled/broken video can't freeze the viewer.
const VIDEO_STALL_TIMEOUT_MS = 8000;
export function StoryViewer(props: StoryViewerProps) {
  const { t, language } = useI18n();
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
  // Bumped on every video progress event (canplay/timeupdate). The stall
  // watchdog depends on it so genuine-but-slow playback resets the timer
  // instead of being cut off.
  const [videoActivityTick, setVideoActivityTick] = createSignal(0);
  const [mediaError, setMediaError] = createSignal(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = createSignal(false);
  const [isMuted, setIsMuted] = createSignal(true);
  const [toastMessage, setToastMessage] = createSignal<string | null>(null);
  let containerRef!: HTMLDivElement;
  let storyContainerRef!: HTMLDivElement;
  let videoRef: HTMLVideoElement | undefined;
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

  // Lock background scroll while the full-screen viewer is mounted, restoring
  // the prior value on close (matches the MediaLightbox / useDialog behaviour).
  createEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    onCleanup(() => {
      document.body.style.overflow = previous;
    });
  });

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

  // Mark story as viewed when displaying. Track the ap_ids we've already POSTed
  // a view for in a Set: a like / vote / share replaces the current story object
  // (new identity, `viewed` still false locally), which re-emits currentStory()
  // and would otherwise re-fire the view write for an already-viewed story. The
  // server is idempotent, but this avoids the wasted request; a failed write is
  // un-recorded so the next emit can retry.
  const viewedMarked = new Set<string>();
  createEffect(() => {
    const story = currentStory();
    if (story && !story.viewed && !viewedMarked.has(story.ap_id)) {
      viewedMarked.add(story.ap_id);
      markStoryViewed(story.ap_id).catch((e) => {
        viewedMarked.delete(story.ap_id);
        console.error(e);
      });
    }
  });

  // Reset media states when story changes
  createEffect(() => {
    // Track both indices
    actorIndex();
    storyIndex();
    setMediaError(false);
    setVideoActivityTick(0);
    setShowDeleteConfirm(false);
  });

  // Check if current story is a video
  const isVideo = createMemo(
    () => currentStory()?.attachment?.mediaType?.startsWith("video/") ?? false,
  );

  // Keep ref in sync with state for use in interval callback, and drive the
  // current video's playback from the pause state (hold-to-pause). Without this
  // a held video would keep playing and progress would keep advancing.
  createEffect(() => {
    const paused = isPaused();
    isPausedRef = paused;
    if (isVideo() && videoRef) {
      if (paused) {
        videoRef.pause();
      } else {
        videoRef.play().catch(() => setMediaError(true));
      }
    }
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

  // Auto-advance timer (for images only, videos use onEnded). Elapsed is
  // accumulated tick-by-tick and ONLY while not paused, so a hold-to-pause does
  // not lose progress and auto-advance is itself pause-aware. (Previously a fixed
  // setTimeout(duration) fired even while held, and the effect tracked isPaused
  // so every pause/release rebuilt the timer with a fresh startTime → progress
  // jumped back to 0.)
  const TICK_MS = 50;
  const startTimer = () => {
    const story = currentStory();
    if (!story || isVideo()) return;

    const duration = parseStoryDuration(story.displayDuration);

    if (timerRef) clearTimeout(timerRef);
    if (progressTimerRef) clearInterval(progressTimerRef);

    let elapsed = 0;
    progressTimerRef = setInterval(() => {
      if (isPausedRef) return;
      elapsed += TICK_MS;
      setProgress(Math.min((elapsed / duration) * 100, 100));
      if (elapsed >= duration) {
        if (progressTimerRef) clearInterval(progressTimerRef);
        goNext();
      }
    }, TICK_MS);
  };

  createEffect(() => {
    // Re-arm only when the STORY changes — NOT on pause toggle (the interval's
    // isPausedRef guard handles pausing without restarting progress).
    actorIndex();
    storyIndex();

    if (!isVideo()) {
      setProgress(0);
      startTimer();
    }

    onCleanup(() => {
      if (timerRef) clearTimeout(timerRef);
      if (progressTimerRef) clearInterval(progressTimerRef);
    });
  });

  // Video stall watchdog: a broken or stalled video never fires `onEnded`
  // (auto-advance relies on it) and the image timer bails on `isVideo()`, so
  // without this a frozen video would trap the viewer forever. If the media
  // errors, advance promptly; otherwise the timer is (re)armed on every
  // progress event (canplay/timeupdate via `videoActivityTick`), so a slow but
  // genuinely-progressing video keeps resetting it and is never cut off. This
  // also covers the "metadata ready but still paused / never progressing" case:
  // if no progress arrives within the timeout, advance.
  createEffect(() => {
    // Re-run when the story, error state, or video progress changes.
    actorIndex();
    storyIndex();
    const video = isVideo();
    const errored = mediaError();
    // Track progress so each event re-arms the timer below.
    videoActivityTick();

    if (!video) return;

    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    if (errored) {
      // Show the error fallback briefly, then move on.
      stallTimer = setTimeout(goNext, 1500);
    } else if (!isPaused()) {
      // Only arm the watchdog while we expect playback to progress; a
      // user-held pause must not trip it.
      stallTimer = setTimeout(goNext, VIDEO_STALL_TIMEOUT_MS);
    }

    onCleanup(() => {
      if (stallTimer) clearTimeout(stallTimer);
    });
  });

  const handleVote = async (storyApId: string, optionIndex: number) => {
    try {
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
    } catch (err) {
      console.error("Failed to vote on story:", err);
      setToastMessage(t("common.error"));
    }
  };

  // Guard against a double-tap firing two like/unlike requests off the same
  // stale `story.liked` baseline (the server is idempotent, but two requests
  // race a transient flicker).
  let likeInFlight = false;
  const handleLike = async () => {
    const story = currentStory();
    if (!story || likeInFlight) return;
    likeInFlight = true;
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
    } finally {
      likeInFlight = false;
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
      } else {
        // No Web Share and no Clipboard API: surface a message rather than
        // leaving the Share button a silent dead no-op.
        setToastMessage(t("story.shareUnavailable"));
      }
    } catch (err) {
      // A user dismissing the native share sheet rejects with AbortError —
      // that's a cancel, not a failure, so don't show an error toast for it.
      if (err instanceof Error && err.name === "AbortError") return;
      console.error("Failed to share story:", err);
      setToastMessage(t("story.shareFailed"));
    }
  };

  // Send a reply to the story author as a direct message (Note). Returns true
  // on success so the action bar can clear its input.
  const handleReply = async (text: string): Promise<boolean> => {
    const authorApId = currentActorStories()?.actor.ap_id;
    if (!authorApId) return false;
    try {
      await sendUserDMMessage(authorApId, text);
      setToastMessage(t("story.replySent"));
      return true;
    } catch (err) {
      console.error("Failed to send story reply:", err);
      setToastMessage(t("story.replyFailed"));
      return false;
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
    // Real playback progress: reset the stall watchdog.
    setVideoActivityTick((n) => n + 1);
  };

  // Handle video loaded metadata: the element has no `autoplay`, so kick off
  // playback explicitly (subject to the browser's autoplay policy — muted
  // playback is allowed). Failure surfaces the media-error fallback.
  const handleVideoLoadedMetadata = () => {
    setProgress(0);
    setVideoActivityTick((n) => n + 1);
    if (videoRef && !isPaused()) {
      videoRef.play().catch(() => setMediaError(true));
    }
  };

  // `canplay` also indicates the pipeline is alive; reset the watchdog and
  // ensure playback is running if it hasn't started yet.
  const handleVideoCanPlay = () => {
    setVideoActivityTick((n) => n + 1);
    if (videoRef && !isPaused() && videoRef.paused) {
      videoRef.play().catch(() => setMediaError(true));
    }
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
      // Prune the deleted story from local state — otherwise it lingers in the
      // array: the progress-bar count is wrong, goPrev returns into the gone
      // story (404 on view/like), and emptying an actor's group can collapse the
      // viewer to a blank screen.
      const ai = actorIndex();
      const si = storyIndex();
      const groupSurvives = localActorStories()[ai].stories.length > 1;
      const groups = localActorStories()
        .map((g, i) =>
          i === ai
            ? { ...g, stories: g.stories.filter((_, j) => j !== si) }
            : g,
        )
        .filter((g) => g.stories.length > 0);

      if (groups.length === 0) {
        props.onClose();
        return;
      }
      setLocalActorStories(groups);
      if (groupSurvives) {
        // Same actor: the next story slid into this index (clamp to new last).
        setStoryIndex(Math.min(si, groups[ai].stories.length - 1));
      } else {
        // The actor's group was removed; move to the next available actor.
        setActorIndex(Math.min(ai, groups.length - 1));
        setStoryIndex(0);
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
      // While the delete-confirmation prompt is open it owns the keyboard:
      // Escape cancels the prompt (not the whole viewer) and navigation keys
      // must not advance stories behind the modal.
      if (showDeleteConfirm()) {
        if (e.key === "Escape") {
          e.preventDefault();
          setShowDeleteConfirm(false);
        }
        return;
      }
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
      <div
        class="fixed inset-0 z-51 bg-neutral-900"
        role="dialog"
        aria-modal="true"
        aria-label={t("story.viewerAriaLabel")}
      >
        <StoryViewerProgress
          totalStories={currentActorStories()!.stories.length}
          storyIndex={storyIndex()}
          progress={progress()}
        />

        <StoryViewerHeader
          actor={currentActorStories()!.actor}
          timeLabel={formatRelativeTime(currentStory()!.published, {
            maxDays: 1,
            locale: language(),
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
                ref={videoRef}
                src={
                  currentStory()!.attachment.url ||
                  `/media/${currentStory()!.attachment.r2_key.replace(
                    /^uploads\//,
                    "",
                  )}`
                }
                class="w-full h-full object-cover"
                muted={isMuted()}
                playsinline
                onEnded={handleVideoEnded}
                onTimeUpdate={handleVideoTimeUpdate}
                onLoadedMetadata={handleVideoLoadedMetadata}
                onCanPlay={handleVideoCanPlay}
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

            {/* Caption (user-authored text shown over the story) */}
            <Show when={currentStory()!.caption}>
              <div class="absolute bottom-4 left-0 right-0 px-4 pointer-events-none">
                <p class="text-white text-sm leading-snug whitespace-pre-wrap drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]">
                  {currentStory()!.caption}
                </p>
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
                          isOwnStory(),
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
          <div
            role="status"
            aria-live="polite"
            class="absolute bottom-24 left-1/2 z-30 -translate-x-1/2 rounded-full bg-black/80 px-4 py-2 text-sm text-white shadow-lg"
          >
            {toastMessage()}
          </div>
        </Show>

        <StoryViewerActionBar
          isLiked={isLiked()}
          placeholder={t("story.replyPlaceholder")}
          sendLabel={t("dm.send")}
          onReply={isOwnStory() ? undefined : handleReply}
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
