import type { PublicAccountBindings as Bindings, TakosConfig } from "@takos/platform/server";
import { buildRuntimeConfig, loadStoredConfig } from "./config-utils";
import { assertConfigAiActionsAllowed } from "./ai-action-allowlist";

type Cached = {
  config: TakosConfig;
  source: "stored" | "runtime";
  warnings: string[];
  fetchedAt: number;
};

const CACHE_TTL_MS = 60_000;
let cached: Cached | null = null;

type ConfigReloadListener = (payload: { current: Cached; previous: Cached | null }) => void | Promise<void>;
const reloadListeners = new Set<ConfigReloadListener>();

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => deepEqual(a[key], b[key]));
  }
  return false;
};

const loadConfig = async (env: Bindings): Promise<Cached> => {
  const fetchedAt = Date.now();

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

  assertConfigAiActionsAllowed(config);

  return { config, source, warnings, fetchedAt };
};

async function runReloadHooks(current: Cached, previous: Cached | null): Promise<void> {
  if (!reloadListeners.size) return;

  const errors: string[] = [];
  for (const listener of reloadListeners) {
    try {
      await listener({ current, previous });
    } catch (error: any) {
      errors.push(error?.message || String(error));
    }
  }

  if (errors.length) {
    throw new Error(`config reload hook failed: ${errors.join("; ")}`);
  }
}

export function registerConfigReloadListener(listener: ConfigReloadListener): () => void {
  reloadListeners.add(listener);
  return () => reloadListeners.delete(listener);
}

export function clearTakosConfigCache(): void {
  cached = null;
}

export async function getTakosConfig(
  env: Bindings,
  options: { refresh?: boolean; notify?: boolean } = {},
): Promise<Cached> {
  const now = Date.now();
  const notify = options.notify !== false;
  if (!options.refresh && cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached;
  }

  const previous = cached;
  const next = await loadConfig(env);
  const changed =
    options.refresh ||
    !previous ||
    previous.source !== next.source ||
    !deepEqual(previous.config, next.config);

  if (notify && changed) {
    await runReloadHooks(next, previous);
  }

  cached = next;
  return next;
}

export async function reloadTakosConfig(env: Bindings): Promise<{
  ok: boolean;
  reloaded: boolean;
  source?: Cached["source"];
  warnings: string[];
  error?: string;
}> {
  const previous = cached;
  try {
    const next = await getTakosConfig(env, { refresh: true, notify: true });
    const reloaded =
      !previous ||
      previous.source !== next.source ||
      !deepEqual(previous.config, next.config);
    return {
      ok: true,
      reloaded,
      source: next.source,
      warnings: next.warnings,
    };
  } catch (error: any) {
    cached = previous;
    return {
      ok: false,
      reloaded: false,
      source: previous?.source,
      warnings: previous?.warnings ?? [],
      error: error?.message || String(error),
    };
  }
}
