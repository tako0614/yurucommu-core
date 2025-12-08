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
let cachedContract: UiContract | null = null;

/**
 * Load UI Contract from static file
 */
async function loadUiContract(): Promise<UiContract | null> {
  if (cachedContract) {
    return cachedContract;
  }

  try {
    const response = await fetch("/schemas/ui-contract.json");
    if (!response.ok) {
      console.warn("[UiContract] UI Contract file not found, skipping validation");
      return null;
    }

    const contract: UiContract = await response.json();
    cachedContract = contract;
    return contract;
  } catch (error) {
    console.warn("[UiContract] Failed to load UI Contract:", error);
    return null;
  }
}

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
      schema_version: manifest.schema_version || (manifest as any).schemaVersion || "1.0",
      version: manifest.version || "0.0.0",
      routes: manifest.routes || [],
      views: manifest.views || { screens: [], insert: [] },
      ap: manifest.ap,
      data: manifest.data,
      storage: manifest.storage,
    };

    // Validate manifest with UI Contract
    const contract = await loadUiContract();
    if (contract) {
      const validationResult = validateManifestWithContract(normalizedManifest, contract);

      if (!validationResult.valid) {
        console.error("[AppManifest] UI Contract validation failed:");
        for (const issue of validationResult.issues) {
          if (issue.level === "error") {
            console.error(`  [ERROR] ${issue.message}${issue.location ? ` (${issue.location})` : ""}`);
          } else {
            console.warn(`  [WARN] ${issue.message}${issue.location ? ` (${issue.location})` : ""}`);
          }
        }
      } else if (validationResult.issues.length > 0) {
        console.warn("[AppManifest] UI Contract validation passed with warnings:");
        for (const issue of validationResult.issues) {
          console.warn(`  [WARN] ${issue.message}${issue.location ? ` (${issue.location})` : ""}`);
        }
      } else {
        console.log("[AppManifest] UI Contract validation passed ✓");
      }
    }

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
 * UI Contract Definition
 */
export interface UiContractScreen {
  id: string;
  label: string;
  routes: string[];
  steps_from_home: number;
}

export interface UiContractAction {
  id: string;
  available_on: string[];
  max_steps_from_home: number;
}

export interface UiContract {
  schema_version: string;
  screens: UiContractScreen[];
  actions: UiContractAction[];
}

/**
 * Reserved routes that cannot be overridden by App Manifest
 */
const RESERVED_ROUTES = [
  "/login",
  "/auth/*",
  "/-/core/*",
  "/-/config/*",
  "/-/app/*",
  "/-/health",
  "/.well-known/*",
];

/**
 * Core routes that must exist and cannot be removed
 */
const CORE_SCREEN_IDS = [
  "screen.home",
  "screen.onboarding",
  "screen.profile",
  "screen.profile_edit",
  "screen.settings",
  "screen.notifications",
];

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

    // Check for reserved route conflicts
    for (const reserved of RESERVED_ROUTES) {
      const reservedPattern = reserved.replace("*", ".*");
      const regex = new RegExp(`^${reservedPattern}$`);
      if (regex.test(screen.route)) {
        issues.push({
          level: "error",
          message: `Reserved route "${reserved}" cannot be defined in manifest (screen: ${screen.id}, route: ${screen.route})`,
          location: `views.screens[${screen.id}]`,
        });
      }
    }
  }

  // Check for core screen existence
  const definedScreenIds = new Set(manifest.views?.screens.map((s) => s.id) || []);
  for (const coreId of CORE_SCREEN_IDS) {
    if (!definedScreenIds.has(coreId)) {
      issues.push({
        level: "warning",
        message: `Core screen "${coreId}" is not defined in manifest`,
        location: "views.screens",
      });
    }
  }

  return {
    valid: issues.filter((i) => i.level === "error").length === 0,
    issues,
  };
}

/**
 * Validate UI Contract compliance
 */
export function validateUiContract(
  manifest: AppManifest,
  contract: UiContract
): ManifestValidationResult {
  const issues: ValidationIssue[] = [];

  // 1. Check that all contract screens exist in manifest
  const manifestScreenIds = new Set(manifest.views?.screens.map((s) => s.id) || []);
  for (const contractScreen of contract.screens) {
    if (!manifestScreenIds.has(contractScreen.id)) {
      issues.push({
        level: "error",
        message: `UI Contract screen "${contractScreen.id}" is not defined in manifest`,
        location: "views.screens",
      });
    }
  }

  // 2. Check steps_from_home constraints (BFS from screen.home)
  const screenGraph = buildScreenGraph(manifest.views?.screens || []);
  const distances = computeDistancesFromHome(screenGraph);

  for (const contractScreen of contract.screens) {
    const actualDistance = distances.get(contractScreen.id);
    if (actualDistance === undefined) {
      issues.push({
        level: "warning",
        message: `Screen "${contractScreen.id}" is not reachable from screen.home`,
        location: `views.screens[${contractScreen.id}]`,
      });
    } else if (actualDistance > contractScreen.steps_from_home) {
      issues.push({
        level: "error",
        message: `Screen "${contractScreen.id}" is ${actualDistance} steps from home, but contract requires max ${contractScreen.steps_from_home}`,
        location: `views.screens[${contractScreen.id}]`,
      });
    }
  }

  // 3. Check action availability
  for (const contractAction of contract.actions) {
    for (const screenId of contractAction.available_on) {
      const screen = manifest.views?.screens.find((s) => s.id === screenId);
      if (!screen) {
        issues.push({
          level: "warning",
          message: `Action "${contractAction.id}" requires screen "${screenId}" which is not defined`,
          location: "views.screens",
        });
        continue;
      }

      // Check if action is available within max_steps_from_home
      const distance = distances.get(screenId);
      if (distance !== undefined && distance > contractAction.max_steps_from_home) {
        issues.push({
          level: "error",
          message: `Action "${contractAction.id}" on screen "${screenId}" is ${distance} steps from home, but contract requires max ${contractAction.max_steps_from_home}`,
          location: `views.screens[${screenId}]`,
        });
      }

      // TODO: Deep scan screen.layout to verify action actually exists in UI
      // This requires traversing the UiNode tree and checking for action references
    }
  }

  return {
    valid: issues.filter((i) => i.level === "error").length === 0,
    issues,
  };
}

/**
 * Build screen navigation graph from manifest screens
 */
function buildScreenGraph(screens: AppManifestScreen[]): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();

  for (const screen of screens) {
    if (!graph.has(screen.id)) {
      graph.set(screen.id, new Set());
    }

    // Extract navigation links from layout (simplified: only checks NavLink components)
    const links = extractNavigationLinks(screen.layout);
    for (const targetRoute of links) {
      const targetScreen = screens.find((s) => s.route === targetRoute);
      if (targetScreen) {
        graph.get(screen.id)!.add(targetScreen.id);
      }
    }
  }

  return graph;
}

/**
 * Extract navigation links from UiNode tree
 */
function extractNavigationLinks(node: any): string[] {
  if (!node) return [];

  const links: string[] = [];

  // Check if this node is a NavLink or navigate action
  if (node.type === "NavLink" && node.props?.href) {
    links.push(node.props.href);
  }
  if (node.type === "Button" && node.props?.action?.type === "navigate" && node.props.action.to) {
    links.push(node.props.action.to);
  }

  // Recurse into children
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      links.push(...extractNavigationLinks(child));
    }
  }

  return links;
}

/**
 * Compute shortest distances from screen.home using BFS
 */
function computeDistancesFromHome(graph: Map<string, Set<string>>): Map<string, number> {
  const distances = new Map<string, number>();
  const queue: Array<{ id: string; distance: number }> = [{ id: "screen.home", distance: 0 }];
  distances.set("screen.home", 0);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = graph.get(current.id) || new Set();

    for (const neighbor of neighbors) {
      if (!distances.has(neighbor)) {
        distances.set(neighbor, current.distance + 1);
        queue.push({ id: neighbor, distance: current.distance + 1 });
      }
    }
  }

  return distances;
}

/**
 * Validate manifest with UI Contract
 * This is the main validation function that should be called on manifest load
 */
export function validateManifestWithContract(
  manifest: AppManifest,
  contract: UiContract
): ManifestValidationResult {
  // Run basic manifest validation
  const basicValidation = validateManifest(manifest);

  // Run UI Contract validation
  const contractValidation = validateUiContract(manifest, contract);

  // Merge issues
  const allIssues = [...basicValidation.issues, ...contractValidation.issues];

  return {
    valid: allIssues.filter((i) => i.level === "error").length === 0,
    issues: allIssues,
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
