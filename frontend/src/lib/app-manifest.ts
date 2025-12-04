/**
 * App Manifest Loader
 *
 * Fetches and manages the logical App Manifest from the backend
 * (PLAN.md 5.4.2: takos-app.json + app/ directory JSON files merge)
 */

export interface AppManifestRoute {
  id: string;
  method: string;
  path: string;
  auth: boolean;
  handler: string;
}

export interface AppManifestScreen {
  id: string;
  route: string;
  title: string;
  layout: any; // UiNode
  state?: Record<string, { default: any }>;
}

export interface AppManifestInsert {
  screen: string;
  position: string;
  order: number;
  node: any; // UiNode
}

export interface AppManifest {
  schema_version: string;
  version: string;
  routes: AppManifestRoute[];
  views: {
    screens: AppManifestScreen[];
    insert: AppManifestInsert[];
  };
  ap?: {
    handlers: any[];
  };
  data?: {
    collections: Record<string, any>;
  };
  storage?: {
    buckets: Record<string, any>;
  };
}

/**
 * Validation Issues
 */
export interface ValidationIssue {
  level: "error" | "warning";
  message: string;
  location?: string;
}

export interface ManifestValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

/**
 * App Manifest Cache
 */
let cachedManifest: AppManifest | null = null;

/**
 * Load App Manifest from backend
 */
export async function loadAppManifest(): Promise<AppManifest> {
  if (cachedManifest) {
    return cachedManifest;
  }

  try {
    const response = await fetch("/-/app/manifest");
    if (!response.ok) {
      throw new Error(`Failed to load manifest: ${response.statusText}`);
    }

    const data = await response.json();

    // Backend returns { manifest, issues } format
    const manifest: AppManifest = data.manifest || data;

    // Normalize field names (backend uses camelCase, frontend expects snake_case for some fields)
    const normalizedManifest: AppManifest = {
      schema_version: manifest.schema_version || manifest.schemaVersion || "1.0",
      version: manifest.version || "0.0.0",
      routes: manifest.routes || [],
      views: manifest.views || { screens: [], insert: [] },
      ap: manifest.ap,
      data: manifest.data,
      storage: manifest.storage,
    };

    cachedManifest = normalizedManifest;
    return normalizedManifest;
  } catch (error) {
    console.error("[AppManifest] Failed to load manifest:", error);

    // Return minimal fallback manifest
    return {
      schema_version: "1.0",
      version: "0.0.0",
      routes: [],
      views: {
        screens: [],
        insert: [],
      },
    };
  }
}

/**
 * Reload manifest (invalidate cache)
 */
export function reloadAppManifest() {
  cachedManifest = null;
}

/**
 * Get screen by route pattern
 */
export function getScreenByRoute(manifest: AppManifest, route: string): AppManifestScreen | undefined {
  // Exact match
  const exact = manifest.views.screens.find((s) => s.route === route);
  if (exact) return exact;

  // Pattern match (e.g., /communities/:id)
  return manifest.views.screens.find((s) => {
    const pattern = s.route.replace(/:\w+/g, "[^/]+");
    const regex = new RegExp(`^${pattern}$`);
    return regex.test(route);
  });
}

/**
 * Extract route params from pattern
 */
export function extractRouteParams(pattern: string, route: string): Record<string, string> {
  const patternParts = pattern.split("/");
  const routeParts = route.split("/");
  const params: Record<string, string> = {};

  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(":")) {
      const key = patternParts[i].slice(1);
      params[key] = routeParts[i];
    }
  }

  return params;
}

/**
 * Validate App Manifest (client-side basic checks)
 */
export function validateManifest(manifest: AppManifest): ManifestValidationResult {
  const issues: ValidationIssue[] = [];

  // Check schema_version
  if (!manifest.schema_version) {
    issues.push({ level: "error", message: "Missing schema_version" });
  }

  // Check version
  if (!manifest.version) {
    issues.push({ level: "error", message: "Missing version" });
  }

  // Check for duplicate route IDs
  const routeIds = new Set<string>();
  for (const route of manifest.routes || []) {
    if (routeIds.has(route.id)) {
      issues.push({ level: "error", message: `Duplicate route ID: ${route.id}`, location: `routes` });
    }
    routeIds.add(route.id);
  }

  // Check for duplicate screen IDs
  const screenIds = new Set<string>();
  for (const screen of manifest.views?.screens || []) {
    if (screenIds.has(screen.id)) {
      issues.push({ level: "error", message: `Duplicate screen ID: ${screen.id}`, location: `views.screens` });
    }
    screenIds.add(screen.id);
  }

  // Check for duplicate screen routes
  const screenRoutes = new Set<string>();
  for (const screen of manifest.views?.screens || []) {
    if (screenRoutes.has(screen.route)) {
      issues.push({ level: "error", message: `Duplicate screen route: ${screen.route}`, location: `views.screens` });
    }
    screenRoutes.add(screen.route);
  }

  return {
    valid: issues.filter((i) => i.level === "error").length === 0,
    issues,
  };
}

/**
 * Get inserts for a screen
 */
export function getScreenInserts(manifest: AppManifest, screenId: string): AppManifestInsert[] {
  if (!manifest.views?.insert) return [];

  return manifest.views.insert
    .filter((insert) => insert.screen === screenId)
    .sort((a, b) => a.order - b.order);
}
