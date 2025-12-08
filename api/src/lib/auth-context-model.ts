export type PlanName = "free" | "pro" | "business" | "self-hosted";

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
const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;

const PLAN_PRESETS: Record<PlanName, PlanInfo> = {
  free: {
    name: "free",
    limits: {
      storage: 1 * GB, // 1GB
      fileSize: 5 * MB, // 5MB
      aiRequests: 0,
      dmMessagesPerDay: 100,
      dmMediaSize: 5 * MB, // 5MB
      vfsStorage: 10 * MB,
      vfsMaxFiles: 100,
      vfsMaxFileSize: 100 * KB,
      vfsMaxWorkspaces: 1,
      apDeliveryPerMinute: 120,
      apDeliveryPerDay: 1000,
      apiRateLimits: {
        read: { perMinute: 60, perDay: 1000 },
        write: { perMinute: 10, perDay: 100 },
      },
    },
    features: ["basic_sns", "activitypub", "export", "api_read", "api_write"],
  },
  pro: {
    name: "pro",
    limits: {
      storage: 10 * GB, // 10GB
      fileSize: 25 * MB, // 25MB
      aiRequests: 1000,
      dmMessagesPerDay: 1000,
      dmMediaSize: 25 * MB, // 25MB
      vfsStorage: 100 * MB,
      vfsMaxFiles: 1000,
      vfsMaxFileSize: 1 * MB,
      vfsMaxWorkspaces: 5,
      apDeliveryPerMinute: 600,
      apDeliveryPerDay: 10000,
      apiRateLimits: {
        read: { perMinute: 300, perDay: 10000 },
        write: { perMinute: 60, perDay: 1000 },
      },
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
      storage: 100 * GB, // 100GB
      fileSize: 100 * MB, // 100MB
      aiRequests: 10000,
      dmMessagesPerDay: 10000,
      dmMediaSize: 100 * MB, // 100MB
      vfsStorage: 1 * GB,
      vfsMaxFiles: 10_000,
      vfsMaxFileSize: 10 * MB,
      vfsMaxWorkspaces: 20,
      apDeliveryPerMinute: 2400,
      apDeliveryPerDay: 100000,
      apiRateLimits: {
        read: { perMinute: 1000, perDay: 100000 },
        write: { perMinute: 300, perDay: 10000 },
      },
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
    },
    features: ["*"],
  },
};

const PLAN_ENV_KEYS = ["TAKOS_PLAN", "PLAN_TIER", "PLAN_NAME", "PLAN"];
const DEFAULT_PLAN = PLAN_PRESETS["self-hosted"];

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
