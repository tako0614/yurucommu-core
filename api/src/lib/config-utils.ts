/// <reference types="@cloudflare/workers-types" />

import type { PublicAccountBindings as Bindings, TakosConfig, TakosDistroReference } from "@takos/platform/server";
import {
  TAKOS_CONFIG_SCHEMA_VERSION,
  checkSemverCompatibility,
  validateTakosConfig,
} from "@takos/platform/server";
import { assertConfigAiActionsAllowed } from "./ai-action-allowlist";

const DEFAULT_DISTRO_NAME = "takos-oss";
const DEFAULT_DISTRO_VERSION = "0.1.0";
const SECRET_KEYS = new Set([
  "password",
  "secret",
  "token",
  "apikey",
  "privatekey",
  "clientsecret",
  "authpassword",
  "fcmserverkey",
  "pushwebhooksecret",
  "defaultpushservicesecret",
  "pushregistrationprivatekey",
]);

export type DistroCompatibility = {
  ok: boolean;
  warnings: string[];
  error?: string;
};

export type ConfigDiffChange = "added" | "removed" | "changed";

export type ConfigDiffEntry = {
  path: string;
  change: ConfigDiffChange;
  previous?: unknown;
  next?: unknown;
};

type StoredConfigResult = {
  config: TakosConfig | null;
  warnings: string[];
};

const boolEnv = (value: string | undefined, fallback = false): boolean => {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
};

const listEnv = (value: string | undefined): string[] => {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const jsonEnv = <T = any>(value: string | undefined): T | undefined => {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
};

const normalizeUrl = (value: string | undefined): string => {
  const trimmed = (value || "").trim();
  if (!trimmed) return "https://localhost";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
};

const normalizeRegistrationMode = (
  value: string | undefined,
): "open" | "invite-only" | "closed" | undefined => {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "open" || normalized === "invite-only" || normalized === "closed") {
    return normalized;
  }
  return undefined;
};

const normalizeKey = (key: string): string =>
  key
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

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

const collectDiffs = (
  current: unknown,
  incoming: unknown,
  path: string,
  acc: ConfigDiffEntry[],
): void => {
  if (deepEqual(current, incoming)) {
    return;
  }

  if (isPlainObject(current) && isPlainObject(incoming)) {
    const keys = Array.from(new Set([...Object.keys(current), ...Object.keys(incoming)])).sort();
    for (const key of keys) {
      const nextPath = path ? `${path}.${key}` : key;
      collectDiffs((current as any)[key], (incoming as any)[key], nextPath, acc);
    }
    return;
  }

  const change: ConfigDiffChange =
    current === undefined ? "added" : incoming === undefined ? "removed" : "changed";

  acc.push({
    path: path || "$",
    change,
    previous: current,
    next: incoming,
  });
};

export function stripSecretsFromConfig<T>(value: T, stripped: string[] = [], path = ""): T {
  if (Array.isArray(value)) {
    return value
      .map((item, index) => stripSecretsFromConfig(item, stripped, `${path}[${index}]`))
      .filter((v) => v !== undefined) as unknown as T;
  }

  if (value && typeof value === "object") {
    const result: Record<string, any> = Array.isArray(value) ? [] : {};
    for (const [key, child] of Object.entries(value as any)) {
      const normalized = normalizeKey(key);
      if (SECRET_KEYS.has(normalized)) {
        stripped.push(path ? `${path}.${key}` : key);
        continue;
      }
      const nextPath = path ? `${path}.${key}` : key;
      result[key] = stripSecretsFromConfig(child, stripped, nextPath);
    }
    return result as T;
  }

  return value;
}

export function buildRuntimeConfig(env: Bindings): TakosConfig {
  const registrationMode =
    normalizeRegistrationMode((env as any).REGISTRATION_MODE) ?? "invite-only";
  const activitypubBlocked = listEnv(
    (env as any).BLOCKED_INSTANCES || (env as any).ACTIVITYPUB_BLOCKED_INSTANCES,
  );
  const aiProviders = jsonEnv<Record<string, any>>(
    (env as any).AI_PROVIDERS_JSON || (env as any).TAKOS_AI_PROVIDERS,
  );
  const aiDataPolicy = jsonEnv<Record<string, any>>(
    (env as any).AI_DATA_POLICY_JSON || (env as any).TAKOS_AI_DATA_POLICY,
  );
  const aiRequiresExternalNetwork = boolEnv(
    (env as any).AI_REQUIRES_EXTERNAL_NETWORK ||
      (env as any).TAKOS_AI_REQUIRES_EXTERNAL_NETWORK,
    true,
  );
  const aiAgentConfigAllowlist = listEnv(
    (env as any).AI_AGENT_CONFIG_ALLOWLIST || (env as any).TAKOS_AI_AGENT_CONFIG_ALLOWLIST,
  );
  const customConfig = jsonEnv<Record<string, unknown>>(
    (env as any).TAKOS_CUSTOM_CONFIG || (env as any).CUSTOM_CONFIG_JSON,
  );

  const config: TakosConfig = {
    schema_version: TAKOS_CONFIG_SCHEMA_VERSION,
    distro: {
      name: (env as any).DISTRO_NAME || (env as any).TAKOS_DISTRO_NAME || DEFAULT_DISTRO_NAME,
      version:
        (env as any).DISTRO_VERSION ||
        (env as any).TAKOS_DISTRO_VERSION ||
        (env as any).APP_VERSION ||
        DEFAULT_DISTRO_VERSION,
    },
    node: {
      url: normalizeUrl(env.INSTANCE_DOMAIN),
      instance_name: (env as any).INSTANCE_NAME || env.INSTANCE_DOMAIN || undefined,
      default_language: (env as any).DEFAULT_LANGUAGE || undefined,
      registration: { mode: registrationMode },
    },
    ui: {
      theme: (env as any).UI_THEME || undefined,
      accent_color: (env as any).UI_ACCENT_COLOR || undefined,
      logo_url: (env as any).UI_LOGO_URL || undefined,
      allow_custom_css: boolEnv((env as any).UI_ALLOW_CUSTOM_CSS, false),
    },
    activitypub: {
      federation_enabled: boolEnv(env.ACTIVITYPUB_ENABLED, true),
      blocked_instances: activitypubBlocked.length ? activitypubBlocked : undefined,
      outbox_signing: {
        require_http_signatures: boolEnv(
          (env as any).OUTBOX_REQUIRE_HTTP_SIGNATURES,
          true,
        ),
      },
    },
    ai: {
      enabled: boolEnv((env as any).AI_ENABLED, false),
      requires_external_network: aiRequiresExternalNetwork,
      default_provider: (env as any).AI_DEFAULT_PROVIDER || undefined,
      enabled_actions: listEnv((env as any).AI_ENABLED_ACTIONS),
      providers: aiProviders,
      data_policy: aiDataPolicy,
      agent_config_allowlist: aiAgentConfigAllowlist,
    },
    custom: customConfig,
  };

  assertConfigAiActionsAllowed(config);
  return config;
}

export function checkDistroCompatibility(
  current: TakosDistroReference,
  incoming: TakosDistroReference,
  force = false,
): DistroCompatibility {
  const warnings: string[] = [];

  if (!incoming?.name || !incoming?.version) {
    return { ok: false, warnings, error: "invalid distro reference" };
  }

  if (!current?.name || !current?.version) {
    return { ok: false, warnings, error: "current distro reference missing" };
  }

  if (incoming.name !== current.name) {
    return {
      ok: false,
      warnings,
      error: `distro mismatch: expected ${current.name}, received ${incoming.name}`,
    };
  }

  const versionCheck = checkSemverCompatibility(current.version, incoming.version, {
    allowMajorMismatch: force,
    context: "distro version",
    action: "import",
  });

  if (!versionCheck.ok) {
    return { ok: false, warnings: versionCheck.warnings, error: versionCheck.error };
  }

  warnings.push(...versionCheck.warnings);

  return { ok: true, warnings };
}

export function diffConfigs(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
): ConfigDiffEntry[] {
  const diffs: ConfigDiffEntry[] = [];
  collectDiffs(current, incoming, "", diffs);
  return diffs;
}

const ensureConfigTable = async (db: D1Database) => {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS instance_config (id INTEGER PRIMARY KEY CHECK (id = 1), config_json TEXT NOT NULL, updated_at TEXT NOT NULL)",
    )
    .run();
};

export async function loadStoredConfig(db: D1Database): Promise<StoredConfigResult> {
  await ensureConfigTable(db);
  const res = await db.prepare("SELECT config_json FROM instance_config WHERE id = 1").all();
  const raw = (res.results && res.results[0]?.config_json) as string | undefined;
  if (!raw) {
    return { config: null, warnings: [] };
  }

  try {
    const parsed = JSON.parse(raw);
    const validation = validateTakosConfig(parsed);
    if (!validation.ok || !validation.config) {
      return {
        config: null,
        warnings: [
          "stored config failed validation",
          ...(validation.errors || []),
        ],
      };
    }
    try {
      assertConfigAiActionsAllowed(validation.config);
    } catch (error: any) {
      return {
        config: null,
        warnings: [
          "stored config failed AI action allowlist",
          error?.message || String(error),
        ],
      };
    }
    return { config: validation.config, warnings: [] };
  } catch (err: any) {
    return {
      config: null,
      warnings: [`failed to parse stored config: ${err?.message || err}`],
    };
  }
}

export async function persistConfig(db: D1Database, config: TakosConfig): Promise<void> {
  const validation = validateTakosConfig(config);
  if (!validation.ok || !validation.config) {
    throw new Error(`invalid config: ${validation.errors.join("; ")}`);
  }
  assertConfigAiActionsAllowed(validation.config);
  await ensureConfigTable(db);
  await db
    .prepare(
      "INSERT OR REPLACE INTO instance_config (id, config_json, updated_at) VALUES (1, ?, ?)",
    )
    .bind(JSON.stringify(validation.config), new Date().toISOString())
    .run();
}
