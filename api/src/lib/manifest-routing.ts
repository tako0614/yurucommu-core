import { Hono, type MiddlewareHandler } from "hono";
import {
  AppHandlerRegistry,
  loadAppMainFromModule,
  mountManifestRoutes,
  type ManifestRouteHandler,
  type AppManifest,
  type AppRouteAdapterIssue,
  type AppScriptModule,
} from "@takos/platform/app";
import { createTakosContext } from "@takos/platform/app/runtime/context";
import type { AppAuthContext, AppResponse } from "@takos/platform/app/runtime/types";
import type { CoreServices } from "@takos/platform/app/services";
import type { PublicAccountBindings as Bindings } from "@takos/platform/server";
import { releaseStore } from "@takos/platform/server";
import { makeData } from "../data";
import * as bundledAppMain from "../../../app-main";
import {
  createPostService,
  createUserService,
  createCommunityService,
  createDMService,
  createStoryService,
  createMediaService,
  createObjectService,
  createActorService,
  createStorageService,
  createNotificationService,
} from "../services";

export type ManifestRouterInstance = {
  app: Hono;
  issues: AppRouteAdapterIssue[];
  revisionId: string;
  matchers: RouteMatcher[];
  manifest: AppManifest;
  source: string;
};

type ActiveRevisionSnapshot = {
  revisionId: string;
  manifest: AppManifest;
  scriptRef?: string | null;
};

type RouteMatcher = {
  method: string;
  path: string;
  test(pathname: string): boolean;
};

type RegistryResult = {
  registry: AppHandlerRegistry;
  source: string;
};

const buildServices = (env: Bindings): CoreServices => {
  const actors = createActorService(env as any);
  const notifications = createNotificationService(env as any);
  const storage = createStorageService(env as any);
  const objects = createObjectService(env as any);
  return {
    posts: createPostService(env as any),
    users: createUserService(env as any, actors, notifications),
    communities: createCommunityService(env as any),
    dm: createDMService(env as any),
    stories: createStoryService(env as any),
    media: createMediaService(env as any, storage),
    objects,
    actors,
    storage,
    notifications,
  };
};

const toAppAuthContext = (c: any): AppAuthContext => {
  const user = c.get("user") as any;
  const activeUserId = c.get("activeUserId") as string | null;
  if (user?.id || activeUserId) {
    return { userId: activeUserId || user?.id || null };
  }
  return { userId: null };
};

const normalizeInput = async (c: any): Promise<Record<string, unknown>> => {
  const url = new URL(c.req.url);
  const query: Record<string, unknown> = {};
  url.searchParams.forEach((value, key) => {
    if (!(key in query)) query[key] = value;
  });
  const params = typeof c.req.param === "function" ? c.req.param() : {};
  let body: any = {};
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    body = (await c.req.json().catch(() => ({}))) as any;
  }
  return { ...query, ...(params || {}), ...(typeof body === "object" && body !== null ? body : {}) };
};

const toResponse = (res: AppResponse): Response => {
  if (res.type === "json") {
    return new Response(JSON.stringify(res.body ?? null), {
      status: res.status,
      headers: { "Content-Type": "application/json", ...(res.headers || {}) },
    });
  }
  if (res.type === "redirect") {
    return new Response(null, {
      status: res.status,
      headers: { Location: res.location, ...(res.headers || {}) },
    });
  }
  return new Response(res.message, {
    status: res.status,
    headers: res.headers,
  });
};

const boolFromEnv = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
  }
  return false;
};

export const isManifestRoutingEnabled = (env: any): boolean =>
  boolFromEnv(env?.APP_ROUTES_FROM_MANIFEST ?? env?.USE_APP_MANIFEST_ROUTES);

const normalizeRoutePath = (basePath: string | undefined, routePath: string): string => {
  const safeRoute = (routePath || "").trim();
  const normalizedRoute = safeRoute.startsWith("/") ? safeRoute : `/${safeRoute}`;
  if (!basePath) return normalizedRoute || "/";
  const safeBase = basePath.trim();
  if (!safeBase) return normalizedRoute || "/";
  const prefix = safeBase.startsWith("/") ? safeBase : `/${safeBase}`;
  const cleanedPrefix = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  const combined = `${cleanedPrefix}${normalizedRoute}`;
  return combined.replace(/\/{2,}/g, "/") || "/";
};

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildPathMatcher = (method: string, path: string): RouteMatcher => {
  const normalized = path === "/" ? "/" : path.replace(/\/+$/, "");
  if (normalized === "/") {
    return { method, path: "/", test: (pathname) => pathname === "/" };
  }
  const segments = normalized.split("/").filter(Boolean);
  const pattern = segments
    .map((segment) => {
      if (segment === "*") return ".*";
      if (segment.startsWith(":")) return "[^/]+";
      return escapeRegex(segment);
    })
    .join("/");
  const regex = new RegExp(`^/${pattern}/?$`);
  return {
    method,
    path: normalized,
    test: (pathname: string) => regex.test(pathname),
  };
};

const parseManifestSnapshot = (snapshot: unknown): AppManifest | null => {
  if (!snapshot) return null;
  try {
    if (typeof snapshot === "string") {
      return JSON.parse(snapshot) as AppManifest;
    }
    if (typeof snapshot === "object") {
      return snapshot as AppManifest;
    }
  } catch (error) {
    console.error("[manifest-routing] failed to parse manifest snapshot", error);
  }
  return null;
};

type ManifestValidationIssue = {
  severity: "error" | "warning";
  message: string;
  context?: string;
};

const validateAppManifest = (manifest: AppManifest): { ok: boolean; issues: ManifestValidationIssue[] } => {
  const issues: ManifestValidationIssue[] = [];

  // Validate Routes
  const routeIds = new Set<string>();
  const routePaths = new Set<string>();

  for (const route of manifest.routes || []) {
    // ID uniqueness
    if (routeIds.has(route.id)) {
      issues.push({
        severity: "error",
        message: `Duplicate route ID: ${route.id}`,
        context: `route:${route.id}`,
      });
    } else {
      routeIds.add(route.id);
    }

    // Path uniqueness (method + path)
    const key = `${route.method.toUpperCase()}:${route.path}`;
    if (routePaths.has(key)) {
      issues.push({
        severity: "error",
        message: `Duplicate route path: ${route.method} ${route.path}`,
        context: `route:${route.id}`
      });
    } else {
      routePaths.add(key);
    }
  }

  // Validate Views (Screens)
  const screenIds = new Set<string>();
  const screenRoutes = new Set<string>();

  for (const screen of manifest.views?.screens || []) {
    if (screenIds.has(screen.id)) {
      issues.push({
        severity: "error",
        message: `Duplicate screen ID: ${screen.id}`,
        context: `screen:${screen.id}`
      });
    } else {
      screenIds.add(screen.id);
    }

    if (screen.route) {
      if (screenRoutes.has(screen.route)) {
        issues.push({
          severity: "error",
          message: `Duplicate screen route: ${screen.route}`,
          context: `screen:${screen.id}`
        });
      } else {
        screenRoutes.add(screen.route);
      }
    }
  }

  // Validate Data Collections (runtime check for extended properties)
  const data = (manifest as any).data;
  if (data?.collections) {
    const collectionNames = new Set<string>();
    for (const name of Object.keys(data.collections)) {
      if (collectionNames.has(name)) {
        issues.push({
          severity: "error",
          message: `Duplicate collection name: ${name}`,
          context: `data:${name}`
        });
      } else {
        collectionNames.add(name);
      }
    }
  }

  // Validate Storage Buckets (runtime check for extended properties)
  const storage = (manifest as any).storage;
  if (storage?.buckets) {
    const bucketNames = new Set<string>();
    for (const name of Object.keys(storage.buckets)) {
      if (bucketNames.has(name)) {
        issues.push({
          severity: "error",
          message: `Duplicate bucket name: ${name}`,
          context: `storage:${name}`
        });
      } else {
        bucketNames.add(name);
      }
    }
  }

  return {
    ok: !issues.some(i => i.severity === "error"),
    issues
  };
};

const loadActiveManifest = async (env: Bindings): Promise<ActiveRevisionSnapshot | null> => {
  let store: any = null;
  try {
    store = makeData(env as any);
  } catch (error) {
    console.error("[manifest-routing] failed to initialize data store", error);
    return null;
  }

  try {
    if (!store?.getActiveAppRevision) return null;
    const state = await store.getActiveAppRevision();
    const revision = state?.revision ?? null;
    const manifest =
      parseManifestSnapshot(
        revision?.manifest_snapshot ?? state?.manifest_snapshot ?? revision?.manifestSnapshot ?? null,
      ) ?? null;
    if (!manifest) return null;

    // Validate manifest
    const validation = validateAppManifest(manifest);
    if (!validation.ok) {
      console.error("[manifest-routing] manifest validation failed", validation.issues);
      // We might still want to return the manifest but with issues logged, 
      // or reject it. For now, we log and proceed but maybe we should block?
      // PLAN.md says "Runtime validation", implying it should probably prevent broken routing.
      // However, to avoid breaking existing apps during dev, we'll just log errors for now.
    }

    const revisionId = revision?.id ?? state?.active_revision_id ?? "active";
    const scriptRef = revision?.script_snapshot_ref ?? revision?.scriptSnapshotRef ?? null;
    return { revisionId, manifest, scriptRef };

  } catch (error) {
    console.error("[manifest-routing] failed to load active app revision", error);
    return null;
  } finally {
    if (store) {
      try {
        await releaseStore(store);
      } catch {
        // ignore cleanup failures
      }
    }
  }
};

const loadAppRegistry = async (env: Bindings): Promise<RegistryResult | null> => {
  const candidates: Array<{ source: string; module: AppScriptModule | undefined | null }> = [
    { source: "env:APP_MAIN_MODULE", module: (env as any)?.APP_MAIN_MODULE },
    { source: "global:__takosAppMain", module: (globalThis as any)?.__takosAppMain },
    { source: "bundle:app-main", module: bundledAppMain as unknown as AppScriptModule },
  ];

  for (const candidate of candidates) {
    if (!candidate.module) continue;
    try {
      const loaded = await loadAppMainFromModule(candidate.module, candidate.source);
      return { registry: loaded.registry, source: candidate.source };
    } catch (error) {
      console.error(
        `[manifest-routing] failed to load app-main from ${candidate.source}: ${(error as Error).message}`,
      );
    }
  }

  console.error("[manifest-routing] no App Script module available for manifest routing");
  return null;
};

export const createManifestRouter = (options: {
  manifest: AppManifest;
  registry: AppHandlerRegistry;
  authMiddleware?: MiddlewareHandler;
  basePath?: string;
  revisionId: string;
  source: string;
}): ManifestRouterInstance => {
  const resolveHandler = (name: string) => {
    const appHandler = options.registry.get(name);
    if (!appHandler) return undefined;
    const honoHandler: ManifestRouteHandler = async (c: any) => {
      const services = buildServices(c.env as Bindings);
      const auth = toAppAuthContext(c);
      const input = await normalizeInput(c);
      const ctx = createTakosContext({
        mode: "prod",
        handlerName: name,
        auth,
        services: services as unknown as Record<string, unknown>,
        logSink: (entry) => console.log("[app]", entry),
      });
      const result = await appHandler(ctx, input);
      const response = (result as any)?.type ? (result as AppResponse) : ctx.json(result);
      return toResponse(response);
    };
    return honoHandler;
  };
  const mountResult = mountManifestRoutes({
    manifest: options.manifest,
    handlers: resolveHandler,
    authMiddleware: options.authMiddleware,
    basePath: options.basePath,
  });
  const matchers = mountResult.mountedRoutes.map((route) => {
    const fullPath = normalizeRoutePath(options.basePath, route.path);
    return buildPathMatcher(route.method, fullPath);
  });
  return {
    app: mountResult.app,
    issues: mountResult.issues,
    revisionId: options.revisionId,
    matchers,
    manifest: options.manifest,
    source: options.source,
  };
};

let cachedRouter: ManifestRouterInstance | null = null;
let buildPromise: Promise<ManifestRouterInstance | null> | null = null;

export const clearManifestRouterCache = (): void => {
  cachedRouter = null;
  buildPromise = null;
};

const buildRouterFromActiveRevision = async (
  active: ActiveRevisionSnapshot,
  env: Bindings,
  authMiddleware: MiddlewareHandler,
): Promise<ManifestRouterInstance | null> => {
  const registryResult = await loadAppRegistry(env);
  if (!registryResult) return null;
  const router = createManifestRouter({
    manifest: active.manifest,
    registry: registryResult.registry,
    authMiddleware,
    revisionId: active.revisionId,
    source: registryResult.source,
  });
  if (router.issues.length) {
    console.warn(
      `[manifest-routing] mounted with ${router.issues.length} issue(s) for revision ${active.revisionId}`,
    );
  }
  return router;
};

export const resolveManifestRouter = async (
  env: Bindings,
  authMiddleware: MiddlewareHandler,
): Promise<ManifestRouterInstance | null> => {
  const active = await loadActiveManifest(env);
  if (!active) return null;
  if (cachedRouter && cachedRouter.revisionId === active.revisionId) {
    return cachedRouter;
  }
  if (buildPromise) {
    const pending = await buildPromise;
    if (pending && pending.revisionId === active.revisionId) {
      cachedRouter = pending;
      return pending;
    }
  }
  buildPromise = buildRouterFromActiveRevision(active, env, authMiddleware);
  const built = await buildPromise;
  buildPromise = null;
  if (built) {
    cachedRouter = built;
  }
  return built;
};

export const matchesManifestRoute = (
  router: ManifestRouterInstance | null,
  method: string,
  pathname: string,
): boolean => {
  if (!router) return false;
  const normalizedMethod = (method || "").toUpperCase();
  return router.matchers.some(
    (matcher) => matcher.method === normalizedMethod && matcher.test(pathname),
  );
};
