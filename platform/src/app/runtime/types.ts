import type { AiProviderRegistry } from "../../ai/provider-registry";

export type AppRuntimeMode = "prod" | "dev";

export type AppLogLevel = "debug" | "info" | "warn" | "error";

export type AppLogEntry = {
  timestamp: string;
  mode: AppRuntimeMode;
  workspaceId?: string;
  runId: string;
  handler?: string;
  level: AppLogLevel;
  message: string;
  data?: Record<string, unknown>;
};

export type AppLogSink = (entry: AppLogEntry) => void | Promise<void>;

export type AppResponseHeaders = Record<string, string | string[]>;

export type AppResponseInit = {
  status?: number;
  headers?: AppResponseHeaders;
};

export type AppJsonResponse<T = unknown> = {
  type: "json";
  status: number;
  headers?: AppResponseHeaders;
  body: T;
};

export type AppErrorResponse = {
  type: "error";
  status: number;
  headers?: AppResponseHeaders;
  message: string;
};

export type AppRedirectResponse = {
  type: "redirect";
  status: number;
  headers?: AppResponseHeaders;
  location: string;
};

export type AppResponse<T = unknown> = AppJsonResponse<T> | AppErrorResponse | AppRedirectResponse;

export type AppPlanName = string;

export type AppPlanLimits = {
  storage: number;
  fileSize: number;
  aiRequests: number;
  dmMessagesPerDay: number;
  dmMediaSize: number;
};

export type AppPlanInfo = {
  name: AppPlanName;
  limits: AppPlanLimits;
  features: string[];
};

export type AppRateLimitWindow = {
  perMinute: number;
  perDay: number;
};

export type AppAuthRateLimits = {
  read: AppRateLimitWindow;
  write: AppRateLimitWindow;
};

export type AppAuthUser = {
  id: string;
  handle?: string | null;
  name?: string | null;
  avatar?: string | null;
  bio?: string | null;
  createdAt?: string | null;
};

export interface AppAuthContext {
  userId: string | null;
  sessionId: string | null;
  isAuthenticated: boolean;
  plan: AppPlanInfo;
  limits: AppPlanLimits;
  rateLimits?: AppAuthRateLimits;
  user?: AppAuthUser | null;
  roles?: string[];
  [key: string]: unknown;
}

export type ServiceRegistry = Record<string, unknown>;

export type BindingResolverInfo = {
  mode: AppRuntimeMode;
  workspaceId?: string;
};

export type BindingResolver<T = unknown> = (name: string, info: BindingResolverInfo) => T;

export type AiRuntime = {
  providers?: AiProviderRegistry | null;
  [key: string]: unknown;
};

export interface TakosContext<
  TServices extends ServiceRegistry = ServiceRegistry,
  TDb = unknown,
  TStorage = unknown,
> {
  mode: AppRuntimeMode;
  workspaceId?: string;
  runId: string;
  handler?: string;
  auth?: AppAuthContext;
  services: TServices;
  db: (name: string) => TDb;
  storage: (name: string) => TStorage;
  ai: AiRuntime;
  log: (level: AppLogLevel, message: string, data?: Record<string, unknown>) => void;
  json: <T = unknown>(body: T, init?: AppResponseInit) => AppJsonResponse<T>;
  error: (message: string, status?: number) => AppErrorResponse;
  redirect: (location: string, status?: number) => AppRedirectResponse;
}

export type AppHandler = (ctx: TakosContext, input?: unknown) => unknown | Promise<unknown>;
export type AppHandlerMap = Record<string, AppHandler>;

export type AppScriptModule = Record<string, unknown>;

export type HandlerExecutionResult = {
  runId: string;
  response: AppResponse;
};
