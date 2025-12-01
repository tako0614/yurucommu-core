import { beforeEach, describe, expect, it, vi } from "vitest";
import { TAKOS_CONFIG_SCHEMA_VERSION, type TakosConfig } from "@takos/platform/server";
import {
  clearTakosConfigCache,
  getTakosConfig,
  registerConfigReloadListener,
  reloadTakosConfig,
} from "./runtime-config";
import { loadStoredConfig } from "./config-utils";

vi.mock("./config-utils", () => ({
  loadStoredConfig: vi.fn(),
  buildRuntimeConfig: vi.fn(),
}));

const makeConfig = (version: string): TakosConfig => ({
  schema_version: TAKOS_CONFIG_SCHEMA_VERSION,
  distro: { name: "takos-oss", version },
  node: { url: "https://example.com" },
});

describe("runtime config hot reload", () => {
  const env: any = { DB: {} };

  beforeEach(() => {
    clearTakosConfigCache();
    vi.mocked(loadStoredConfig).mockReset();
  });

  it("notifies reload listeners on refresh when config changes", async () => {
    const config = makeConfig("1.0.0");
    vi.mocked(loadStoredConfig).mockResolvedValue({ config, warnings: [] });
    const listener = vi.fn();
    const unsubscribe = registerConfigReloadListener(listener);

    await getTakosConfig(env, { refresh: true });
    unsubscribe();

    expect(listener).toHaveBeenCalledTimes(1);
    const payload = listener.mock.calls[0][0];
    expect(payload.previous).toBeNull();
    expect(payload.current.config).toEqual(config);
    expect(payload.current.source).toBe("stored");
  });

  it("restores previous cache when reload hooks fail", async () => {
    const currentConfig = makeConfig("1.0.0");
    const nextConfig = makeConfig("2.0.0");
    vi.mocked(loadStoredConfig).mockResolvedValue({ config: currentConfig, warnings: [] });
    await getTakosConfig(env, { refresh: true, notify: false });

    const unsubscribe = registerConfigReloadListener(() => {
      throw new Error("hook failure");
    });
    vi.mocked(loadStoredConfig).mockResolvedValue({ config: nextConfig, warnings: [] });

    const result = await reloadTakosConfig(env);
    unsubscribe();

    expect(result.ok).toBe(false);
    const cached = await getTakosConfig(env);
    expect(cached.config.distro.version).toBe("1.0.0");
    expect(cached.config).toEqual(currentConfig);
  });
});
