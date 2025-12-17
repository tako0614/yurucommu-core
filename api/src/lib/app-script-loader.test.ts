import { describe, expect, it } from "vitest";
import { AppHandlerRegistry } from "@takos/platform/app";
import { loadAppRegistryFromScript } from "./app-script-loader";

const encodeInline = (code: string): string => Buffer.from(code, "utf8").toString("base64");

describe("app script loader", () => {
  it("loads inline scriptRef and builds registry", async () => {
    const script = `
      export const hello = (ctx, input) => ctx.json({ ok: true, input });
    `;
    const scriptRef = `inline:${encodeInline(script)}`;
    const loaded = await loadAppRegistryFromScript({
      scriptRef,
      env: { TAKOS_CONTEXT: "dev" },
    });
    const registry = loaded.registry;
    expect(registry).toBeInstanceOf(AppHandlerRegistry);
    expect(registry.list()).toContain("hello");
  });

  it("falls back to env.APP_MAIN_MODULE when scriptRef is missing", async () => {
    const env = {
      APP_MAIN_MODULE: {
        ping: () => ({ type: "json", status: 200, body: { ok: true } }),
      },
    };
    await expect(loadAppRegistryFromScript({ scriptRef: null, env })).rejects.toThrow(
      "App Script module is not available for manifest routing",
    );
  });

  it("rejects module: scriptRef outside dev by default", async () => {
    const env = {
      APP_MAIN_MODULE: {
        ping: () => ({ type: "json", status: 200, body: { ok: true } }),
      },
    };
    await expect(loadAppRegistryFromScript({ scriptRef: "module:APP_MAIN_MODULE", env })).rejects.toThrow(
      /Module app script refs are disabled outside dev/,
    );
  });

  it("allows module: scriptRef in dev", async () => {
    const env = {
      TAKOS_CONTEXT: "dev",
      APP_MAIN_MODULE: {
        ping: () => ({ type: "json", status: 200, body: { ok: true } }),
      },
    };
    const loaded = await loadAppRegistryFromScript({ scriptRef: "module:APP_MAIN_MODULE", env });
    expect(loaded.registry.list()).toContain("ping");
  });

  it("rejects vfs:/ws: scriptRef outside dev by default", async () => {
    const env = {
      workspaceStore: {
        getWorkspaceFile: async () => null,
      },
    };
    await expect(loadAppRegistryFromScript({ scriptRef: "vfs:ws_123:app-main.ts", env })).rejects.toThrow(
      /Workspace app script refs are disabled outside dev/,
    );
    await expect(loadAppRegistryFromScript({ scriptRef: "ws:ws_123:app-main.ts", env })).rejects.toThrow(
      /Workspace app script refs are disabled outside dev/,
    );
  });

  it("allows vfs:/ws: scriptRef in dev", async () => {
    const env = {
      TAKOS_CONTEXT: "dev",
      workspaceStore: {
        getWorkspaceFile: async (_workspaceId: string, _path: string) => ({
          content: new TextEncoder().encode("export const ping = () => ({ ok: true });"),
        }),
      },
    };
    const loaded = await loadAppRegistryFromScript({ scriptRef: "vfs:ws_123:app-main.ts", env });
    expect(loaded.registry.list()).toContain("ping");
  });
});
