import { describe, expect, it } from "vitest";
import StoryEditor from "./story-editor";

describe("StoryEditor", () => {
  it("adds and selects text elements", () => {
    const editor = new StoryEditor({ canvasSize: { width: 400, height: 800 } });
    const text = editor.addTextElement({ text: "hello", fontSize: 32, color: "#fff" });
    const snapshot = editor.getSnapshot();
    expect(snapshot.elements).toHaveLength(1);
    expect(snapshot.selectedId).toBe(text.id);
    expect(snapshot.elements[0]).toMatchObject({ text: "hello", fontSize: 32 });
  });

  it("adds images with constrained dimensions", () => {
    const editor = new StoryEditor({ canvasSize: { width: 500, height: 900 } });
    const image = editor.addImageElement({
      url: "data:image/png;base64,abc",
      width: 4000,
      height: 2000,
      maxDimension: 1000,
      makeBackgroundCandidate: true,
    });
    const snapshot = editor.getSnapshot();
    expect(snapshot.elements[0].width).toBeLessThanOrEqual(1000);
    expect(snapshot.elements[0].height).toBeLessThanOrEqual(1000);
    expect(snapshot.backgroundImageUrl).toBe(image.url);
  });

  it("serializes canvas data with duration", () => {
    const editor = new StoryEditor({
      canvasSize: { width: 200, height: 400 },
      initialBackgroundMode: "solid",
      initialBackgroundSolid: "#123456",
      initialDurationMs: 3000,
    });
    editor.addTextElement({ text: "content" });
    const payload = editor.serialize();
    expect(payload.durationMs).toBe(3000);
    expect(payload.canvas.backgroundSolid).toBe("#123456");
    expect(payload.canvas.elements).toHaveLength(1);
  });

  it("removes elements and clears selection", () => {
    const editor = new StoryEditor();
    const first = editor.addTextElement({ text: "first" });
    const second = editor.addTextElement({ text: "second" });
    editor.removeElement(second.id);
    const snapshot = editor.getSnapshot();
    expect(snapshot.elements).toHaveLength(1);
    expect(snapshot.selectedId).toBe(first.id);
    editor.removeElement(first.id);
    const after = editor.getSnapshot();
    expect(after.elements).toHaveLength(0);
    expect(after.selectedId).toBeNull();
  });
});
