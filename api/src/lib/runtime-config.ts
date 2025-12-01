import type { PublicAccountBindings as Bindings, TakosConfig } from "@takos/platform/server";
import { buildRuntimeConfig, loadStoredConfig } from "./config-utils";

type Cached = {
  config: TakosConfig;
  source: "stored" | "runtime";
  warnings: string[];
  fetchedAt: number;
};

const CACHE_TTL_MS = 60_000;
let cached: Cached | null = null;

export async function getTakosConfig(
  env: Bindings,
  options: { refresh?: boolean } = {},
): Promise<Cached> {
  const now = Date.now();
  if (!options.refresh && cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached;
  }

  let stored;
  try {
    stored = await loadStoredConfig(env.DB);
  } catch (error: any) {
    stored = {
      config: null,
      warnings: [`failed to load stored config: ${error?.message || String(error)}`],
    };
  }

  const config = stored.config ?? buildRuntimeConfig(env);
  const warnings = [...(stored.warnings ?? [])];
  const source: Cached["source"] = stored.config ? "stored" : "runtime";

  cached = {
    config,
    source,
    warnings,
    fetchedAt: now,
  };

  return cached;
}
