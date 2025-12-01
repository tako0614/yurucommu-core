import { describe, expect, it } from "vitest";
import { buildAppRevisionDiff, renderAppRevisionDiffHtml } from "./app-revision-diff";

const manifestV1 = {
  schemaVersion: "1.0.0",
  routes: [
    { id: "route.home", method: "GET", path: "/" },
    { id: "route.about", method: "GET", path: "/about" },
  ],
  views: {
    screens: [{ id: "screen.home", title: "Home", layout: { type: "Column" } }],
    insert: [
      {
        screen: "screen.home",
        position: "header",
        order: 1,
        node: { type: "Text", props: { text: "Welcome" } },
      },
    ],
  },
  ap: { handlers: [{ id: "ap.echo", handler: "handlers.echo" }] },
  data: {
    collections: {
      posts: { engine: "sqlite", schema: { id: { type: "text", primary_key: true } } },
    },
  },
  storage: { buckets: { media: { visibility: "public" } } },
};

const manifestV2 = {
  schemaVersion: "1.0.0",
  routes: [
    { id: "route.home", method: "GET", path: "/home" },
    { id: "route.profile", method: "GET", path: "/profile" },
  ],
  views: {
    screens: [{ id: "screen.home", title: "Homepage", layout: { type: "Column", props: { gap: 8 } } }],
    insert: [
      {
        screen: "screen.home",
        position: "header",
        order: 1,
        node: { type: "Text", props: { text: "Updated" } },
      },
      {
        screen: "screen.home",
        position: "footer",
        order: 5,
        node: { type: "Button", props: { label: "Save" } },
      },
    ],
  },
  ap: { handlers: [{ id: "ap.echo", handler: "handlers.echoV2" }] },
  data: {
    collections: {
      posts: {
        engine: "sqlite",
        schema: {
          id: { type: "text", primary_key: true },
          updated_at: { type: "text" },
        },
      },
      profiles: { engine: "sqlite", schema: { handle: { type: "text" } } },
    },
  },
  storage: {
    buckets: {
      media: { visibility: "private" },
      assets: { visibility: "public" },
    },
  },
};

const revisionV1 = {
  id: "rev1",
  created_at: "2024-01-01T00:00:00Z",
  manifest_snapshot: JSON.stringify(manifestV1),
  script_snapshot_ref: "bundle-a",
  author_type: "human",
};

const revisionV2 = {
  id: "rev2",
  created_at: "2024-01-02T00:00:00Z",
  manifest_snapshot: JSON.stringify(manifestV2),
  script_snapshot_ref: "bundle-b",
  author_type: "human",
};

describe("buildAppRevisionDiff", () => {
  it("diffs manifest sections and script hash", () => {
    const result = buildAppRevisionDiff(revisionV2, revisionV1);
    expect(result.ok).toBe(true);
    const diff = result.ok ? result.diff : null;
    expect(diff).not.toBeNull();
    if (!diff) return;

    expect(diff.sections.routes.changed.some((entry) => entry.id === "route.home")).toBe(true);
    expect(diff.sections.routes.removed.some((entry) => entry.id === "route.about")).toBe(true);
    expect(diff.sections.routes.added.some((entry) => entry.id === "route.profile")).toBe(true);

    expect(diff.sections.views.screens.changed.length).toBe(1);
    expect(diff.sections.views.inserts.added.length).toBeGreaterThan(0);
    expect(diff.sections.apHandlers.changed[0]?.id).toBe("ap.echo");
    expect(diff.sections.dataCollections.added[0]?.id).toBe("profiles");
    expect(diff.sections.storageBuckets.changed.length).toBe(1);
    expect(diff.script_snapshot.changed).toBe(true);
    expect(diff.summary.totalChanges).toBeGreaterThan(0);
  });

  it("handles missing previous revision with warnings", () => {
    const result = buildAppRevisionDiff(revisionV2, null);
    expect(result.ok).toBe(true);
    const diff = result.ok ? result.diff : null;
    expect(diff?.older).toBeNull();
    expect(diff?.sections.routes.added.length).toBeGreaterThan(0);
    expect((diff?.warnings.length ?? 0) > 0).toBe(true);
  });
});

describe("renderAppRevisionDiffHtml", () => {
  it("renders a readable diff summary", () => {
    const result = buildAppRevisionDiff(revisionV2, revisionV1);
    if (!result.ok) {
      throw new Error(result.error);
    }
    const html = renderAppRevisionDiffHtml(result.diff);
    expect(html).toContain("App Revision Diff");
    expect(html).toContain("rev2");
    expect(html).toContain("Routes");
  });
});
