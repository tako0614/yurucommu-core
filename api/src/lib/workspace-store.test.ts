import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MANIFEST_PATH,
  ensureDefaultWorkspace,
  resolveWorkspaceEnv,
} from "./workspace-store";

describe("resolveWorkspaceEnv", () => {
  it("blocks dev mode when isolation bindings are missing", () => {
    const resolution = resolveWorkspaceEnv({
      env: { TAKOS_CONTEXT: "dev" } as any,
      mode: "dev",
    });

    expect(resolution.store).toBeNull();
    expect(resolution.isolation?.required).toBe(true);
    expect(resolution.isolation?.ok).toBe(false);
    expect(resolution.isolation?.errors[0]).toContain("missing D1 binding");
  });

  it("prefers dedicated dev bindings when provided", () => {
    const devDb = { tag: "dev-db" } as any;
    const devMedia = { tag: "dev-media" } as any;
    const devKv = { tag: "dev-kv" } as any;

    const resolution = resolveWorkspaceEnv({
      env: { TAKOS_CONTEXT: "dev", DEV_DB: devDb, DEV_MEDIA: devMedia, DEV_KV: devKv } as any,
      mode: "dev",
    });

    expect(resolution.isolation?.ok).toBe(true);
    expect((resolution.env as any).DB).toBe(devDb);
    expect((resolution.env as any).MEDIA).toBe(devMedia);
    expect((resolution.env as any).KV).toBe(devKv);
  });
});

describe("ensureDefaultWorkspace", () => {
  it("seeds a demo workspace when none exist", async () => {
    let savedFile: any = null;
    let workspace: any = null;
    const store = {
      getWorkspace: vi.fn(async () => workspace),
      listWorkspaces: vi.fn(async () => []),
      upsertWorkspace: vi.fn(async (input: any) => {
        workspace = {
          id: input.id,
          base_revision_id: input.base_revision_id ?? null,
          status: input.status ?? "draft",
          author_type: input.author_type,
          author_name: input.author_name ?? null,
          created_at: input.created_at ?? "",
          updated_at: input.updated_at ?? "",
        };
        return workspace;
      }),
      updateWorkspaceStatus: vi.fn(),
      saveWorkspaceFile: vi.fn(async (id: string, path: string, content: string, contentType?: string | null) => {
        savedFile = { workspace_id: id, path, content, content_type: contentType ?? null };
        return {
          ...savedFile,
          content: new TextEncoder().encode(content),
          created_at: "",
          updated_at: "",
        };
      }),
      getWorkspaceFile: vi.fn(async () =>
        savedFile
          ? {
              ...savedFile,
              content:
                typeof savedFile.content === "string"
                  ? new TextEncoder().encode(savedFile.content)
                  : savedFile.content,
            }
          : null,
      ),
      listWorkspaceFiles: vi.fn(async () => []),
    } as any;

    const seeded = await ensureDefaultWorkspace(store);
    expect(seeded).toBe(true);
    expect(store.upsertWorkspace).toHaveBeenCalledTimes(1);
    expect(store.saveWorkspaceFile).toHaveBeenCalledWith(
      expect.any(String),
      DEFAULT_MANIFEST_PATH,
      expect.any(String),
      "application/json",
    );
  });

  it("skips seeding when defaults already exist", async () => {
    const file = {
      workspace_id: "ws_demo",
      path: DEFAULT_MANIFEST_PATH,
      content: new TextEncoder().encode("{}"),
      content_type: "application/json",
      created_at: "",
      updated_at: "",
    };
    const store = {
      getWorkspace: vi.fn(async () => ({ id: "ws_demo" })),
      listWorkspaces: vi.fn(async () => []),
      upsertWorkspace: vi.fn(),
      updateWorkspaceStatus: vi.fn(),
      saveWorkspaceFile: vi.fn(),
      getWorkspaceFile: vi.fn(async () => file),
      listWorkspaceFiles: vi.fn(async () => [file]),
    } as any;

    const seeded = await ensureDefaultWorkspace(store);
    expect(seeded).toBe(false);
    expect(store.upsertWorkspace).not.toHaveBeenCalled();
    expect(store.saveWorkspaceFile).not.toHaveBeenCalled();
  });
});
