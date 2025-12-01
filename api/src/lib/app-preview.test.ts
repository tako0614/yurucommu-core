import { describe, expect, it } from "vitest";
import type { AppWorkspaceManifest, UiNode } from "./app-preview";
import { AppPreviewError, resolveScreenPreview } from "./app-preview";

const makeNode = (props: Record<string, any>, children?: UiNode[]): UiNode => ({
  type: "Box",
  props,
  children,
});

describe("resolveScreenPreview", () => {
  it("applies inserts into matching slots", () => {
    const manifest: AppWorkspaceManifest = {
      views: {
        screens: [
          {
            id: "screen.home",
            layout: makeNode(
              { id: "root" },
              [makeNode({ slot: "sidebar", id: "sidebar-slot" }, [])],
            ),
          },
        ],
        insert: [
          {
            screen: "screen.home",
            position: "sidebar",
            order: 1,
            node: { type: "Card", props: { title: "Inserted" } },
          },
        ],
      },
    };

    const preview = resolveScreenPreview(manifest, "screen.home");
    const sidebar = (preview.resolvedTree.children || [])[0];
    expect(sidebar.children?.length).toBe(1);
    expect(sidebar.children?.[0].type).toBe("Card");
    expect(preview.warnings.length).toBe(0);
  });

  it("returns warnings when no matching position is found", () => {
    const manifest: AppWorkspaceManifest = {
      views: {
        screens: [
          {
            id: "screen.home",
            layout: makeNode({ id: "root" }, [makeNode({ id: "main" }, [])]),
          },
        ],
        insert: [
          {
            screen: "screen.home",
            position: "missing",
            node: { type: "Banner", props: { text: "Hello" } },
          },
        ],
      },
    };

    const preview = resolveScreenPreview(manifest, "screen.home");
    expect(preview.warnings.length).toBe(1);
    const main = preview.resolvedTree.children?.[0];
    expect(main?.children?.length ?? 0).toBe(0);
  });

  it("throws when the screen does not exist", () => {
    const manifest: AppWorkspaceManifest = {
      views: { screens: [], insert: [] },
    };
    expect(() => resolveScreenPreview(manifest, "missing")).toThrow(AppPreviewError);
  });
});
