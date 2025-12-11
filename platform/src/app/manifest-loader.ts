import {
  AppApHandlerDefinition,
  AppBucketDefinition,
  AppCollectionDefinition,
  AppDefinitionSource,
  AppManifest,
  AppManifestLayout,
  AppManifestLoadResult,
  AppManifestValidationIssue,
  AppRouteDefinition,
  AppScreenDefinition,
  AppViewInsertDefinition,
  DEFAULT_APP_LAYOUT,
  APP_MANIFEST_FILENAME,
  HttpMethod,
  LoadAppManifestOptions,
} from "./types";
import { APP_MANIFEST_SCHEMA_VERSION } from "./manifest.js";
import { checkSemverCompatibility } from "../utils/semver.js";

type Sourced<T> = {
  value: T;
  source?: string;
  path?: string;
};

interface AggregatedEntries {
  routes: Sourced<AppRouteDefinition>[];
  screens: Sourced<AppScreenDefinition>[];
  inserts: Sourced<AppViewInsertDefinition>[];
  apHandlers: Sourced<AppApHandlerDefinition>[];
  collections: Map<string, Sourced<AppCollectionDefinition>>;
  buckets: Map<string, Sourced<AppBucketDefinition>>;
}

const ROUTE_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const RESERVED_VIEW_ROUTES = ["/login", "/-/health"];
const RESERVED_VIEW_PREFIXES = ["/auth", "/-/core", "/-/config", "/-/app", "/.well-known"];

const normalizeRoute = (path: string): string => {
  const trimmed = path.trim();
  if (!trimmed) return "";
  if (!trimmed.startsWith("/")) return `/${trimmed}`;
  return trimmed.replace(/\/+$/, "") || "/";
};

const CORE_SCREEN_ROUTES: Record<string, string> = {
  "screen.home": "/",
  "screen.onboarding": "/onboarding",
  "screen.profile": "/profile",
  "screen.profile_edit": "/profile/edit",
  "screen.settings": "/settings",
  "screen.notifications": "/notifications",
  "screen.user_profile": "/@:handle",
};
const CORE_ROUTE_BY_PATH: Record<string, string> = Object.fromEntries(
  Object.entries(CORE_SCREEN_ROUTES).map(([id, path]) => [normalizeRoute(path), id]),
);

const isReservedViewRoute = (route: string): boolean => {
  const normalized = normalizeRoute(route);
  if (!normalized) return false;
  if (RESERVED_VIEW_ROUTES.includes(normalized)) return true;
  return RESERVED_VIEW_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
};

const validateFragmentSchemaVersion = (
  raw: Record<string, unknown>,
  file: string,
  label: string,
): AppManifestValidationIssue[] => {
  const issues: AppManifestValidationIssue[] = [];
  const versionRaw = (raw as any).schema_version ?? (raw as any).schemaVersion;
  if (typeof versionRaw !== "string" || !versionRaw.trim()) {
    issues.push({
      severity: "error",
      message: `Missing or invalid "schema_version" in ${label} fragment`,
      file,
      path: "schema_version",
    });
    return issues;
  }

  const compatibility = checkSemverCompatibility(
    APP_MANIFEST_SCHEMA_VERSION,
    versionRaw.trim(),
    { context: `${label} fragment schema_version`, action: "validate" },
  );
  if (!compatibility.ok) {
    issues.push({
      severity: "error",
      message: compatibility.error || `${label} fragment schema_version is not compatible`,
      file,
      path: "schema_version",
    });
  }
  issues.push(
    ...compatibility.warnings.map((message): AppManifestValidationIssue => ({
      severity: "warning",
      message,
      file,
      path: "schema_version",
    })),
  );

  return issues;
};

export async function loadAppManifest(options: LoadAppManifestOptions): Promise<AppManifestLoadResult> {
  const rootDir = options.rootDir ?? ".";
  const issues: AppManifestValidationIssue[] = [];
  const source = options.source;
  const handlers = options.availableHandlers ? new Set(options.availableHandlers) : null;

  const rootPath = joinPath(rootDir, APP_MANIFEST_FILENAME);
  const rawRoot = await readFileSafe(source, rootPath, issues);
  if (!rawRoot) {
    return { issues };
  }

  const parsedRoot = parseJson(rawRoot, rootPath, issues);
  if (!isPlainObject(parsedRoot)) {
    issues.push({
      severity: "error",
      message: `${APP_MANIFEST_FILENAME} must be a JSON object`,
      file: rootPath,
    });
    return { issues };
  }

  const rootValidation = validateRootManifest(parsedRoot, rootPath);
  issues.push(...rootValidation.issues);

  if (rootValidation.schemaVersion) {
    const compatibility = checkSemverCompatibility(
      APP_MANIFEST_SCHEMA_VERSION,
      rootValidation.schemaVersion,
      { context: "app manifest schema_version", action: "validate" },
    );
    if (!compatibility.ok) {
      issues.push({
        severity: "error",
        message: compatibility.error || "App manifest schema_version is not compatible",
        file: rootPath,
        path: "schema_version",
      });
    }
    issues.push(
      ...compatibility.warnings.map((message): AppManifestValidationIssue => ({
        severity: "warning",
        message,
        file: rootPath,
        path: "schema_version",
      })),
    );
  }

  const layout = rootValidation.layout;
  const aggregated: AggregatedEntries = {
    routes: [],
    screens: [],
    inserts: [],
    apHandlers: [],
    collections: new Map(),
    buckets: new Map(),
  };

  await loadFragmentsForSection({
    dir: joinPath(rootDir, layout.baseDir, layout.routesDir),
    source,
    issues,
    handler: (raw, file) => validateRoutesFragment(raw, file),
    onValid: (result) => aggregated.routes.push(...result),
  });

  await loadFragmentsForSection({
    dir: joinPath(rootDir, layout.baseDir, layout.viewsDir),
    source,
    issues,
    handler: (raw, file) => validateViewsFragment(raw, file),
    onValid: (result) => {
      aggregated.screens.push(...result.screens);
      aggregated.inserts.push(...result.inserts);
    },
  });

  await loadFragmentsForSection({
    dir: joinPath(rootDir, layout.baseDir, layout.apDir),
    source,
    issues,
    handler: (raw, file) => validateApFragment(raw, file),
    onValid: (result) => aggregated.apHandlers.push(...result),
  });

  await loadFragmentsForSection({
    dir: joinPath(rootDir, layout.baseDir, layout.dataDir),
    source,
    issues,
    handler: (raw, file) => validateDataFragment(raw, file),
    onValid: (result) => {
      for (const [key, value] of result.entries()) {
        if (aggregated.collections.has(key)) {
          issues.push({
            severity: "error",
            message: `Duplicate collection id "${key}" across fragments`,
            file: value.source,
          });
          continue;
        }
        aggregated.collections.set(key, value);
      }
    },
  });

  await loadFragmentsForSection({
    dir: joinPath(rootDir, layout.baseDir, layout.storageDir),
    source,
    issues,
    handler: (raw, file) => validateStorageFragment(raw, file),
    onValid: (result) => {
      for (const [key, value] of result.entries()) {
        if (aggregated.buckets.has(key)) {
          issues.push({
            severity: "error",
            message: `Duplicate bucket id "${key}" across fragments`,
            file: value.source,
          });
          continue;
        }
        aggregated.buckets.set(key, value);
      }
    },
  });

  const manifest: AppManifest = {
    schemaVersion: rootValidation.schemaVersion ?? "",
    version: rootValidation.version,
    routes: aggregated.routes.map((entry) => entry.value),
    views: {
      screens: aggregated.screens.map((entry) => entry.value),
      insert: aggregated.inserts.map((entry) => entry.value),
    },
    ap: { handlers: aggregated.apHandlers.map((entry) => entry.value) },
    data: {
      collections: Object.fromEntries(
        Array.from(aggregated.collections.entries()).map(([key, value]) => [key, value.value]),
      ),
    },
    storage: {
      buckets: Object.fromEntries(
        Array.from(aggregated.buckets.entries()).map(([key, value]) => [key, value.value]),
      ),
    },
  };

  issues.push(...validateMergedManifest(aggregated, handlers));

  if (hasErrors(issues)) {
    return { layout, issues };
  }

  return { manifest, layout, issues };
}

export function createInMemoryAppSource(files: Record<string, string>): AppDefinitionSource {
  const normalized = new Map<string, string>();
  for (const [rawPath, content] of Object.entries(files)) {
    normalized.set(normalizePath(rawPath), content);
  }

  return {
    async readFile(path: string): Promise<string> {
      const normalizedPath = normalizePath(path);
      const value = normalized.get(normalizedPath);
      if (value === undefined) {
        throw new Error(`File not found: ${path}`);
      }
      return value;
    },
    async listFiles(dir: string): Promise<string[]> {
      const normalizedDir = normalizePath(dir);
      const prefix = normalizedDir === "." ? "" : normalizedDir.replace(/\/+$/, "") + "/";
      const entries = new Set<string>();
      for (const path of normalized.keys()) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        if (!rest || rest.includes("/")) continue;
        entries.add(rest);
      }
      return Array.from(entries);
    },
  };
}

function hasErrors(all: AppManifestValidationIssue[]): boolean {
  return all.some((issue) => issue.severity === "error");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(raw: string, file: string, issues: AppManifestValidationIssue[]): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    issues.push({
      severity: "error",
      message: `Invalid JSON: ${(error as Error).message}`,
      file,
    });
    return null;
  }
}

function joinPath(...parts: string[]): string {
  const cleaned: string[] = [];
  parts.forEach((part, index) => {
    if (!part) return;
    const normalized = part.replace(/\\/g, "/");
    const segment =
      index === 0 ? normalized.replace(/\/+$/, "") : normalized.replace(/^\/+/, "").replace(/\/+$/, "");
    if (segment && segment !== ".") {
      cleaned.push(segment);
    }
  });
  if (cleaned.length === 0) {
    return ".";
  }
  const first = cleaned[0];
  if (first.startsWith("/")) {
    return `/${cleaned.join("/")}`.replace(/^\/\/+/, "/");
  }
  return cleaned.join("/");
}

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (normalized === "." || normalized === "") return ".";
  return normalized.replace(/^\.\//, "").replace(/\/+$/, "");
}

async function readFileSafe(
  source: AppDefinitionSource,
  path: string,
  issues: AppManifestValidationIssue[],
): Promise<string | null> {
  try {
    return await source.readFile(path);
  } catch (error) {
    issues.push({
      severity: "error",
      message: `Unable to read file: ${(error as Error).message}`,
      file: path,
    });
    return null;
  }
}

function validateRootManifest(
  raw: Record<string, unknown>,
  file: string,
): { schemaVersion?: string; version?: string; layout: AppManifestLayout; issues: AppManifestValidationIssue[] } {
  const issues: AppManifestValidationIssue[] = [];
  const allowedKeys = new Set(["schema_version", "version", "layout"]);
  for (const key of Object.keys(raw)) {
    if (!allowedKeys.has(key)) {
      issues.push({
        severity: "error",
        message: `Unexpected key "${key}" in ${APP_MANIFEST_FILENAME}`,
        file,
      });
    }
  }

  let schemaVersion: string | undefined;
  if (typeof raw.schema_version === "string" && raw.schema_version.trim()) {
    schemaVersion = raw.schema_version;
  } else {
    issues.push({
      severity: "error",
      message: `Missing or invalid "schema_version" in ${APP_MANIFEST_FILENAME}`,
      file,
      path: "schema_version",
    });
  }

  let version: string | undefined;
  if (raw.version === undefined) {
    version = undefined;
  } else if (typeof raw.version === "string") {
    version = raw.version;
  } else {
    issues.push({
      severity: "error",
      message: '"version" must be a string if provided',
      file,
      path: "version",
    });
  }

  const layout = resolveLayout(raw.layout, file, issues);

  return { schemaVersion, version, layout, issues };
}

function resolveLayout(
  raw: unknown,
  file: string,
  issues: AppManifestValidationIssue[],
): AppManifestLayout {
  if (raw === undefined) {
    return DEFAULT_APP_LAYOUT;
  }

  if (!isPlainObject(raw)) {
    issues.push({
      severity: "error",
      message: '"layout" must be an object',
      file,
      path: "layout",
    });
    return DEFAULT_APP_LAYOUT;
  }

  const allowedKeys = new Set([
    "base_dir",
    "routes_dir",
    "views_dir",
    "ap_dir",
    "data_dir",
    "storage_dir",
    "baseDir",
    "routesDir",
    "viewsDir",
    "apDir",
    "dataDir",
    "storageDir",
  ]);
  for (const key of Object.keys(raw)) {
    if (!allowedKeys.has(key)) {
      issues.push({
        severity: "error",
        message: `Unexpected key "layout.${key}" in ${APP_MANIFEST_FILENAME}`,
        file,
        path: `layout.${key}`,
      });
    }
  }

  const pick = (keyA: string, keyB: string, fallback: string, pathKey: string): string => {
    const value = (raw as Record<string, unknown>)[keyA] ?? (raw as Record<string, unknown>)[keyB];
    if (value === undefined) return fallback;
    if (typeof value === "string" && value.trim()) return value;
    issues.push({
      severity: "error",
      message: `"${pathKey}" must be a non-empty string`,
      file,
      path: `layout.${pathKey}`,
    });
    return fallback;
  };

  return {
    baseDir: pick("base_dir", "baseDir", DEFAULT_APP_LAYOUT.baseDir, "base_dir"),
    routesDir: pick("routes_dir", "routesDir", DEFAULT_APP_LAYOUT.routesDir, "routes_dir"),
    viewsDir: pick("views_dir", "viewsDir", DEFAULT_APP_LAYOUT.viewsDir, "views_dir"),
    apDir: pick("ap_dir", "apDir", DEFAULT_APP_LAYOUT.apDir, "ap_dir"),
    dataDir: pick("data_dir", "dataDir", DEFAULT_APP_LAYOUT.dataDir, "data_dir"),
    storageDir: pick("storage_dir", "storageDir", DEFAULT_APP_LAYOUT.storageDir, "storage_dir"),
  };
}

async function loadFragmentsForSection<T>({
  dir,
  source,
  issues,
  handler,
  onValid,
}: {
  dir: string;
  source: AppDefinitionSource;
  issues: AppManifestValidationIssue[];
  handler: (raw: unknown, file: string) => { issues: AppManifestValidationIssue[]; result?: T };
  onValid: (result: T) => void;
}) {
  const files = await listJsonFiles(source, dir);
  if (files.length === 0) {
    return;
  }
  for (const fileName of files) {
    const fullPath = joinPath(dir, fileName);
    const raw = await readFileSafe(source, fullPath, issues);
    if (!raw) continue;
    const parsed = parseJson(raw, fullPath, issues);
    if (parsed === null) continue;
    const validation = handler(parsed, fullPath);
    issues.push(...validation.issues);
    if (validation.result !== undefined) {
      onValid(validation.result);
    }
  }
}

async function listJsonFiles(source: AppDefinitionSource, dir: string): Promise<string[]> {
  try {
    const entries = await source.listFiles(dir);
    return entries.filter((entry) => entry.toLowerCase().endsWith(".json")).sort();
  } catch {
    // Missing directories are treated as empty.
    return [];
  }
}

function validateRoutesFragment(
  raw: unknown,
  file: string,
): { issues: AppManifestValidationIssue[]; result?: Sourced<AppRouteDefinition>[] } {
  const issues: AppManifestValidationIssue[] = [];
  if (!isPlainObject(raw)) {
    issues.push({
      severity: "error",
      message: "Route fragment must be an object",
      file,
    });
    return { issues };
  }

  issues.push(...validateFragmentSchemaVersion(raw, file, "routes"));

  const allowedKeys = new Set(["schema_version", "routes"]);
  for (const key of Object.keys(raw)) {
    if (!allowedKeys.has(key)) {
      issues.push({
        severity: "error",
        message: `Unexpected key "${key}" in route fragment`,
        file,
      });
    }
  }

  if (!Array.isArray(raw.routes)) {
    issues.push({
      severity: "error",
      message: '"routes" must be an array',
      file,
      path: "routes",
    });
    return { issues };
  }

  const entries: Sourced<AppRouteDefinition>[] = [];
  raw.routes.forEach((routeRaw, index) => {
    const { route, routeIssues } = parseRouteEntry(routeRaw, file, index);
    issues.push(...routeIssues);
    if (route) {
      entries.push({ value: route, source: file, path: `routes[${index}]` });
    }
  });

  return { issues, result: entries };
}

function parseRouteEntry(
  raw: unknown,
  file: string,
  index: number,
): { route?: AppRouteDefinition; routeIssues: AppManifestValidationIssue[] } {
  const routeIssues: AppManifestValidationIssue[] = [];
  if (!isPlainObject(raw)) {
    routeIssues.push({
      severity: "error",
      message: "Route entry must be an object",
      file,
      path: `routes[${index}]`,
    });
    return { routeIssues };
  }

  const id = pickString(raw, "id");
  if (!id) {
    routeIssues.push({
      severity: "error",
      message: "Route id is required",
      file,
      path: `routes[${index}].id`,
    });
  }

  const methodRaw = pickString(raw, "method");
  const method = methodRaw ? (methodRaw.toUpperCase() as HttpMethod) : undefined;
  if (!method || !ROUTE_METHODS.includes(method)) {
    routeIssues.push({
      severity: "error",
      message: `Invalid route method${methodRaw ? ` "${methodRaw}"` : ""}`,
      file,
      path: `routes[${index}].method`,
    });
  }

  const path = pickString(raw, "path");
  if (!path || !path.startsWith("/")) {
    routeIssues.push({
      severity: "error",
      message: "Route path must start with '/'",
      file,
      path: `routes[${index}].path`,
    });
  }

  const handler = pickString(raw, "handler");
  if (!handler) {
    routeIssues.push({
      severity: "error",
      message: "Route handler is required",
      file,
      path: `routes[${index}].handler`,
    });
  }

  const auth = raw.auth;
  if (auth !== undefined && typeof auth !== "boolean") {
    routeIssues.push({
      severity: "error",
      message: '"auth" must be a boolean when provided',
      file,
      path: `routes[${index}].auth`,
    });
  }

  if (routeIssues.some((issue) => issue.severity === "error")) {
    if (!id || !method || !path || !handler) {
      return { routeIssues };
    }
  }

  const definition: AppRouteDefinition = {
    ...(raw as Record<string, unknown>),
    id: id ?? "",
    method: method ?? "GET",
    path: path ?? "",
    handler: handler ?? "",
  };
  if (auth !== undefined) {
    definition.auth = auth as boolean;
  }
  return { route: definition, routeIssues };
}

function validateViewsFragment(
  raw: unknown,
  file: string,
): {
  issues: AppManifestValidationIssue[];
  result?: { screens: Sourced<AppScreenDefinition>[]; inserts: Sourced<AppViewInsertDefinition>[] };
} {
  const issues: AppManifestValidationIssue[] = [];
  if (!isPlainObject(raw)) {
    issues.push({
      severity: "error",
      message: "View fragment must be an object",
      file,
    });
    return { issues };
  }

  issues.push(...validateFragmentSchemaVersion(raw, file, "views"));

  const allowedKeys = new Set(["schema_version", "screens", "insert"]);
  for (const key of Object.keys(raw)) {
    if (!allowedKeys.has(key)) {
      issues.push({
        severity: "error",
        message: `Unexpected key "${key}" in view fragment`,
        file,
      });
    }
  }

  const screens: Sourced<AppScreenDefinition>[] = [];
  const inserts: Sourced<AppViewInsertDefinition>[] = [];

  if (raw.screens !== undefined) {
    if (!Array.isArray(raw.screens)) {
      issues.push({
        severity: "error",
        message: '"screens" must be an array',
        file,
        path: "screens",
      });
    } else {
      raw.screens.forEach((screenRaw, index) => {
        const { screen, screenIssues } = normalizeScreen(screenRaw, file, index);
        issues.push(...screenIssues);
        if (screen) {
          screens.push({ value: screen, source: file, path: `screens[${index}]` });
        }
      });
    }
  }

  if (raw.insert !== undefined) {
    if (!Array.isArray(raw.insert)) {
      issues.push({
        severity: "error",
        message: '"insert" must be an array',
        file,
        path: "insert",
      });
    } else {
      raw.insert.forEach((insertRaw, index) => {
        const { insert, insertIssues } = normalizeInsert(insertRaw, file, index);
        issues.push(...insertIssues);
        if (insert) {
          inserts.push({ value: insert, source: file, path: `insert[${index}]` });
        }
      });
    }
  }

  if (screens.length === 0 && inserts.length === 0) {
    issues.push({
      severity: "error",
      message: 'View fragment must contain at least "screens" or "insert"',
      file,
    });
  }

  return { issues, result: { screens, inserts } };
}

function normalizeScreen(
  raw: unknown,
  file: string,
  index: number,
): { screen?: AppScreenDefinition; screenIssues: AppManifestValidationIssue[] } {
  const screenIssues: AppManifestValidationIssue[] = [];
  if (!isPlainObject(raw)) {
    screenIssues.push({
      severity: "error",
      message: "Screen entry must be an object",
      file,
      path: `screens[${index}]`,
    });
    return { screenIssues };
  }

  const id = pickString(raw, "id");
  if (!id) {
    screenIssues.push({
      severity: "error",
      message: "Screen id is required",
      file,
      path: `screens[${index}].id`,
    });
  }

  const route = raw.route;
  if (route !== undefined && (typeof route !== "string" || !route.startsWith("/"))) {
    screenIssues.push({
      severity: "error",
      message: 'Screen route must be a string starting with "/"',
      file,
      path: `screens[${index}].route`,
    });
  }

  const title = raw.title;
  if (title !== undefined && typeof title !== "string") {
    screenIssues.push({
      severity: "error",
      message: '"title" must be a string when provided',
      file,
      path: `screens[${index}].title`,
    });
  }

  if (!isPlainObject(raw.layout)) {
    screenIssues.push({
      severity: "error",
      message: '"layout" must be an object',
      file,
      path: `screens[${index}].layout`,
    });
  }

  if (screenIssues.some((issue) => issue.severity === "error")) {
    if (!id || !isPlainObject(raw.layout)) {
      return { screenIssues };
    }
  }

  const screen: AppScreenDefinition = {
    ...(raw as Record<string, unknown>),
    id: id ?? "",
    layout: (raw.layout as Record<string, unknown>) ?? {},
  };
  if (route !== undefined) {
    screen.route = route as string;
  }
  if (title !== undefined) {
    screen.title = title as string;
  }
  return { screen, screenIssues };
}

function normalizeInsert(
  raw: unknown,
  file: string,
  index: number,
): { insert?: AppViewInsertDefinition; insertIssues: AppManifestValidationIssue[] } {
  const insertIssues: AppManifestValidationIssue[] = [];
  if (!isPlainObject(raw)) {
    insertIssues.push({
      severity: "error",
      message: "Insert entry must be an object",
      file,
      path: `insert[${index}]`,
    });
    return { insertIssues };
  }

  const screen = pickString(raw, "screen");
  if (!screen) {
    insertIssues.push({
      severity: "error",
      message: "Insert target screen is required",
      file,
      path: `insert[${index}].screen`,
    });
  }

  const position = pickString(raw, "position");
  if (!position) {
    insertIssues.push({
      severity: "error",
      message: "Insert position is required",
      file,
      path: `insert[${index}].position`,
    });
  }

  const order = raw.order;
  if (order !== undefined && !Number.isInteger(order)) {
    insertIssues.push({
      severity: "error",
      message: '"order" must be an integer when provided',
      file,
      path: `insert[${index}].order`,
    });
  }

  if (!isPlainObject(raw.node)) {
    insertIssues.push({
      severity: "error",
      message: '"node" must be an object',
      file,
      path: `insert[${index}].node`,
    });
  }

  if (insertIssues.some((issue) => issue.severity === "error")) {
    if (!screen || !position || !isPlainObject(raw.node)) {
      return { insertIssues };
    }
  }

  const insert: AppViewInsertDefinition = {
    ...(raw as Record<string, unknown>),
    screen: screen ?? "",
    position: position ?? "",
    node: (raw.node as Record<string, unknown>) ?? {},
  };
  if (order !== undefined) {
    insert.order = order as number;
  }

  return { insert, insertIssues };
}

function validateApFragment(
  raw: unknown,
  file: string,
): { issues: AppManifestValidationIssue[]; result?: Sourced<AppApHandlerDefinition>[] } {
  const issues: AppManifestValidationIssue[] = [];
  if (!isPlainObject(raw)) {
    issues.push({
      severity: "error",
      message: "ActivityPub fragment must be an object",
      file,
    });
    return { issues };
  }

  const allowedKeys = new Set(["handlers"]);
  for (const key of Object.keys(raw)) {
    if (!allowedKeys.has(key)) {
      issues.push({
        severity: "error",
        message: `Unexpected key "${key}" in ap fragment`,
        file,
      });
    }
  }

  if (!Array.isArray(raw.handlers)) {
    issues.push({
      severity: "error",
      message: '"handlers" must be an array',
      file,
      path: "handlers",
    });
    return { issues };
  }

  const handlers: Sourced<AppApHandlerDefinition>[] = [];
  raw.handlers.forEach((handlerRaw, index) => {
    const { handler, handlerIssues } = normalizeApHandler(handlerRaw, file, index);
    issues.push(...handlerIssues);
    if (handler) {
      handlers.push({ value: handler, source: file, path: `handlers[${index}]` });
    }
  });

  return { issues, result: handlers };
}

function normalizeApHandler(
  raw: unknown,
  file: string,
  index: number,
): { handler?: AppApHandlerDefinition; handlerIssues: AppManifestValidationIssue[] } {
  const handlerIssues: AppManifestValidationIssue[] = [];
  if (!isPlainObject(raw)) {
    handlerIssues.push({
      severity: "error",
      message: "Handler entry must be an object",
      file,
      path: `handlers[${index}]`,
    });
    return { handlerIssues };
  }

  const id = pickString(raw, "id");
  if (!id) {
    handlerIssues.push({
      severity: "error",
      message: "Handler id is required",
      file,
      path: `handlers[${index}].id`,
    });
  }

  const handlerName = pickString(raw, "handler");
  if (!handlerName) {
    handlerIssues.push({
      severity: "error",
      message: "Handler name is required",
      file,
      path: `handlers[${index}].handler`,
    });
  }

  const match = raw.match;
  if (match !== undefined && !isPlainObject(match)) {
    handlerIssues.push({
      severity: "error",
      message: '"match" must be an object when provided',
      file,
      path: `handlers[${index}].match`,
    });
  }

  if (handlerIssues.some((issue) => issue.severity === "error")) {
    if (!id || !handlerName) {
      return { handlerIssues };
    }
  }

  const handler: AppApHandlerDefinition = {
    ...(raw as Record<string, unknown>),
    id: id ?? "",
    handler: handlerName ?? "",
  };
  if (match !== undefined) {
    handler.match = match as Record<string, unknown>;
  }
  return { handler, handlerIssues };
}

function validateDataFragment(
  raw: unknown,
  file: string,
): { issues: AppManifestValidationIssue[]; result?: Map<string, Sourced<AppCollectionDefinition>> } {
  const issues: AppManifestValidationIssue[] = [];
  if (!isPlainObject(raw)) {
    issues.push({
      severity: "error",
      message: "Data fragment must be an object",
      file,
    });
    return { issues };
  }

  const allowedKeys = new Set(["collections"]);
  for (const key of Object.keys(raw)) {
    if (!allowedKeys.has(key)) {
      issues.push({
        severity: "error",
        message: `Unexpected key "${key}" in data fragment`,
        file,
      });
    }
  }

  if (!isPlainObject(raw.collections)) {
    issues.push({
      severity: "error",
      message: '"collections" must be an object',
      file,
      path: "collections",
    });
    return { issues };
  }

  const collections = new Map<string, Sourced<AppCollectionDefinition>>();
  for (const [key, value] of Object.entries(raw.collections)) {
    if (!value || Array.isArray(value) || typeof value !== "object") {
      issues.push({
        severity: "error",
        message: `Collection "${key}" must be an object`,
        file,
        path: `collections.${key}`,
      });
      continue;
    }
    collections.set(key, { value: value as AppCollectionDefinition, source: file, path: `collections.${key}` });
  }

  return { issues, result: collections };
}

function validateStorageFragment(
  raw: unknown,
  file: string,
): { issues: AppManifestValidationIssue[]; result?: Map<string, Sourced<AppBucketDefinition>> } {
  const issues: AppManifestValidationIssue[] = [];
  if (!isPlainObject(raw)) {
    issues.push({
      severity: "error",
      message: "Storage fragment must be an object",
      file,
    });
    return { issues };
  }

  const allowedKeys = new Set(["buckets"]);
  for (const key of Object.keys(raw)) {
    if (!allowedKeys.has(key)) {
      issues.push({
        severity: "error",
        message: `Unexpected key "${key}" in storage fragment`,
        file,
      });
    }
  }

  if (!isPlainObject(raw.buckets)) {
    issues.push({
      severity: "error",
      message: '"buckets" must be an object',
      file,
      path: "buckets",
    });
    return { issues };
  }

  const buckets = new Map<string, Sourced<AppBucketDefinition>>();
  for (const [key, value] of Object.entries(raw.buckets)) {
    if (!value || Array.isArray(value) || typeof value !== "object") {
      issues.push({
        severity: "error",
        message: `Bucket "${key}" must be an object`,
        file,
        path: `buckets.${key}`,
      });
      continue;
    }
    buckets.set(key, { value: value as AppBucketDefinition, source: file, path: `buckets.${key}` });
  }

  return { issues, result: buckets };
}

function validateMergedManifest(
  aggregated: AggregatedEntries,
  availableHandlers: Set<string> | null,
): AppManifestValidationIssue[] {
  const issues: AppManifestValidationIssue[] = [];

  const routeIds = new Map<string, Sourced<AppRouteDefinition>>();
  const routeKeys = new Map<string, Sourced<AppRouteDefinition>>();
  for (const entry of aggregated.routes) {
    const id = entry.value.id;
    if (routeIds.has(id)) {
      const first = routeIds.get(id);
      issues.push({
        severity: "error",
        message: `Duplicate route id "${id}"`,
        file: entry.source,
        path: entry.path,
      });
      if (first?.source && first.path) {
        issues.push({
          severity: "error",
          message: `Previously declared here`,
          file: first.source,
          path: first.path,
        });
      }
    } else {
      routeIds.set(id, entry);
    }

    const key = `${entry.value.method} ${entry.value.path}`;
    if (routeKeys.has(key)) {
      const first = routeKeys.get(key);
      issues.push({
        severity: "error",
        message: `Duplicate route path for method "${entry.value.method}" and path "${entry.value.path}"`,
        file: entry.source,
        path: entry.path,
      });
      if (first?.source && first.path) {
        issues.push({
          severity: "error",
          message: `Previously declared here`,
          file: first.source,
          path: first.path,
        });
      }
    } else {
      routeKeys.set(key, entry);
    }

    if (isReservedViewRoute(entry.value.path)) {
      issues.push({
        severity: "error",
        message: `Reserved route "${entry.value.path}" cannot be defined in app routes`,
        file: entry.source,
        path: entry.path ? `${entry.path}.path` : undefined,
      });
    }

    const normalizedRoute = normalizeRoute(entry.value.path);
    const coreRouteOwner = CORE_ROUTE_BY_PATH[normalizedRoute];
    if (coreRouteOwner) {
      issues.push({
        severity: "error",
        message: `Core route "${normalizedRoute}" is fixed to ${coreRouteOwner}`,
        file: entry.source,
        path: entry.path ? `${entry.path}.path` : undefined,
      });
    }

    if (availableHandlers && !availableHandlers.has(entry.value.handler)) {
      issues.push({
        severity: "error",
        message: `Handler "${entry.value.handler}" not found in App Script`,
        file: entry.source,
        path: entry.path ? `${entry.path}.handler` : undefined,
      });
    }
  }

  const screenIds = new Map<string, Sourced<AppScreenDefinition>>();
  const screenRoutes = new Map<string, Sourced<AppScreenDefinition>>();
  for (const entry of aggregated.screens) {
    const id = entry.value.id;
    if (screenIds.has(id)) {
      const first = screenIds.get(id);
      issues.push({
        severity: "error",
        message: `Duplicate screen id "${id}"`,
        file: entry.source,
        path: entry.path,
      });
      if (first?.source && first.path) {
        issues.push({
          severity: "error",
          message: `Previously declared here`,
          file: first.source,
          path: first.path,
        });
      }
    } else {
      screenIds.set(id, entry);
    }

    if (entry.value.route) {
      if (screenRoutes.has(entry.value.route)) {
        const first = screenRoutes.get(entry.value.route);
        issues.push({
          severity: "error",
          message: `Duplicate screen route "${entry.value.route}"`,
          file: entry.source,
          path: entry.path,
        });
        if (first?.source && first.path) {
          issues.push({
            severity: "error",
            message: `Previously declared here`,
            file: first.source,
            path: first.path,
          });
        }
      } else {
        screenRoutes.set(entry.value.route, entry);
      }

      if (isReservedViewRoute(entry.value.route)) {
        issues.push({
          severity: "error",
          message: `Reserved route "${entry.value.route}" cannot be defined in app views`,
          file: entry.source,
          path: entry.path ? `${entry.path}.route` : undefined,
        });
      }

      const expectedRoute = CORE_SCREEN_ROUTES[entry.value.id];
      if (expectedRoute && normalizeRoute(entry.value.route) !== normalizeRoute(expectedRoute)) {
        issues.push({
          severity: "error",
          message: `Core screen "${entry.value.id}" must use route "${expectedRoute}"`,
          file: entry.source,
          path: entry.path ? `${entry.path}.route` : undefined,
        });
      }
    }
  }

  for (const entry of aggregated.inserts) {
    if (!screenIds.has(entry.value.screen)) {
      issues.push({
        severity: "error",
        message: `Insert references unknown screen "${entry.value.screen}"`,
        file: entry.source,
        path: entry.path,
      });
    }
  }

  const apHandlers = new Map<string, Sourced<AppApHandlerDefinition>>();
  for (const entry of aggregated.apHandlers) {
    const id = entry.value.id;
    if (apHandlers.has(id)) {
      const first = apHandlers.get(id);
      issues.push({
        severity: "error",
        message: `Duplicate ActivityPub handler id "${id}"`,
        file: entry.source,
        path: entry.path,
      });
      if (first?.source && first.path) {
        issues.push({
          severity: "error",
          message: `Previously declared here`,
          file: first.source,
          path: first.path,
        });
      }
    } else {
      apHandlers.set(id, entry);
    }

    if (availableHandlers && !availableHandlers.has(entry.value.handler)) {
      issues.push({
        severity: "error",
        message: `Handler "${entry.value.handler}" not found in App Script`,
        file: entry.source,
        path: entry.path ? `${entry.path}.handler` : undefined,
      });
    }
  }

  const collectionKeys = new Set<string>();
  for (const [key, entry] of aggregated.collections.entries()) {
    if (collectionKeys.has(key)) {
      issues.push({
        severity: "error",
        message: `Duplicate collection id "${key}"`,
        file: entry.source,
        path: entry.path,
      });
    } else {
      collectionKeys.add(key);
    }
  }

  const bucketKeys = new Set<string>();
  for (const [key, entry] of aggregated.buckets.entries()) {
    if (bucketKeys.has(key)) {
      issues.push({
        severity: "error",
        message: `Duplicate bucket id "${key}"`,
        file: entry.source,
        path: entry.path,
      });
    } else {
      bucketKeys.add(key);
    }
  }

  return issues;
}

function pickString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  return undefined;
}
