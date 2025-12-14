export type PlanName = string;

export type PlanLimits = {
  storage: number;
  fileSize: number;
  aiRequests: number;
  dmMessagesPerDay: number;
  dmMediaSize: number;
  vfsStorage: number;
  vfsMaxFiles: number;
  vfsMaxFileSize: number;
  vfsMaxWorkspaces: number;
  apDeliveryPerMinute: number;
  apDeliveryPerDay: number;
  apiRateLimits: AuthRateLimits;
};

export type PlanInfo = {
  name: PlanName;
  limits: PlanLimits;
  features: string[];
};

export type RateLimitWindow = {
  perMinute: number;
  perDay: number;
};

export type AuthRateLimits = {
  read: RateLimitWindow;
  write: RateLimitWindow;
};

export type LocalUser = {
  id: string;
  handle: string | null;
  name: string | null;
  avatar: string | null;
  bio: string | null;
  createdAt: string | null;
};

export type AuthenticatedUser = {
  user: any;
  sessionUser: any;
  activeUserId: string | null;
  sessionId: string | null;
  token: string | null;
  source?: "session" | "jwt";
};

export interface AuthContext {
  userId: string | null;
  sessionId: string | null;
  isAuthenticated: boolean;
  user: LocalUser | null;
  plan: PlanInfo;
  limits: PlanLimits;
}

const UNLIMITED = Number.MAX_SAFE_INTEGER;

const DEFAULT_LIMITS: PlanLimits = {
  storage: UNLIMITED,
  fileSize: UNLIMITED,
  aiRequests: UNLIMITED,
  dmMessagesPerDay: UNLIMITED,
  dmMediaSize: UNLIMITED,
  vfsStorage: UNLIMITED,
  vfsMaxFiles: UNLIMITED,
  vfsMaxFileSize: UNLIMITED,
  vfsMaxWorkspaces: UNLIMITED,
  apDeliveryPerMinute: UNLIMITED,
  apDeliveryPerDay: UNLIMITED,
  apiRateLimits: {
    read: { perMinute: UNLIMITED, perDay: UNLIMITED },
    write: { perMinute: UNLIMITED, perDay: UNLIMITED },
  },
};

const PLAN_ENV_KEYS = ["TAKOS_PLAN", "PLAN_TIER", "PLAN_NAME", "PLAN"];
const DEFAULT_PLAN_NAME = "self-hosted";
const DEFAULT_PLAN: PlanInfo = {
  name: DEFAULT_PLAN_NAME,
  limits: DEFAULT_LIMITS,
  features: ["*"],
};

const PLAN_INFO_ENV_KEYS = ["TAKOS_PLAN_INFO", "TAKOS_PLAN_INFO_JSON"];
const PLAN_LIMITS_ENV_KEYS = ["TAKOS_PLAN_LIMITS", "TAKOS_PLAN_LIMITS_JSON"];
const PLAN_FEATURES_ENV_KEYS = ["TAKOS_PLAN_FEATURES", "TAKOS_FEATURES"];

const normalizePlanName = (value: unknown): PlanName => {
  if (typeof value !== "string") return DEFAULT_PLAN_NAME;
  const normalized = value.trim().toLowerCase();
  return normalized || DEFAULT_PLAN_NAME;
};

const parseJsonEnv = (value: unknown): unknown => {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
};

const pickEnvValue = (env: Record<string, unknown>, keys: string[]): unknown =>
  keys.map((key) => env[key]).find((value) => value !== undefined && value !== null);

const toFeatureList = (value: unknown): string[] | null => {
  if (Array.isArray(value)) {
    const out = value
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter((v) => v.length > 0);
    return out.length ? out : null;
  }
  if (typeof value !== "string") return null;
  const parts = value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  return parts.length ? parts : null;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const mergeLimits = (base: PlanLimits, overrides: unknown): PlanLimits => {
  if (!isObject(overrides)) return base;
  const next: any = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (key === "apiRateLimits" && isObject(value)) {
      next.apiRateLimits = {
        read: { ...base.apiRateLimits.read, ...(isObject((value as any).read) ? (value as any).read : {}) },
        write: { ...base.apiRateLimits.write, ...(isObject((value as any).write) ? (value as any).write : {}) },
      };
      continue;
    }
    next[key] = value;
  }
  return next as PlanLimits;
};

export const resolvePlanFromEnv = (env: Record<string, unknown> | undefined): PlanInfo => {
  if (!env) return DEFAULT_PLAN;

  const rawPlan = PLAN_ENV_KEYS.map((key) => env[key]).find(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
  const planName = normalizePlanName(rawPlan);

  const infoCandidate = parseJsonEnv(pickEnvValue(env, PLAN_INFO_ENV_KEYS));
  if (isObject(infoCandidate)) {
    const limits = mergeLimits(DEFAULT_LIMITS, (infoCandidate as any).limits);
    const features =
      toFeatureList((infoCandidate as any).features) ??
      toFeatureList(pickEnvValue(env, PLAN_FEATURES_ENV_KEYS)) ??
      DEFAULT_PLAN.features;
    const name = normalizePlanName((infoCandidate as any).name ?? planName);
    return { name, limits, features };
  }

  const limitsCandidate = parseJsonEnv(pickEnvValue(env, PLAN_LIMITS_ENV_KEYS));
  const limits = mergeLimits(DEFAULT_LIMITS, limitsCandidate);
  const features =
    toFeatureList(pickEnvValue(env, PLAN_FEATURES_ENV_KEYS)) ??
    DEFAULT_PLAN.features;

  return {
    name: planName,
    limits,
    features,
  };
};

export const mapToLocalUser = (user: any): LocalUser | null => {
  if (!user) return null;

  const idValue = (user as any).id;
  const id =
    typeof idValue === "string"
      ? idValue
      : typeof idValue === "number" && Number.isFinite(idValue)
        ? String(idValue)
        : null;
  if (!id) return null;

  const handle =
    typeof user.handle === "string" && user.handle.trim()
      ? user.handle.trim()
      : typeof user.local_id === "string" && user.local_id.trim()
        ? user.local_id.trim()
        : null;
  const name =
    typeof user.display_name === "string" && user.display_name.trim()
      ? user.display_name
      : typeof user.name === "string" && user.name.trim()
        ? user.name
        : null;
  const avatar =
    typeof user.avatar_url === "string" && user.avatar_url.trim()
      ? user.avatar_url
      : typeof user.avatar === "string" && user.avatar.trim()
        ? user.avatar
        : null;
  const bio = typeof user.summary === "string" ? user.summary : typeof user.bio === "string" ? user.bio : null;

  const createdAtRaw = (user as any).created_at ?? (user as any).createdAt ?? null;
  let createdAt: string | null = null;
  if (createdAtRaw instanceof Date && !Number.isNaN(createdAtRaw.getTime())) {
    createdAt = createdAtRaw.toISOString();
  } else if (typeof createdAtRaw === "string" && createdAtRaw.trim()) {
    const parsed = new Date(createdAtRaw);
    createdAt = Number.isNaN(parsed.getTime()) ? createdAtRaw : parsed.toISOString();
  }

  return {
    id,
    handle,
    name,
    avatar,
    bio,
    createdAt,
  };
};

export const buildAuthContext = (
  authResult: AuthenticatedUser | null,
  plan?: PlanInfo,
): AuthContext => {
  const planInfo = plan ?? DEFAULT_PLAN;

  if (!authResult) {
    return {
      sessionId: null,
      isAuthenticated: false,
      userId: null,
      user: null,
      plan: planInfo,
      limits: planInfo.limits,
    };
  }

  const userId = authResult.activeUserId ?? authResult.sessionUser?.id ?? null;
  const user = mapToLocalUser(authResult.user) ?? mapToLocalUser(authResult.sessionUser);

  return {
    sessionId: authResult.sessionId ?? authResult.token ?? null,
    isAuthenticated: true,
    userId,
    user,
    plan: planInfo,
    limits: planInfo.limits,
  };
};
