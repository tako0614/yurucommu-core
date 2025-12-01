import { describe, expect, it } from "vitest";
import { diffAppRevisionManifests } from "./revision-diff";

const baseManifest = {
  schemaVersion: "1.0",
  version: "1.0.0",
  routes: [
    { id: "home", method: "GET", path: "/", handler: "homeTimeline" },
    { id: "me", method: "GET", path: "/me", handler: "getMe", auth: true },
  ],
  views: {
    screens: [{ id: "screen.home", route: "/", title: "Home", layout: { type: "Text" } }],
    insert: [],
  },
  ap: {
    handlers: [{ id: "ap_question_to_poll", handler: "mapQuestionToPoll" }],
  },
  data: {
    collections: {
      "app:notes": { engine: "sqlite", schema: { id: "text" } },
    },
  },
  storage: {
    buckets: {
      "app:attachments": { engine: "r2" },
    },
  },
};

const nextManifest = {
  ...baseManifest,
  version: "1.1.0",
  routes: [
    { id: "home", method: "GET", path: "/", handler: "homeTimeline" },
    { id: "me", method: "GET", path: "/users/me", handler: "getMe", auth: true },
    { id: "posts", method: "POST", path: "/posts", handler: "createPost", auth: true },
  ],
  views: {
    screens: [
      { id: "screen.home", route: "/", title: "Home", layout: { type: "Text" } },
      { id: "screen.feed", route: "/feed", title: "Feed", layout: { type: "List" } },
    ],
    insert: [],
  },
  ap: {
    handlers: [
      { id: "ap_question_to_poll", handler: "mapQuestionToPoll" },
      { id: "ap_note", handler: "mapNote" },
    ],
  },
  data: {
    collections: {
      "app:notes": { engine: "sqlite", schema: { id: "text", body: "text" } },
      "app:tasks": { engine: "sqlite", schema: { id: "text" } },
    },
  },
  storage: {
    buckets: {
      "app:attachments": { engine: "r2" },
      "app:exports": { engine: "r2" },
    },
  },
};

describe("diffAppRevisionManifests", () => {
  it("detects added, removed, and changed manifest entries", () => {
    const diff = diffAppRevisionManifests(
      { id: "rev1", manifestSnapshot: baseManifest, scriptSnapshotRef: "sha256:a" },
      { id: "rev2", manifestSnapshot: nextManifest, scriptSnapshotRef: "sha256:b" },
    );

    expect(diff.scriptChanged).toBe(true);
    expect(diff.manifestVersionChanged).toBe(true);
    expect(diff.routes.added).toContain("posts");
    expect(diff.routes.removed).toEqual([]);
    expect(diff.routes.changed).toContain("me");
    expect(diff.routes.unchanged).toContain("home");

    expect(diff.screens.added).toContain("screen.feed");
    expect(diff.screens.unchanged).toContain("screen.home");

    expect(diff.apHandlers.added).toContain("ap_note");
    expect(diff.apHandlers.unchanged).toContain("ap_question_to_poll");

    expect(diff.collections.added).toContain("app:tasks");
    expect(diff.collections.changed).toContain("app:notes");
    expect(diff.collections.removed).toEqual([]);

    expect(diff.buckets.added).toContain("app:exports");
    expect(diff.buckets.unchanged).toContain("app:attachments");
    expect(diff.issues).toEqual([]);
  });

  it("reports parse issues when manifest snapshots are invalid", () => {
    const diff = diffAppRevisionManifests(
      { id: "rev1", manifestSnapshot: "{not-json", scriptSnapshotRef: "sha256:a" },
      { id: "rev2", manifestSnapshot: null, scriptSnapshotRef: "sha256:a" },
    );
    expect(diff.issues.length).toBeGreaterThan(0);
    expect(diff.routes).toMatchObject({
      added: [],
      removed: [],
      changed: [],
      unchanged: [],
    });
  });
});
