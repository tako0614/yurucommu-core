export type PlanName = "free" | "pro" | "business" | "self-hosted";

export type PlanLimits = {
  storage: number;
  fileSize: number;
  aiRequests: number;
  dmMessagesPerDay: number;
  dmMediaSize: number;
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
};

export interface AuthContext {
  userId: string | null;
  sessionId: string | null;
  isAuthenticated: boolean;
  user: LocalUser | null;
  plan: PlanInfo;
  limits: PlanLimits;
  rateLimits: AuthRateLimits;
}

const UNLIMITED = Number.MAX_SAFE_INTEGER;

const PLAN_PRESETS: Record<PlanName, PlanInfo> = {
  free: {
    name: "free",
    limits: {
      storage: 1073741824, // 1GB
      fileSize: 5242880, // 5MB
      aiRequests: 0,
      dmMessagesPerDay: 100,
      dmMediaSize: 5242880, // 5MB
    },
    features: ["basic_sns", "activitypub", "export", "api_read", "api_write"],
  },
  pro: {
    name: "pro",
    limits: {
      storage: 10737418240, // 10GB
      fileSize: 26214400, // 25MB
      aiRequests: 1000,
      dmMessagesPerDay: 1000,
      dmMediaSize: 26214400, // 25MB
    },
    features: [
      "basic_sns",
      "activitypub",
      "export",
      "api_read",
      "api_write",
      "app_customization",
      "ui_customization",
      "ai",
      "custom_domain",
    ],
  },
  business: {
    name: "business",
    limits: {
      storage: 107374182400, // 100GB
      fileSize: 104857600, // 100MB
      aiRequests: 10000,
      dmMessagesPerDay: 10000,
      dmMediaSize: 104857600, // 100MB
    },
    features: [
      "basic_sns",
      "activitypub",
      "export",
      "api_read",
      "api_write",
      "app_customization",
      "ui_customization",
      "ai",
      "custom_domain",
      "priority_support",
      "analytics",
    ],
  },
  "self-hosted": {
    name: "self-hosted",
    limits: {
      storage: UNLIMITED,
      fileSize: UNLIMITED,
      aiRequests: UNLIMITED,
      dmMessagesPerDay: UNLIMITED,
      dmMediaSize: UNLIMITED,
    },
    features: ["*"],
  },
};

const RATE_LIMIT_PRESETS: Record<PlanName, AuthRateLimits> = {
  free: {
    read: { perMinute: 60, perDay: 1000 },
    write: { perMinute: 10, perDay: 100 },
  },
  pro: {
    read: { perMinute: 300, perDay: 10000 },
    write: { perMinute: 60, perDay: 1000 },
  },
  business: {
    read: { perMinute: 1000, perDay: 100000 },
    write: { perMinute: 300, perDay: 10000 },
  },
  "self-hosted": {
    read: { perMinute: UNLIMITED, perDay: UNLIMITED },
    write: { perMinute: UNLIMITED, perDay: UNLIMITED },
  },
};

const PLAN_ENV_KEYS = ["TAKOS_PLAN", "PLAN_TIER", "PLAN_NAME", "PLAN"];
const DEFAULT_PLAN = PLAN_PRESETS["self-hosted"];
const DEFAULT_RATE_LIMITS = RATE_LIMIT_PRESETS["self-hosted"];

const normalizePlanName = (value: unknown): PlanName => {
  if (typeof value !== "string") return "self-hosted";
  const normalized = value.trim().toLowerCase();
  if (normalized === "free") return "free";
  if (normalized === "pro" || normalized === "paid") return "pro";
  if (normalized === "business" || normalized === "enterprise" || normalized === "biz") return "business";
  if (
    normalized === "self-hosted" ||
    normalized === "self_hosted" ||
    normalized === "selfhosted" ||
    normalized === "oss"
  ) {
    return "self-hosted";
  }
  return "self-hosted";
};

export const resolvePlanFromEnv = (env: Record<string, unknown> | undefined): PlanInfo => {
  if (!env) return DEFAULT_PLAN;
  const rawPlan = PLAN_ENV_KEYS.map((key) => env[key]).find(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
  const planName = normalizePlanName(rawPlan);
  return PLAN_PRESETS[planName] ?? DEFAULT_PLAN;
};

export const resolveRateLimits = (plan: PlanInfo): AuthRateLimits => {
  return RATE_LIMIT_PRESETS[plan.name] ?? DEFAULT_RATE_LIMITS;
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
  rateLimits?: AuthRateLimits,
): AuthContext => {
  const planInfo = plan ?? DEFAULT_PLAN;
  const rateLimitInfo = rateLimits ?? resolveRateLimits(planInfo);

  if (!authResult) {
    return {
      sessionId: null,
      isAuthenticated: false,
      userId: null,
      user: null,
      plan: planInfo,
      limits: planInfo.limits,
      rateLimits: rateLimitInfo,
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
    rateLimits: rateLimitInfo,
  };
};
