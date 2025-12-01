import { describe, expect, it } from "vitest";
import appPreview from "./app-preview";

const request = (
  path: string,
  body: Record<string, any>,
  env?: Record<string, any>,
  headers?: Record<string, string>,
) =>
  appPreview.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(headers ?? {}) },
    body: JSON.stringify(body),
  }, env);

const containsText = (node: any, text: string): boolean => {
  if (!node || typeof node !== "object") return false;
  if (node?.props?.text === text) return true;
  if (Array.isArray(node.children)) {
    return node.children.some((child) => containsText(child, text));
  }
  return false;
};

describe("/admin/app/preview/screen", () => {
  it("returns a resolved tree for the demo workspace", async () => {
    const res = await request("/admin/app/preview/screen", {
      workspaceId: "demo",
      screenId: "screen.home",
      viewMode: "json",
    });

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(json.resolvedTree?.type).toBeDefined();
    expect(Array.isArray(json.warnings)).toBe(true);
  });

  it("rejects unsupported image preview requests", async () => {
    const res = await request("/admin/app/preview/screen", {
      workspaceId: "demo",
      screenId: "screen.home",
      viewMode: "image",
    });

    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.error).toBe("view_mode_not_supported");
  });

  it("requires the preview token when configured", async () => {
    const res = await request(
      "/admin/app/preview/screen",
      {
        workspaceId: "demo",
        screenId: "screen.home",
        viewMode: "json",
      },
      { APP_PREVIEW_TOKEN: "secret-token" },
    );

    expect(res.status).toBe(401);
    const json: any = await res.json();
    expect(json.ok).toBe(false);
  });
});

describe("/admin/app/preview/screen-with-patch", () => {
  it("applies patches before resolving preview without persisting", async () => {
    const res = await request("/admin/app/preview/screen-with-patch", {
      workspaceId: "demo",
      screenId: "screen.home",
      viewMode: "json",
      patches: [
        {
          op: "add",
          path: "/views/insert/-",
          value: {
            screen: "screen.home",
            position: "main",
            order: 99,
            node: {
              type: "Text",
              props: { text: "Patched from test" },
            },
          },
        },
      ],
    });

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(json.patchesApplied).toBe(1);
    expect(containsText(json.resolvedTree, "Patched from test")).toBe(true);

    const base = await request("/admin/app/preview/screen", {
      workspaceId: "demo",
      screenId: "screen.home",
      viewMode: "json",
    });
    const baseJson: any = await base.json();
    expect(containsText(baseJson.resolvedTree, "Patched from test")).toBe(false);
  });

  it("rejects invalid patch payloads", async () => {
    const res = await request("/admin/app/preview/screen-with-patch", {
      workspaceId: "demo",
      screenId: "screen.home",
      viewMode: "json",
      patches: [{ op: "replace", path: "/views/screens/0/layout" }],
    });

    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.ok).toBe(false);
  });

  it("requires the preview token when configured", async () => {
    const unauthorized = await request(
      "/admin/app/preview/screen-with-patch",
      {
        workspaceId: "demo",
        screenId: "screen.home",
        viewMode: "json",
        patches: [],
      },
      { APP_PREVIEW_TOKEN: "secret-token" },
    );

    expect(unauthorized.status).toBe(401);

    const authorized = await request(
      "/admin/app/preview/screen-with-patch",
      {
        workspaceId: "demo",
        screenId: "screen.home",
        viewMode: "json",
        patches: [],
      },
      { APP_PREVIEW_TOKEN: "secret-token" },
      { "x-app-preview-token": "secret-token" },
    );

    expect(authorized.status).toBe(200);
  });
});
