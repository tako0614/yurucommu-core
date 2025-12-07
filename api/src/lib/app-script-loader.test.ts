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
    const loaded = await loadAppRegistryFromScript({ scriptRef: null, env });
    expect(loaded.registry.list()).toContain("ping");
  });
});
