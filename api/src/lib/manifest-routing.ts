import { Hono, type MiddlewareHandler } from "hono";
import {
  AppHandlerRegistry,
  mountManifestRoutes,
  isReservedHttpPath,
  CORE_SCREEN_ROUTES,
  findCoreRouteOwner,
  type ManifestRouteHandler,
  type AppManifest,
  loadAppManifest,
  type AppRouteAdapterIssue,
  type AppManifestValidationIssue,
  validateUiContractAgainstManifest,
  parseUiContractJson,
} from "@takos/platform/app";
import type { AppAuthContext, AppResponse } from "@takos/platform/app/runtime/types";
import type { PublicAccountBindings as Bindings } from "@takos/platform/server";
import {
  APP_MANIFEST_SCHEMA_VERSION,
  TAKOS_CORE_VERSION,
  checkSemverCompatibility,
  HttpError,
  releaseStore,
} from "@takos/platform/server";
import { makeData } from "../data";
import { getAppAuthContext } from "./auth-context";
import { loadAppRegistryFromScript } from "./app-script-loader";
import { createIsolatedAppRunner } from "./app-worker-loader";
import uiContractJson from "../../../schemas/ui-contract.json";
import { ErrorCodes } from "./error-codes";
import { inspectAppScriptCode } from "./app-code-inspection";

const boolFromEnv = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
  }
  return false;
};

const isDevEnv = (env: any): boolean => {
  const context = typeof env?.TAKOS_CONTEXT === "string" ? env.TAKOS_CONTEXT.trim().toLowerCase() : "";
  if (context === "dev") return true;
  const nodeEnv = typeof env?.NODE_ENV === "string" ? env.NODE_ENV.trim().toLowerCase() : "";
  return nodeEnv === "development";
};

export type ManifestRouterInstance = {
  app: Hono;
  issues: AppRouteAdapterIssue[];
  validationIssues: AppManifestValidationIssue[];
  revisionId: string;
  scriptRef?: string | null;
  scriptSource?: string;
  matchers: RouteMatcher[];
  manifest: AppManifest;
  source: string;
};

type ActiveRevisionSnapshot = {
  revisionId: string;
  manifest: AppManifest;
  scriptRef?: string | null;
  source: string;
  schemaVersion?: string | null;
  scriptSource?: string;
  scriptCode?: string;
};

type RouteMatcher = {
  method: string;
  path: string;
  test(pathname: string): boolean;
};

type ManifestLoadResult = {
  ok: boolean;
  issues: AppManifestValidationIssue[];
  snapshot?: ActiveRevisionSnapshot | null;
  registry?: AppHandlerRegistry | null;
};

type ManifestSnapshotResolver = (
  env: Bindings,
) => Promise<{ snapshot: ActiveRevisionSnapshot | null; issues: AppManifestValidationIssue[] }>;

const textDecoder = new TextDecoder();

const encodeKeySegment = (value: string): string =>
  encodeURIComponent(value).replace(/%2F/gi, "/");

const normalizeStoragePath = (...parts: string[]): string => {
  const cleaned = parts
    .map((part) => (part || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""))
    .filter((part) => part.length > 0);
  return cleaned.join("/");
};

const decodeBase64 = (input: string): string => {
  if (typeof atob === "function") {
    return atob(input);
  }
  // @ts-ignore Buffer is available in Node.js / tests
  if (typeof Buffer !== "undefined") {
    // @ts-ignore Buffer is available in Node.js / tests
    return Buffer.from(input, "base64").toString("utf8");
  }
  throw new Error("Base64 decoding is not supported in this environment");
};

const tryReadObjectText = async (source: any, key: string): Promise<string | null> => {
  if (!source) return null;
  try {
    const raw =
      (await source.get?.(key, "text")) ??
      (await source.get?.(key)) ??
      (await source.get?.(key));
    if (!raw) return null;
    if (typeof raw === "string") return raw;
    if (typeof raw.text === "function") {
      return await raw.text();
    }
    if (raw instanceof ArrayBuffer) {
      return textDecoder.decode(new Uint8Array(raw));
    }
    if (typeof raw.arrayBuffer === "function") {
      const buf = await raw.arrayBuffer();
      return textDecoder.decode(new Uint8Array(buf));
    }
    if (raw.body && typeof raw.body === "string") {
      return raw.body;
    }
  } catch (error) {
    console.error("[manifest-routing] failed to read manifest object", error);
  }
  return null;
};

const createR2AppSource = (bucket: any, basePrefix: string) => {
  const prefix = normalizeStoragePath(basePrefix);
  const toKey = (path: string): string => {
    const normalized = normalizeStoragePath(path);
    if (!prefix) return normalized;
    if (!normalized) return prefix;
    return normalizeStoragePath(prefix, normalized);
  };

  return {
    async readFile(path: string): Promise<string> {
      const key = toKey(path);
      const text = await tryReadObjectText(bucket, key);
      if (text === null) {
        throw new Error(`File not found: ${key}`);
      }
      return text;
    },
    async listFiles(dir: string): Promise<string[]> {
      const normalizedDir = toKey(dir);
      const prefixWithSlash = normalizeStoragePath(normalizedDir);
      const listPrefix = prefixWithSlash ? `${prefixWithSlash}/` : "";
      try {
        const res = await bucket.list({ prefix: listPrefix, delimiter: "/" });
        const objects = Array.isArray(res?.objects) ? res.objects : [];
        const files = new Set<string>();
        for (const obj of objects) {
          const key = (obj as any)?.key || "";
          if (!key.startsWith(listPrefix)) continue;
          const rest = key.slice(listPrefix.length);
          if (!rest || rest.includes("/")) continue;
          files.add(rest);
        }
        return Array.from(files);
      } catch (error) {
        console.error("[manifest-routing] failed to list manifest files from R2", error);
        return [];
      }
    },
  };
};

const normalizeManifestFromSnapshot = (
  manifest: unknown,
  fallbackSchema?: string | null,
): AppManifest | null => {
  const parsed = parseManifestSnapshot(manifest);
  if (!parsed) return null;
  return normalizeManifestSnapshot(parsed, fallbackSchema);
};

const loadManifestFromR2 = async (
  ref: string,
  env: Bindings,
): Promise<{ manifest: AppManifest | null; source?: string; issues: AppManifestValidationIssue[] }> => {
  const bucket =
    (env as any)?.APP_MANIFESTS ??
    (env as any)?.APP_MANIFEST ??
    (env as any)?.VFS_BUCKET ??
    (env as any)?.WORKSPACE_VFS ??
    (env as any)?.MEDIA ??
    null;
  const issues: AppManifestValidationIssue[] = [];
  const key = ref.startsWith("r2:") ? ref.slice("r2:".length) : ref;
  if (!bucket) {
    issues.push({ severity: "error", message: "manifest bucket is not configured", path: "manifest_ref" });
    return { manifest: null, source: key ? `r2:${key}` : "r2", issues };
  }

  const directText = await tryReadObjectText(bucket, key);
  if (directText) {
    const manifest = normalizeManifestFromSnapshot(directText);
    if (manifest) {
      return { manifest, source: `r2:${key}`, issues };
    }
  }

  const source = createR2AppSource(bucket, key);
  const result = await loadAppManifest({
    source,
    rootDir: key || ".",
  });
  return {
    manifest: result.manifest ? normalizeManifestSnapshot(result.manifest) : null,
    source: `r2:${key}`,
    issues: [...issues, ...(result.issues ?? [])],
  };
};

const loadManifestFromRef = async (
  ref: string | null | undefined,
  env: Bindings,
): Promise<{ manifest: AppManifest | null; source?: string; issues: AppManifestValidationIssue[] }> => {
  const issues: AppManifestValidationIssue[] = [];
  const trimmed = typeof ref === "string" ? ref.trim() : "";
  if (!trimmed) return { manifest: null, issues };

  if (trimmed.startsWith("inline:")) {
    const encoded = trimmed.slice("inline:".length);
    if (!encoded) {
      issues.push({ severity: "error", message: "manifest ref is empty", path: "manifest_ref" });
      return { manifest: null, issues };
    }
    let decoded: string | null = null;
    try {
      decoded = decodeBase64(encoded);
    } catch {
      try {
        decoded = decodeURIComponent(encoded);
      } catch {
        decoded = null;
      }
    }
    if (!decoded) {
      issues.push({ severity: "error", message: "failed to decode inline manifest ref", path: "manifest_ref" });
      return { manifest: null, issues };
    }
    const manifest = normalizeManifestFromSnapshot(decoded);
    if (!manifest) {
      issues.push({
        severity: "error",
        message: "inline manifest ref does not contain valid JSON",
        path: "manifest_ref",
      });
      return { manifest: null, issues };
    }
    return { manifest, source: "inline:manifest", issues };
  }

  if (trimmed.startsWith("data:")) {
    try {
      const res = await fetch(trimmed);
      const text = await res.text();
      const manifest = normalizeManifestFromSnapshot(text);
      if (manifest) {
        return { manifest, source: "data-url:manifest", issues };
      }
    } catch (error) {
      issues.push({
        severity: "error",
        message: `failed to load manifest from data url: ${(error as Error).message}`,
        path: "manifest_ref",
      });
      return { manifest: null, issues };
    }
    issues.push({
      severity: "error",
      message: "manifest data url did not contain valid JSON",
      path: "manifest_ref",
    });
    return { manifest: null, issues };
  }

  if (trimmed.startsWith("r2:")) {
    return loadManifestFromR2(trimmed, env);
  }

  if (trimmed.startsWith("ws:") || trimmed.startsWith("vfs:")) {
    const prefix = trimmed.startsWith("ws:") ? trimmed.slice(3) : trimmed.slice(4);
    const [workspaceId, ...rest] = prefix.split(":");
    if (!workspaceId) {
      issues.push({ severity: "error", message: "workspace id missing in manifest ref", path: "manifest_ref" });
      return { manifest: null, issues };
    }
    const workspacePrefix = normalizeStoragePath(
      "vfs",
      encodeKeySegment(workspaceId),
      rest.join(":").replace(/^\/+/, ""),
    );
    return loadManifestFromR2(workspacePrefix, env);
  }

  issues.push({
    severity: "error",
    message: `unsupported manifest ref "${trimmed}"`,
    path: "manifest_ref",
  });
  return { manifest: null, issues };
};

let customManifestResolver: ManifestSnapshotResolver | null = null;

export const setActiveManifestLoader = (resolver: ManifestSnapshotResolver | null): void => {
  customManifestResolver = resolver;
};

const builtinUiContract = (() => {
  const parsed = parseUiContractJson(JSON.stringify(uiContractJson), "schemas/ui-contract.json");
  return {
    contract: parsed.contract ?? null,
    issues: parsed.issues ?? [],
  };
})();

const hasValidationErrors = (issues: AppManifestValidationIssue[]): boolean =>
  issues.some((issue) => issue.severity === "error");

const toAppAuthContext = (c: any): AppAuthContext => getAppAuthContext(c);

const normalizeRouteKey = (path: string): string => {
  const normalized = (path || "").trim();
  if (!normalized) return "/";
  const withSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
  const withoutTrailing = withSlash === "/" ? "/" : withSlash.replace(/\/+$/, "");
  return withoutTrailing || "/";
};

const isReservedRoute = (path: string): boolean => {
  return isReservedHttpPath(normalizeRouteKey(path));
};

const CORE_ROUTE_BY_ID: Record<string, string> = CORE_SCREEN_ROUTES;

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
  const headers = new Headers();

  const appendHeader = (name: string, value: string | string[] | undefined) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((v) => headers.append(name, v));
    } else {
      headers.append(name, value);
    }
  };

  if (res.headers) {
    for (const [key, value] of Object.entries(res.headers)) {
      appendHeader(key, value as string | string[] | undefined);
    }
  }

  if (res.type === "json") {
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    return new Response(JSON.stringify(res.body ?? null), {
      status: res.status,
      headers,
    });
  }
  if (res.type === "redirect") {
    headers.set("Location", res.location);
    return new Response(null, {
      status: res.status,
      headers,
    });
  }
  return new Response(res.message, {
    status: res.status,
    headers,
  });
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
  const segmentToRegex = (segment: string): string => {
    if (segment === "*") return ".*";
    let out = "";
    for (let i = 0; i < segment.length; i += 1) {
      const ch = segment[i];
      if (ch === ":") {
        let j = i + 1;
        while (j < segment.length && /[A-Za-z0-9_]/.test(segment[j])) j += 1;
        if (j > i + 1) {
          out += "[^/]+";
          i = j - 1;
          continue;
        }
      }
      out += escapeRegex(ch);
    }
    return out;
  };
  const pattern = segments
    .map((segment) => {
      return segmentToRegex(segment);
    })
    .join("/");
  const regex = new RegExp(`^/${pattern}/?$`);
  return {
    method,
    path: normalized,
    test: (pathname: string) => regex.test(pathname),
  };
};

const findCoreRouteMatch = (pathname: string): { path: string; screenId: string } | null => {
  const normalized = normalizeRouteKey(pathname);
  const owner = findCoreRouteOwner(normalized);
  if (!owner) return null;
  return { path: owner.path, screenId: owner.screenId };
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

const normalizeSchemaVersionValue = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeManifestSnapshot = (
  manifest: AppManifest | Record<string, unknown>,
  fallbackSchema?: string | null,
): AppManifest => {
  const schemaVersion =
    normalizeSchemaVersionValue((manifest as any)?.schemaVersion ?? (manifest as any)?.schema_version) ??
    normalizeSchemaVersionValue(fallbackSchema) ??
    "";
  const rawViews = (manifest as any)?.views ?? {};
  const rawAp = (manifest as any)?.ap ?? {};
  const rawData = (manifest as any)?.data ?? {};
  const rawStorage = (manifest as any)?.storage ?? {};
  return {
    schemaVersion,
    version: (manifest as any)?.version,
    routes: Array.isArray((manifest as any)?.routes) ? ((manifest as any)?.routes as any[]) : [],
    views: {
      screens: Array.isArray(rawViews?.screens) ? (rawViews.screens as any[]) : [],
      insert: Array.isArray(rawViews?.insert) ? (rawViews.insert as any[]) : [],
    },
    ap: {
      handlers: Array.isArray(rawAp?.handlers) ? (rawAp.handlers as any[]) : [],
    },
    data: {
      collections:
        rawData?.collections && typeof rawData.collections === "object" && !Array.isArray(rawData.collections)
          ? (rawData.collections as Record<string, any>)
          : {},
    },
    storage: {
      buckets:
        rawStorage?.buckets &&
        typeof rawStorage.buckets === "object" &&
        !Array.isArray(rawStorage.buckets)
          ? (rawStorage.buckets as Record<string, any>)
          : {},
    },
  };
};

const validateSchemaVersion = (manifest: AppManifest): AppManifestValidationIssue[] => {
  const issues: AppManifestValidationIssue[] = [];
  const schemaVersion = normalizeSchemaVersionValue(
    (manifest as any).schemaVersion ?? (manifest as any).schema_version,
  );
  if (!schemaVersion) {
    issues.push({
      severity: "error",
      message: "app manifest schema_version is required",
      path: "schema_version",
    });
    return issues;
  }

  const compatibility = checkSemverCompatibility(APP_MANIFEST_SCHEMA_VERSION, schemaVersion, {
    context: "app manifest schema_version",
    action: "runtime",
  });

  if (!compatibility.ok) {
    issues.push({
      severity: "error",
      message: compatibility.error || "app manifest schema_version is not compatible",
      path: "schema_version",
    });
  }
  issues.push(
    ...compatibility.warnings.map((message): AppManifestValidationIssue => ({
      severity: "warning",
      message,
      path: "schema_version",
    })),
  );

  (manifest as any).schemaVersion = schemaVersion;
  return issues;
};

const validateAppManifest = (manifest: AppManifest): { ok: boolean; issues: AppManifestValidationIssue[] } => {
  const issues: AppManifestValidationIssue[] = [];

  // Validate Routes
  const routeIds = new Set<string>();
  const routePaths = new Set<string>();

  for (const route of manifest.routes || []) {
    const normalizedPath = normalizeRouteKey(route.path);

    // ID uniqueness
    if (routeIds.has(route.id)) {
      issues.push({
        severity: "error",
        message: `Duplicate route ID: ${route.id}`,
        path: `route:${route.id}`,
      });
    } else {
      routeIds.add(route.id);
    }

    // Path uniqueness (method + path)
    const key = `${route.method.toUpperCase()}:${normalizedPath}`;
    if (routePaths.has(key)) {
      issues.push({
        severity: "error",
        message: `Duplicate route path: ${route.method} ${normalizedPath}`,
        path: `route:${route.id}`,
      });
    } else {
      routePaths.add(key);
    }

    if (isReservedRoute(normalizedPath)) {
      issues.push({
        severity: "error",
        message: `Reserved route "${normalizedPath}" cannot be overridden`,
        path: `route:${route.id}`,
      });
    }

    const coreMatch = findCoreRouteMatch(normalizedPath);
    if (coreMatch) {
      issues.push({
        severity: "error",
        message: `Core route "${coreMatch.path}" is fixed to ${coreMatch.screenId}`,
        path: `route:${route.id}`,
      });
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
        path: `screen:${screen.id}`,
      });
    } else {
      screenIds.add(screen.id);
    }

    if (screen.route) {
      const normalizedRoute = normalizeRouteKey(screen.route);
      if (screenRoutes.has(normalizedRoute)) {
        issues.push({
          severity: "error",
          message: `Duplicate screen route: ${normalizedRoute}`,
          path: `screen:${screen.id}`,
        });
      } else {
        screenRoutes.add(normalizedRoute);
      }

      if (isReservedRoute(normalizedRoute)) {
        issues.push({
          severity: "error",
          message: `Reserved route "${normalizedRoute}" cannot be defined in manifest screens`,
          path: `screen:${screen.id}`,
        });
      }

      const matchedCore = findCoreRouteMatch(normalizedRoute);
      if (matchedCore && matchedCore.screenId !== screen.id) {
        issues.push({
          severity: "error",
          message: `Core route "${matchedCore.path}" is bound to ${matchedCore.screenId} and cannot be overridden by ${screen.id}`,
          path: `screen:${screen.id}`,
        });
      }

      const expectedPath = CORE_ROUTE_BY_ID[screen.id];
      if (expectedPath && normalizeRouteKey(expectedPath) !== normalizedRoute) {
        issues.push({
          severity: "error",
          message: `Core screen "${screen.id}" must remain at route "${expectedPath}"`,
          path: `screen:${screen.id}`,
        });
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
          path: `data:${name}`,
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
          path: `storage:${name}`,
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

const validateHandlerPresence = (
  manifest: AppManifest,
  registry: AppHandlerRegistry | null,
): AppManifestValidationIssue[] => {
  const issues: AppManifestValidationIssue[] = [];
  if (!registry) {
    issues.push({
      severity: "error",
      message: "App Script registry is not available",
      path: "handlers",
    });
    return issues;
  }
  const available = new Set(registry.list());
  for (const route of manifest.routes || []) {
    const handlerName = typeof (route as any)?.handler === "string" ? (route as any).handler.trim() : "";
    if (!handlerName) {
      issues.push({
        severity: "error",
        message: `Route ${route.id} is missing handler`,
        path: `route:${route.id}`,
      });
      continue;
    }
    if (!available.has(handlerName)) {
      issues.push({
        severity: "error",
        message: `Handler "${handlerName}" for route ${route.id} is not exported by app script`,
        path: `route:${route.id}`,
      });
    }
  }

  const apHandlers = manifest.ap?.handlers ?? [];
  for (const handler of apHandlers) {
    const handlerName = typeof (handler as any)?.handler === "string" ? (handler as any).handler.trim() : "";
    if (!handlerName) {
      issues.push({
        severity: "error",
        message: `AP handler ${handler.id} is missing handler`,
        path: `ap:${handler.id}`,
      });
      continue;
    }
    if (!available.has(handlerName)) {
      issues.push({
        severity: "error",
        message: `AP handler "${handlerName}" is not exported by app script`,
        path: `ap:${handler.id}`,
      });
    }
  }

  return issues;
};

const loadRegistryFromScriptRef = async (
  scriptRef: string | null | undefined,
  env: Bindings,
): Promise<{
  registry: AppHandlerRegistry | null;
  source?: string;
  code?: string;
  issues: AppManifestValidationIssue[];
}> => {
  const issues: AppManifestValidationIssue[] = [];
  if (!scriptRef || typeof scriptRef !== "string" || !scriptRef.trim()) {
    issues.push({
      severity: "error",
      message: "script snapshot ref is missing",
      path: "script_ref",
    });
    return { registry: null, issues };
  }
  try {
    const loaded = await loadAppRegistryFromScript({
      scriptRef,
      env,
    });
    if (loaded.code) {
      const allowedImportsRaw =
        typeof (env as any)?.TAKOS_APP_ALLOWED_IMPORTS === "string" ? (env as any).TAKOS_APP_ALLOWED_IMPORTS : "";
      const allowedImports = (allowedImportsRaw || "@takos/platform/app")
        .split(/[,\s]+/g)
        .map((v: string) => v.trim())
        .filter(Boolean);
      const inspection = inspectAppScriptCode(loaded.code, { allowedImports });
      const allowDangerous = isDevEnv(env as any) && boolFromEnv((env as any)?.ALLOW_DANGEROUS_APP_PATTERNS);
      if (!allowDangerous) {
        for (const issue of inspection) {
          issues.push({
            severity: "error",
            message: issue.message,
            path: "script_ref",
          });
        }
      }
    }
    return { registry: loaded.registry, source: loaded.source, code: loaded.code, issues };
  } catch (error) {
    console.error(
      `[manifest-routing] failed to load App Script from ref "${scriptRef}": ${(error as Error).message}`,
    );
    issues.push({
      severity: "error",
      message: `Failed to load App Script from ref "${scriptRef}": ${(error as Error).message}`,
      path: "script_ref",
    });
    return { registry: null, issues };
  }
};

const loadActiveRevisionSnapshot = async (
  env: Bindings,
): Promise<{ snapshot: ActiveRevisionSnapshot | null; issues: AppManifestValidationIssue[] }> => {
  let store: any = null;
  const issues: AppManifestValidationIssue[] = [];
  try {
    store = makeData(env as any);
  } catch (error) {
    console.error("[manifest-routing] failed to initialize data store", error);
    issues.push({
      severity: "error",
      message: "failed to initialize data store",
    });
    return { snapshot: null, issues };
  }

  try {
    if (!store?.getActiveAppRevision) {
      issues.push({
        severity: "error",
        message: "app revisions are not supported",
      });
      return { snapshot: null, issues };
    }
    const state = await store.getActiveAppRevision();
    const revision = state?.revision ?? null;
    if (!revision) {
      issues.push({
        severity: "error",
        message: "active app revision not found",
      });
      return { snapshot: null, issues };
    }
    const stateSchemaVersion = normalizeSchemaVersionValue(
      (state as any)?.schema_version ?? (state as any)?.schemaVersion ?? null,
    );
    const revisionSchemaVersion = normalizeSchemaVersionValue(
      (revision as any)?.schema_version ?? (revision as any)?.schemaVersion ?? null,
    );
    const stateCoreVersion =
      typeof (state as any)?.core_version === "string"
        ? (state as any).core_version
        : typeof (state as any)?.coreVersion === "string"
          ? (state as any).coreVersion
          : null;
    const revisionCoreVersion =
      typeof (revision as any)?.core_version === "string"
        ? (revision as any).core_version
        : typeof (revision as any)?.coreVersion === "string"
          ? (revision as any).coreVersion
          : null;

    if (stateSchemaVersion && revisionSchemaVersion && stateSchemaVersion !== revisionSchemaVersion) {
      issues.push({
        severity: "error",
        message: "app_state.schema_version does not match active app_revisions.schema_version",
      });
    }
    if (stateCoreVersion && revisionCoreVersion && stateCoreVersion !== revisionCoreVersion) {
      issues.push({
        severity: "error",
        message: "app_state.core_version does not match active app_revisions.core_version",
      });
    }

    const effectiveSchemaVersion = stateSchemaVersion ?? revisionSchemaVersion;
    if (effectiveSchemaVersion) {
      const schemaCheck = checkSemverCompatibility(
        APP_MANIFEST_SCHEMA_VERSION,
        effectiveSchemaVersion,
        { context: "app manifest schema_version", action: "load" },
      );
      if (!schemaCheck.ok) {
        issues.push({
          severity: "error",
          message:
            schemaCheck.error ||
            `app manifest schema_version ${effectiveSchemaVersion} is not compatible with runtime ${APP_MANIFEST_SCHEMA_VERSION}`,
        });
      } else if (schemaCheck.warnings?.length) {
        for (const warning of schemaCheck.warnings) {
          issues.push({ severity: "warning", message: warning });
        }
      }
    }

    const effectiveCoreVersion = stateCoreVersion ?? revisionCoreVersion;
    if (effectiveCoreVersion) {
      const coreCheck = checkSemverCompatibility(TAKOS_CORE_VERSION, effectiveCoreVersion, {
        context: "core_version",
        action: "load",
      });
      if (!coreCheck.ok) {
        issues.push({
          severity: "error",
          message:
            coreCheck.error ||
            `app revision core_version ${effectiveCoreVersion} is not compatible with runtime ${TAKOS_CORE_VERSION}`,
        });
      } else if (coreCheck.warnings?.length) {
        for (const warning of coreCheck.warnings) {
          issues.push({ severity: "warning", message: warning });
        }
      }
    }
    const manifestRef =
      (revision as any)?.manifest_snapshot_ref ??
      (revision as any)?.manifestSnapshotRef ??
      (state as any)?.manifest_snapshot_ref ??
      (state as any)?.manifestSnapshotRef ??
      null;
    const manifestSnapshot =
      revision?.manifest_snapshot ?? state?.manifest_snapshot ?? revision?.manifestSnapshot ?? null;

    let manifest: AppManifest | null = null;
    let source = "app_revisions";

    if (manifestRef) {
      const resolved = await loadManifestFromRef(manifestRef, env);
      issues.push(...resolved.issues);
      manifest = resolved.manifest;
      if (resolved.source) {
        source = resolved.source;
      }
    }

    if (!manifest) {
      const parsed = parseManifestSnapshot(manifestSnapshot);
      if (!parsed) {
        issues.push({
          severity: "error",
          message: "active app manifest snapshot is missing or invalid",
        });
        return { snapshot: null, issues };
      }
      manifest = normalizeManifestSnapshot(parsed);
    }

    const schemaVersion =
      normalizeSchemaVersionValue((manifest as any)?.schemaVersion ?? (manifest as any)?.schema_version) ??
      normalizeSchemaVersionValue((revision as any)?.schema_version ?? (revision as any)?.schemaVersion) ??
      stateSchemaVersion ??
      null;
    if (manifest && schemaVersion && !(manifest as any).schemaVersion) {
      (manifest as any).schemaVersion = schemaVersion;
    }

    const revisionId = revision?.id ?? state?.active_revision_id ?? "active";
    const scriptRef = revision?.script_snapshot_ref ?? (revision as any)?.scriptSnapshotRef ?? null;

    return {
      snapshot: {
        revisionId,
        manifest,
        scriptRef,
        source,
        schemaVersion: manifest.schemaVersion ?? schemaVersion,
      },
      issues,
    };
  } catch (error) {
    console.error("[manifest-routing] failed to load active app revision", error);
    issues.push({
      severity: "error",
      message: "failed to load active app revision",
    });
    return { snapshot: null, issues };
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

export const loadActiveAppManifest = async (
  env: Bindings,
  options?: { loadScript?: boolean; validateHandlers?: boolean },
): Promise<ManifestLoadResult> => {
  const loadScript = options?.loadScript ?? true;
  const validateHandlers = options?.validateHandlers ?? true;

  const resolver = customManifestResolver ?? loadActiveRevisionSnapshot;
  const { snapshot, issues: baseIssues } = await resolver(env);
  const issues: AppManifestValidationIssue[] = [...baseIssues];

  if (!snapshot) {
    return { ok: false, issues, snapshot: null, registry: null };
  }

  const manifestValidation = validateAppManifest(snapshot.manifest);
  issues.push(...manifestValidation.issues);
  issues.push(...validateSchemaVersion(snapshot.manifest));
  issues.push(...builtinUiContract.issues);
  issues.push(
    ...validateUiContractAgainstManifest(
      snapshot.manifest,
      builtinUiContract.contract,
      "schemas/ui-contract.json",
    ),
  );

  let registry: AppHandlerRegistry | null = null;
  if (loadScript) {
    const registryResult = await loadRegistryFromScriptRef(snapshot.scriptRef, env);
    issues.push(...registryResult.issues);
    registry = registryResult.registry;
    if (registryResult.source) {
      snapshot.scriptSource = registryResult.source;
    }
    if (registryResult.code) {
      snapshot.scriptCode = registryResult.code;
    }
    if (!snapshot.scriptCode) {
      issues.push({
        severity: "error",
        message: "script snapshot must be loadable as source code when using Worker Loader execution",
        path: "script_ref",
      });
    }
    if (!(env as any)?.LOADER) {
      issues.push({
        severity: "error",
        message: "Worker Loader (LOADER) binding is not configured",
        path: "env.LOADER",
      });
    }
    if (!(env as any)?.TAKOS_CORE) {
      issues.push({
        severity: "error",
        message: "TAKOS_CORE service binding is not configured",
        path: "env.TAKOS_CORE",
      });
    }
    if (!(env as any)?.TAKOS_APP_RPC_TOKEN) {
      issues.push({
        severity: "error",
        message: "TAKOS_APP_RPC_TOKEN is not configured",
        path: "env.TAKOS_APP_RPC_TOKEN",
      });
    }
  } else if (!snapshot.scriptRef) {
    issues.push({
      severity: "error",
      message: "script snapshot ref is missing",
      path: "script_ref",
    });
  }

  if (validateHandlers) {
    issues.push(...validateHandlerPresence(snapshot.manifest, registry));
  }

  const ok = !hasValidationErrors(issues);

  return {
    ok,
    issues,
    snapshot,
    registry,
  };
};

export const createManifestRouter = (options: {
  manifest: AppManifest;
  registry: AppHandlerRegistry;
  authMiddleware?: MiddlewareHandler;
  basePath?: string;
  revisionId: string;
  source: string;
  scriptRef?: string | null;
  scriptSource?: string;
  scriptCode?: string;
  validationIssues?: AppManifestValidationIssue[];
}): ManifestRouterInstance => {
  if (!options.scriptCode || typeof options.scriptCode !== "string" || !options.scriptCode.trim()) {
    throw new Error("createManifestRouter requires scriptCode when using Worker Loader execution");
  }
  const resolveHandler = (name: string) => {
    if (!options.registry.get(name)) return undefined;
    const honoHandler: ManifestRouteHandler = async (c: any) => {
      const input = await normalizeInput(c);
      const auth = toAppAuthContext(c);

      if (!(c.env as any)?.LOADER) {
        throw new HttpError(503, ErrorCodes.SERVICE_UNAVAILABLE, "Worker Loader (LOADER) is not configured");
      }
      if (!(c.env as any)?.TAKOS_CORE) {
        throw new HttpError(503, ErrorCodes.SERVICE_UNAVAILABLE, "TAKOS_CORE service binding is not configured");
      }
      if (!(c.env as any)?.TAKOS_APP_RPC_TOKEN) {
        throw new HttpError(503, ErrorCodes.SERVICE_UNAVAILABLE, "TAKOS_APP_RPC_TOKEN is not configured");
      }

      const runner = await createIsolatedAppRunner({
        env: c.env as any,
        scriptCode: options.scriptCode as string,
      });
      const invoked = await runner.invoke(name, input, { mode: "prod", auth, runId: undefined });
      for (const entry of invoked.logs ?? []) {
        console.log("[app]", entry);
      }
      if (!invoked.ok) {
        const message = invoked.error?.message ?? "App handler failed";
        if (invoked.error?.code === ErrorCodes.SANDBOX_TIMEOUT || invoked.error?.code === "SANDBOX_TIMEOUT") {
          throw new HttpError(408, ErrorCodes.SANDBOX_TIMEOUT, message, { handler: name });
        }
        throw new HttpError(500, ErrorCodes.HANDLER_EXECUTION_ERROR, message, { handler: name });
      }
      return toResponse(invoked.response as AppResponse);
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
    validationIssues: options.validationIssues ?? [],
    revisionId: options.revisionId,
    scriptRef: options.scriptRef,
    scriptSource: options.scriptSource ?? options.source,
    matchers,
    manifest: options.manifest,
    source: options.source,
  };
};

let cachedRouter: ManifestRouterInstance | null = null;
let buildPromise: Promise<ManifestRouterInstance | null> | null = null;
let buildTarget: { revisionId: string; scriptRef?: string | null } | null = null;

export const clearManifestRouterCache = (): void => {
  cachedRouter = null;
  buildPromise = null;
  buildTarget = null;
};

export const resolveManifestRouter = async (
  env: Bindings,
  authMiddleware: MiddlewareHandler,
): Promise<ManifestRouterInstance | null> => {
  const loaded = await loadActiveAppManifest(env, {
    loadScript: true,
    validateHandlers: true,
  });
  const active = loaded.snapshot;
  if (!active || !loaded.registry) {
    cachedRouter = null;
    return null;
  }

  if (hasValidationErrors(loaded.issues)) {
    console.error(
      `[manifest-routing] manifest validation failed for revision ${active.revisionId}`,
      loaded.issues,
    );
    cachedRouter = null;
    return null;
  }

  if (
    cachedRouter &&
    cachedRouter.revisionId === active.revisionId &&
    cachedRouter.scriptRef === active.scriptRef
  ) {
    return cachedRouter;
  }

  if (buildPromise) {
    if (buildTarget?.revisionId === active.revisionId && buildTarget.scriptRef === active.scriptRef) {
      const pending = await buildPromise;
      buildPromise = null;
      buildTarget = null;
      if (pending) cachedRouter = pending;
      return pending;
    }
    await buildPromise.catch(() => null);
    buildPromise = null;
    buildTarget = null;
  }

  buildTarget = { revisionId: active.revisionId, scriptRef: active.scriptRef };
  buildPromise = Promise.resolve(
    createManifestRouter({
      manifest: active.manifest,
      registry: loaded.registry,
      authMiddleware,
      revisionId: active.revisionId,
      source: active.source,
      scriptRef: active.scriptRef,
      scriptSource: active.scriptSource,
      scriptCode: active.scriptCode,
      validationIssues: loaded.issues,
    }),
  );
  const built = await buildPromise;
  buildPromise = null;
  buildTarget = null;
  if (built) {
    cachedRouter = built;
    if (built.issues.length || built.validationIssues.length) {
      console.warn(
        `[manifest-routing] mounted revision ${active.revisionId} with ${built.issues.length} route issue(s) and ${built.validationIssues.length} validation issue(s)`,
      );
    }
  }
  return built;
};

export const matchesManifestRoute = (
  router: ManifestRouterInstance | null,
  method: string,
  pathname: string,
): boolean => {
  if (!router) return false;
  const normalizedPath = normalizeRouteKey(pathname);
  if (isReservedRoute(normalizedPath)) return false;
  if (findCoreRouteMatch(normalizedPath)) return false;
  const normalizedMethod = (method || "").toUpperCase();
  return router.matchers.some(
    (matcher) => matcher.method === normalizedMethod && matcher.test(normalizedPath),
  );
};
