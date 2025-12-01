export type ExecutionContext = "prod" | "dev";

type ActivityPubAvailability = {
  enabled: boolean;
  context: ExecutionContext;
  reason?: string;
};

export function parseBooleanFlag(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeContextValue(value: unknown): ExecutionContext | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();

  if (["dev", "development", "local", "preview"].includes(normalized)) {
    return "dev";
  }

  if (["prod", "production", "live"].includes(normalized)) {
    return "prod";
  }

  return null;
}

export function getExecutionContext(env: any): ExecutionContext {
  const candidates = [
    env?.TAKOS_CONTEXT,
    env?.APP_CONTEXT,
    env?.EXECUTION_CONTEXT,
    env?.APP_MODE,
    env?.APP_ENV,
    env?.NODE_ENV,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeContextValue(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return "prod";
}

export function isDevContext(env: any): boolean {
  return getExecutionContext(env) === "dev";
}

export function getActivityPubAvailability(env: any): ActivityPubAvailability {
  const context = getExecutionContext(env);
  if (context === "dev") {
    return {
      enabled: false,
      context,
      reason: "ActivityPub federation is disabled in dev context",
    };
  }

  if (!parseBooleanFlag(env?.ACTIVITYPUB_ENABLED, true)) {
    return {
      enabled: false,
      context,
      reason: "ActivityPub federation disabled by ACTIVITYPUB_ENABLED flag",
    };
  }

  return { enabled: true, context };
}

export function isActivityPubEnabled(env: any): boolean {
  return getActivityPubAvailability(env).enabled;
}
