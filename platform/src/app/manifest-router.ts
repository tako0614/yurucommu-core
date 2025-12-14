import { Hono } from "hono";
import type { Env, Handler, MiddlewareHandler, Next } from "hono";
import type { AppManifest, AppRouteDefinition, HttpMethod } from "./types";
import { isReservedHttpPath } from "./reserved-routes";
import { findCoreRouteOwner } from "./core-routes";

export type ManifestRouteHandler<THonoEnv extends Env = Env> = Handler<THonoEnv>;

export type ManifestRouteResolver<THonoEnv extends Env = Env> = (
  name: string,
) => ManifestRouteHandler<THonoEnv> | unknown;

export type ManifestRouteHandlerSource<THonoEnv extends Env = Env> =
  | Record<string, unknown>
  | Map<string, unknown>
  | ManifestRouteResolver<THonoEnv>;

export type AppRouteAdapterIssueType =
  | "handler_not_found"
  | "handler_not_function"
  | "auth_middleware_missing"
  | "invalid_method"
  | "reserved_route"
  | "core_route";

export type AppRouteAdapterIssue = {
  type: AppRouteAdapterIssueType;
  severity: "error" | "warning";
  message: string;
  routeId: string;
  method: string;
  path: string;
  handler?: string;
};

export type MountManifestRoutesOptions<THonoEnv extends Env = Env> = {
  manifest: AppManifest;
  handlers: ManifestRouteHandlerSource<THonoEnv>;
  app?: Hono<THonoEnv>;
  basePath?: string;
  authMiddleware?: MiddlewareHandler<THonoEnv>;
};

export type MountManifestRoutesResult<THonoEnv extends Env = Env> = {
  app: Hono<THonoEnv>;
  mountedRoutes: AppRouteDefinition[];
  issues: AppRouteAdapterIssue[];
};

const SUPPORTED_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function normalizeRoutePath(basePath: string | undefined, routePath: string): string {
  const safeRoute = (routePath || "").trim();
  const normalizedRoute = safeRoute.startsWith("/") ? safeRoute : `/${safeRoute}`;
  if (!basePath) return normalizedRoute || "/";
  const safeBase = basePath.trim();
  if (!safeBase) return normalizedRoute || "/";
  const prefix = safeBase.startsWith("/") ? safeBase : `/${safeBase}`;
  const cleanedPrefix = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  const combined = `${cleanedPrefix}${normalizedRoute}`;
  return combined.replace(/\/{2,}/g, "/") || "/";
}

function normalizeRouteKey(path: string): string {
  const normalized = (path || "").trim();
  if (!normalized) return "/";
  const withSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
  const withoutTrailing = withSlash === "/" ? "/" : withSlash.replace(/\/+$/, "");
  return withoutTrailing || "/";
}

function resolveHandler<THonoEnv extends Env>(
  source: ManifestRouteHandlerSource<THonoEnv>,
  name: string,
): ManifestRouteHandler<THonoEnv> | unknown {
  if (typeof source === "function") {
    return (source as ManifestRouteResolver<THonoEnv>)(name);
  }
  if (source instanceof Map) {
    return source.get(name);
  }
  return (source as Record<string, unknown>)[name];
}

function buildIssue(
  type: AppRouteAdapterIssueType,
  route: AppRouteDefinition,
  message: string,
): AppRouteAdapterIssue {
  return {
    type,
    severity: "error",
    message,
    routeId: route.id,
    method: route.method,
    path: route.path,
    handler: route.handler,
  };
}

export function mountManifestRoutes<THonoEnv extends Env = Env>(
  options: MountManifestRoutesOptions<THonoEnv>,
): MountManifestRoutesResult<THonoEnv> {
  const app = options.app ?? new Hono<THonoEnv>();
  const issues: AppRouteAdapterIssue[] = [];
  const mounted: AppRouteDefinition[] = [];
  const routes = Array.isArray(options.manifest?.routes) ? options.manifest.routes : [];

  for (const route of routes) {
    if (!SUPPORTED_METHODS.includes(route.method)) {
      issues.push(
        buildIssue(
          "invalid_method",
          route,
          `Unsupported method "${route.method}" for route ${route.path}`,
        ),
      );
      continue;
    }

    const normalizedPath = normalizeRouteKey(route.path);
    if (isReservedHttpPath(normalizedPath)) {
      issues.push(
        buildIssue(
          "reserved_route",
          route,
          `Reserved route "${normalizedPath}" cannot be defined in manifest`,
        ),
      );
      continue;
    }

    const coreOwner = findCoreRouteOwner(normalizedPath);
    if (coreOwner) {
      issues.push(
        buildIssue(
          "core_route",
          route,
          `Core route "${coreOwner.path}" is fixed to ${coreOwner.screenId}`,
        ),
      );
      continue;
    }

    const resolved = resolveHandler(options.handlers, route.handler);
    if (resolved === undefined) {
      issues.push(
        buildIssue(
          "handler_not_found",
          route,
          `Handler "${route.handler}" not found for route ${route.method} ${route.path}`,
        ),
      );
      continue;
    }
    if (typeof resolved !== "function") {
      issues.push(
        buildIssue(
          "handler_not_function",
          route,
          `Handler "${route.handler}" for route ${route.method} ${route.path} is not a function`,
        ),
      );
      continue;
    }

    if (route.auth && !options.authMiddleware) {
      issues.push(
        buildIssue(
          "auth_middleware_missing",
          route,
          `Route ${route.method} ${route.path} requires auth but no authMiddleware was provided`,
        ),
      );
      continue;
    }

    const middleware: MiddlewareHandler<THonoEnv>[] = [];
    if (route.auth && options.authMiddleware) {
      middleware.push(options.authMiddleware);
    }

    const handler = resolved as ManifestRouteHandler<THonoEnv>;
    const fullPath = normalizeRoutePath(options.basePath, route.path);
    app.on(route.method, fullPath, ...middleware, (c, next: Next) => handler(c, next));
    mounted.push(route);
  }

  return { app, mountedRoutes: mounted, issues };
}
