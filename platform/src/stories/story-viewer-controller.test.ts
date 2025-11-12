import { afterEach, describe, expect, it, vi } from "vitest";

import StoryViewerController from "./story-viewer-controller";
import type { Story } from "./story-schema";

function makeStory(id: string, durationMs = 2000, authorId = "author"): Story {
  return {
    id,
    community_id: null,
    author_id: authorId,
    created_at: new Date(0).toISOString(),
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    items: [
      {
        id: `${id}-item`,
        type: "image",
        url: `https://example.com/${id}.jpg`,
        durationMs,
      },
    ],
    broadcast_all: false,
    visible_to_friends: true,
    attributed_community_id: null,
  };
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("StoryViewerController", () => {
  it("advances through stories and signals when the sequence ends", () => {
    vi.useFakeTimers();
    const controller = new StoryViewerController({
      stories: [makeStory("one", 1500), makeStory("two", 1800)],
    });
    let ended = 0;
    controller.onSequenceEnd(() => {
      ended += 1;
    });

    controller.resume();

    vi.advanceTimersByTime(1600);
    const afterFirst = controller.getSnapshot();
    expect(afterFirst.index).toBe(1);
    expect(afterFirst.progress).toBeGreaterThanOrEqual(0);
    expect(afterFirst.progress).toBeLessThan(1);

    vi.advanceTimersByTime(2000);
    const final = controller.getSnapshot();
    expect(final.index).toBe(1);
    expect(final.progress).toBe(1);
    expect(ended).toBeGreaterThanOrEqual(1);

    controller.destroy();
  });

  it("pauses and resumes playback via reasons", () => {
    vi.useFakeTimers();
    const controller = new StoryViewerController({ stories: [makeStory("only", 4000)] });
    controller.resume();
    vi.advanceTimersByTime(500);
    const progressAfterStart = controller.getSnapshot().progress;

    controller.pause("menu");
    vi.advanceTimersByTime(1000);
    expect(controller.getSnapshot().progress).toBeCloseTo(progressAfterStart, 3);

    controller.resume("menu");
    vi.advanceTimersByTime(600);
    expect(controller.getSnapshot().progress).toBeGreaterThan(progressAfterStart);

    controller.destroy();
  });

  it("removes the current story and notifies listeners", async () => {
    vi.useFakeTimers();
    const controller = new StoryViewerController({
      stories: [makeStory("first"), makeStory("second")],
      viewerUserId: "author",
    });
    const updates: string[][] = [];
    const deletedIds: string[] = [];
    controller.onStoriesUpdated((stories) => {
      updates.push(stories.map((story) => story.id));
    });
    controller.onStoryDeleted((storyId) => {
      deletedIds.push(storyId);
    });

    const result = await controller.deleteCurrent(async (story) => {
      expect(story.id).toBe("first");
    });

    expect(result).toEqual({ success: true, storyId: "first", empty: false });
    expect(updates.at(-1)).toEqual(["second"]);
    expect(deletedIds).toEqual(["first"]);
    expect(controller.getSnapshot().currentStory?.id).toBe("second");

    controller.destroy();
  });

  it("signals completion when the final story is deleted", async () => {
    vi.useFakeTimers();
    const controller = new StoryViewerController({ stories: [makeStory("solo")] });
    let ended = 0;
    controller.onSequenceEnd(() => {
      ended += 1;
    });

    const result = await controller.deleteCurrent(async (story) => {
      expect(story.id).toBe("solo");
    });

    expect(result).toEqual({ success: true, storyId: "solo", empty: true });
    expect(ended).toBeGreaterThanOrEqual(1);
    expect(controller.getSnapshot().total).toBe(0);

    controller.destroy();
  });
});
