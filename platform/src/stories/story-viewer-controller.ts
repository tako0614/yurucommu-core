import type { Story, StoryItem } from "./story-schema";

export type StoryViewerControllerOptions = {
  stories?: Story[];
  startIndex?: number;
  viewerUserId?: string | null;
  fallbackAuthorId?: string | null;
  durationResolver?: (item?: StoryItem | null) => number;
  tickIntervalMs?: number;
  now?: () => number;
};

export type StoryViewerSnapshot = {
  stories: Story[];
  index: number;
  total: number;
  currentStory: Story | null;
  currentItem: StoryItem | null;
  progress: number;
  durationMs: number;
  isPlaying: boolean;
  isPaused: boolean;
  isDeleting: boolean;
  hasNext: boolean;
  hasPrevious: boolean;
  isOwnStory: boolean;
};

export type StoryDeletionResult =
  | { success: true; storyId: string; empty: boolean }
  | { success: false; reason: "no-story" | "busy" };

type ChangeListener = (snapshot: StoryViewerSnapshot) => void;
type VoidListener = () => void;
type StoriesListener = (stories: Story[]) => void;
type StoryIdListener = (storyId: string) => void;

const DEFAULT_DURATION_MS = 5000;
const MIN_DURATION_MS = 1500;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function defaultDurationResolver(item?: StoryItem | null) {
  if (!item) return DEFAULT_DURATION_MS;
  const raw = typeof item.durationMs === "number" ? item.durationMs : Number(item.durationMs);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.max(MIN_DURATION_MS, raw);
  }
  return DEFAULT_DURATION_MS;
}

export default class StoryViewerController {
  private stories: Story[];
  private index: number;
  private progress: number;
  private readonly listeners = new Set<ChangeListener>();
  private readonly endListeners = new Set<VoidListener>();
  private readonly storiesUpdatedListeners = new Set<StoriesListener>();
  private readonly storyDeletedListeners = new Set<StoryIdListener>();
  private readonly pauseReasons = new Set<string>();
  private playing: boolean;
  private isDeleting: boolean;
  private startTimestamp: number;
  private progressBase: number;
  private timer: ReturnType<typeof setInterval> | null;
  private readonly tickInterval: number;
  private readonly now: () => number;
  private viewerUserId: string | null;
  private fallbackAuthorId: string | null;
  private readonly durationResolver: (item?: StoryItem | null) => number;

  constructor(options: StoryViewerControllerOptions = {}) {
    this.stories = options.stories?.slice() ?? [];
    this.index = clamp(options.startIndex ?? 0, 0, Math.max(0, this.stories.length - 1));
    this.progress = 0;
    this.playing = false;
    this.isDeleting = false;
    this.startTimestamp = (options.now ?? Date.now)();
    this.progressBase = 0;
    this.timer = null;
    this.tickInterval = options.tickIntervalMs ?? 16;
    this.now = options.now ?? Date.now;
    this.viewerUserId = options.viewerUserId ?? null;
    this.fallbackAuthorId = options.fallbackAuthorId ?? null;
    this.durationResolver = options.durationResolver ?? defaultDurationResolver;
  }

  destroy() {
    this.stopTimer();
    this.listeners.clear();
    this.endListeners.clear();
    this.storiesUpdatedListeners.clear();
    this.storyDeletedListeners.clear();
    this.pauseReasons.clear();
  }

  getSnapshot(): StoryViewerSnapshot {
    return this.buildSnapshot();
  }

  subscribe(listener: ChangeListener) {
    this.listeners.add(listener);
    listener(this.buildSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  onSequenceEnd(listener: VoidListener) {
    this.endListeners.add(listener);
    return () => {
      this.endListeners.delete(listener);
    };
  }

  onStoriesUpdated(listener: StoriesListener) {
    this.storiesUpdatedListeners.add(listener);
    return () => {
      this.storiesUpdatedListeners.delete(listener);
    };
  }

  onStoryDeleted(listener: StoryIdListener) {
    this.storyDeletedListeners.add(listener);
    return () => {
      this.storyDeletedListeners.delete(listener);
    };
  }

  setStories(stories: Story[]) {
    const previousStoryId = this.currentStory()?.id ?? null;
    this.stories = stories.slice();
    if (this.stories.length === 0) {
      this.index = 0;
      this.progress = 0;
      this.progressBase = 0;
      this.stopTimer();
      this.playing = false;
      this.emit();
      this.emitStoriesUpdated();
      this.emitSequenceEnd();
      return;
    }

    this.index = clamp(this.index, 0, this.stories.length - 1);
    const currentId = this.currentStory()?.id ?? null;
    if (previousStoryId !== currentId) {
      this.progress = 0;
      this.progressBase = 0;
      if (this.playing) {
        this.startTimestamp = this.now();
      }
    }
    this.emit();
  }

  setViewerUserId(userId: string | null | undefined) {
    this.viewerUserId = userId ?? null;
    this.emit();
  }

  setFallbackAuthorId(authorId: string | null | undefined) {
    this.fallbackAuthorId = authorId ?? null;
    this.emit();
  }

  pause(reason = "external") {
    this.pauseReasons.add(reason);
    if (this.playing) {
      this.captureProgress();
      this.playing = false;
      this.stopTimer();
    }
    this.emit();
  }

  resume(reason = "external") {
    this.pauseReasons.delete(reason);
    if (this.pauseReasons.size === 0 && !this.isDeleting && this.stories.length > 0) {
      if (!this.playing) {
        this.playing = true;
        this.progressBase = this.progress;
        this.startTimestamp = this.now();
        this.ensureTimer();
      }
    }
    this.emit();
  }

  setPaused(paused: boolean, reason = "external") {
    if (paused) {
      this.pause(reason);
    } else {
      this.resume(reason);
    }
  }

  resetProgress() {
    this.progress = 0;
    this.progressBase = 0;
    if (this.playing) {
      this.startTimestamp = this.now();
    }
    this.emit();
  }

  setIndex(index: number, options?: { resetProgress?: boolean }) {
    if (this.stories.length === 0) {
      this.index = 0;
      this.progress = 0;
      this.progressBase = 0;
      this.emit();
      return;
    }
    const clampedIndex = clamp(index, 0, this.stories.length - 1);
    const shouldReset = options?.resetProgress ?? true;
    if (clampedIndex === this.index && !shouldReset) {
      return;
    }
    this.index = clampedIndex;
    if (shouldReset) {
      this.progress = 0;
      this.progressBase = 0;
      if (this.playing) {
        this.startTimestamp = this.now();
      }
    }
    this.emit();
  }

  previous() {
    if (this.stories.length === 0) return;
    if (this.index <= 0) {
      this.progress = 0;
      this.progressBase = 0;
      if (this.playing) {
        this.startTimestamp = this.now();
      }
      this.emit();
      return;
    }
    this.index -= 1;
    this.progress = 0;
    this.progressBase = 0;
    if (this.playing) {
      this.startTimestamp = this.now();
    }
    this.emit();
  }

  next() {
    if (this.stories.length === 0) return;
    if (this.index >= this.stories.length - 1) {
      this.progress = 1;
      this.progressBase = 1;
      this.stopTimer();
      this.playing = false;
      this.emit();
      this.emitSequenceEnd();
      return;
    }
    this.index += 1;
    this.progress = 0;
    this.progressBase = 0;
    if (this.playing) {
      this.startTimestamp = this.now();
    }
    this.emit();
  }

  async deleteCurrent(executor: (story: Story) => Promise<unknown>): Promise<StoryDeletionResult> {
    const story = this.currentStory();
    if (!story) {
      return { success: false, reason: "no-story" };
    }
    if (this.isDeleting) {
      return { success: false, reason: "busy" };
    }

    this.isDeleting = true;
    this.pause("internal:deleting");
    this.emit();

    let removedId: string | null = null;
    let emptyAfter = false;
    try {
      await executor(story);
      removedId = story.id;
      this.stories = this.stories.filter((entry) => entry.id !== removedId);
      if (this.stories.length === 0) {
        this.index = 0;
        this.progress = 0;
        this.progressBase = 0;
        this.stopTimer();
        this.playing = false;
        emptyAfter = true;
      } else {
        this.index = clamp(this.index, 0, this.stories.length - 1);
        this.progress = 0;
        this.progressBase = 0;
        if (this.playing) {
          this.startTimestamp = this.now();
        }
      }
      this.emit();
    } catch (error) {
      throw error;
    } finally {
      this.isDeleting = false;
      this.resume("internal:deleting");
    }

    if (!removedId) {
      return { success: false, reason: "no-story" };
    }

    const nextStories = this.stories.slice();
    this.emitStoriesUpdated(nextStories);
    for (const listener of this.storyDeletedListeners) {
      listener(removedId);
    }
    if (emptyAfter) {
      this.emitSequenceEnd();
    }

    return { success: true, storyId: removedId, empty: emptyAfter };
  }

  private ensureTimer() {
    if (this.timer) return;
    this.timer = setInterval(() => this.step(), this.tickInterval);
  }

  private stopTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private captureProgress() {
    if (!this.playing) return;
    const duration = this.currentDuration();
    if (duration <= 0) return;
    const elapsed = this.now() - this.startTimestamp;
    const nextProgress = clamp(this.progressBase + elapsed / duration, 0, 1);
    if (nextProgress !== this.progress) {
      this.progress = nextProgress;
    }
    this.progressBase = this.progress;
  }

  private step() {
    if (!this.playing || this.isDeleting) {
      return;
    }
    const duration = this.currentDuration();
    if (duration <= 0) {
      this.completeCurrent();
      return;
    }
    const elapsed = this.now() - this.startTimestamp;
    const nextProgress = clamp(this.progressBase + elapsed / duration, 0, 1);
    if (nextProgress !== this.progress) {
      this.progress = nextProgress;
      this.emit();
    }
    if (nextProgress >= 1) {
      this.completeCurrent();
    }
  }

  private completeCurrent() {
    if (this.index < this.stories.length - 1) {
      this.index += 1;
      this.progress = 0;
      this.progressBase = 0;
      this.startTimestamp = this.now();
      this.emit();
      return;
    }
    this.progress = 1;
    this.progressBase = 1;
    this.stopTimer();
    this.playing = false;
    this.emit();
    this.emitSequenceEnd();
  }

  private currentStory() {
    return this.stories[this.index] ?? null;
  }

  private currentItem() {
    const story = this.currentStory();
    if (!story) return null;
    return story.items?.[0] ?? null;
  }

  private currentDuration() {
    return this.durationResolver(this.currentItem());
  }

  private emit() {
    const snapshot = this.buildSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private emitStoriesUpdated(stories?: Story[]) {
    const payload = stories ? stories.slice() : this.stories.slice();
    for (const listener of this.storiesUpdatedListeners) {
      listener(payload);
    }
  }

  private emitSequenceEnd() {
    for (const listener of this.endListeners) {
      listener();
    }
  }

  private buildSnapshot(): StoryViewerSnapshot {
    const currentStory = this.currentStory();
    const currentItem = this.currentItem();
    const durationMs = this.currentDuration();
    const authorId = currentStory?.author_id ?? this.fallbackAuthorId ?? null;
    const isOwnStory = Boolean(
      authorId && this.viewerUserId && authorId === this.viewerUserId,
    );
    return {
      stories: this.stories.slice(),
      index: this.stories.length ? this.index : 0,
      total: this.stories.length,
      currentStory,
      currentItem,
      progress: this.progress,
      durationMs,
      isPlaying: this.playing,
      isPaused: !this.playing,
      isDeleting: this.isDeleting,
      hasNext: this.index < this.stories.length - 1,
      hasPrevious: this.index > 0,
      isOwnStory,
    };
  }
}
