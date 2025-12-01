import { getExecutionContext, parseBooleanFlag } from "./context";
import type { ExecutionContext } from "./context";

export type DevDataIsolationOptions = {
  required?: boolean;
  d1BindingName?: string;
  r2BindingName?: string;
  kvBindingName?: string;
};

export type DevDataIsolationBindings = {
  d1: string;
  r2: string;
  kv: string;
};

export type DevDataIsolationResult = {
  context: ExecutionContext;
  required: boolean;
  ok: boolean;
  errors: string[];
  warnings: string[];
  bindings: DevDataIsolationBindings;
  resolved: {
    db?: unknown;
    media?: unknown;
    kv?: unknown;
  };
};

const DEFAULT_D1_BINDING = "DEV_DB";
const DEFAULT_R2_BINDING = "DEV_MEDIA";
const DEFAULT_KV_BINDING = "DEV_KV";

function pickBindingNames(env: any, options: DevDataIsolationOptions): DevDataIsolationBindings {
  return {
    d1:
      options.d1BindingName ||
      env?.DEV_D1_BINDING ||
      env?.DEV_DB_BINDING ||
      DEFAULT_D1_BINDING,
    r2:
      options.r2BindingName ||
      env?.DEV_R2_BINDING ||
      env?.DEV_MEDIA_BINDING ||
      DEFAULT_R2_BINDING,
    kv: options.kvBindingName || env?.DEV_KV_BINDING || DEFAULT_KV_BINDING,
  };
}

function resolveBooleanFlag(env: any, fallback: boolean): boolean {
  const candidates = [
    env?.TAKOS_REQUIRE_DEV_DATA_ISOLATION,
    env?.REQUIRE_DEV_DATA_ISOLATION,
    env?.DEV_DATA_ISOLATION_REQUIRED,
  ];
  for (const value of candidates) {
    const parsed = parseBooleanFlag(value, fallback);
    if (typeof value !== "undefined") {
      return parsed;
    }
  }
  return fallback;
}

export function resolveDevDataIsolation(
  env: any,
  options: DevDataIsolationOptions = {},
): DevDataIsolationResult {
  const context = getExecutionContext(env);
  const requireIsolation = resolveBooleanFlag(env, options.required ?? false);
  const required = context === "dev" && requireIsolation;
  const bindings = pickBindingNames(env, options);

  const resolved = {
    db: bindings.d1 ? env?.[bindings.d1] : undefined,
    media: bindings.r2 ? env?.[bindings.r2] : undefined,
    kv: bindings.kv ? env?.[bindings.kv] : undefined,
  };

  const errors: string[] = [];
  const warnings: string[] = [];

  if (required) {
    if (!resolved.db) {
      errors.push(
        `dev data isolation enabled: missing D1 binding "${bindings.d1}". Set DEV_D1_BINDING or bind a dedicated dev database.`,
      );
    }
    if (!resolved.media) {
      errors.push(
        `dev data isolation enabled: missing R2 binding "${bindings.r2}". Set DEV_R2_BINDING or bind a dedicated dev bucket.`,
      );
    }
    if (!resolved.kv) {
      errors.push(
        `dev data isolation enabled: missing KV binding "${bindings.kv}". Set DEV_KV_BINDING or bind a dedicated dev KV namespace.`,
      );
    }

    if (bindings.d1 === "DB") {
      warnings.push('DEV_D1_BINDING resolved to "DB"; ensure this database is not shared with prod');
    }
    if (bindings.r2 === "MEDIA") {
      warnings.push(
        'DEV_R2_BINDING resolved to "MEDIA"; ensure this bucket is not shared with prod storage',
      );
    }
    if (bindings.kv === "KV") {
      warnings.push(
        'DEV_KV_BINDING resolved to "KV"; ensure this namespace is not shared with prod storage',
      );
    }
  }

  return {
    context,
    required,
    ok: !required || errors.length === 0,
    errors,
    warnings,
    bindings,
    resolved,
  };
}
