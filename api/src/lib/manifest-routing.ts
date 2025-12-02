import { Hono, type MiddlewareHandler } from "hono";
import {
  AppHandlerRegistry,
  loadAppMainFromModule,
  mountManifestRoutes,
  type AppManifest,
  type AppRouteAdapterIssue,
  type AppScriptModule,
} from "@takos/platform/app";
import type { PublicAccountBindings as Bindings } from "@takos/platform/server";
import { releaseStore } from "@takos/platform/server";
import { makeData } from "../data";
import * as bundledAppMain from "../../../app-main";

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
  const resolveHandler = (name: string) => options.registry.get(name) ?? undefined;
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
