import { beforeEach, describe, expect, it, vi } from "vitest";
import { TAKOS_CONFIG_SCHEMA_VERSION, type TakosConfig } from "@takos/platform/server";
import { persistConfigWithReloadGuard } from "./config-reload";
import { persistConfig } from "./config-utils";
import { getTakosConfig, reloadTakosConfig } from "./runtime-config";

vi.mock("./config-utils", () => ({
  persistConfig: vi.fn(),
}));

vi.mock("./runtime-config", () => ({
  reloadTakosConfig: vi.fn(),
  getTakosConfig: vi.fn(),
}));

const env: any = { DB: {} };

const makeConfig = (version: string): TakosConfig => ({
  schema_version: TAKOS_CONFIG_SCHEMA_VERSION,
  distro: { name: "takos-oss", version },
  node: { url: "https://example.com" },
});

describe("config reload guard", () => {
  beforeEach(() => {
    vi.mocked(persistConfig).mockReset();
    vi.mocked(reloadTakosConfig).mockReset();
    vi.mocked(getTakosConfig).mockReset();
    vi.mocked(persistConfig).mockResolvedValue(undefined as any);
  });

  it("persists and reloads config without rollback on success", async () => {
    const nextConfig = makeConfig("2.0.0");
    vi.mocked(reloadTakosConfig).mockResolvedValue({
      ok: true,
      reloaded: true,
      source: "stored",
      warnings: [],
    });

    const result = await persistConfigWithReloadGuard({
      env,
      nextConfig,
      previousConfig: makeConfig("1.0.0"),
    });

    expect(persistConfig).toHaveBeenCalledTimes(1);
    expect(persistConfig).toHaveBeenCalledWith(env.DB, nextConfig);
    expect(reloadTakosConfig).toHaveBeenCalledTimes(1);
    expect(getTakosConfig).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.rolledBack).toBe(false);
    expect(result.reload.ok).toBe(true);
  });

  it("rolls back to previous config and refreshes cache when reload fails", async () => {
    const previousConfig = makeConfig("1.0.0");
    const nextConfig = makeConfig("2.0.0");
    vi.mocked(reloadTakosConfig).mockResolvedValue({
      ok: false,
      reloaded: false,
      source: "stored",
      warnings: ["reload failed"],
      error: "boom",
    });

    const result = await persistConfigWithReloadGuard({
      env,
      nextConfig,
      previousConfig,
    });

    expect(persistConfig).toHaveBeenCalledTimes(2);
    expect(persistConfig).toHaveBeenNthCalledWith(1, env.DB, nextConfig);
    expect(persistConfig).toHaveBeenNthCalledWith(2, env.DB, previousConfig);
    expect(reloadTakosConfig).toHaveBeenCalledTimes(1);
    expect(getTakosConfig).toHaveBeenCalledWith(env, { refresh: true, notify: false });
    expect(result.ok).toBe(false);
    expect(result.rolledBack).toBe(true);
    expect(result.reload.error).toBe("boom");
  });
});
