#!/usr/bin/env node

import fs from "node:fs/promises";
import fss from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  AppHandlerRegistry,
  loadAppManifest,
  parseUiContractJson,
  validateUiContractAgainstManifest,
  type AppManifestValidationIssue,
  type UiContract,
} from "@takos/platform/app";

const EXPECTED_SCHEMA_VERSION = "1.10";

const RESERVED_ROUTES = [
  "/login",
  "/auth/*",
  "/-/core/*",
  "/-/config/*",
  "/-/app/*",
  "/-/health",
  "/.well-known/*",
];

const REQUIRED_SCREENS = [
  "screen.home",
  "screen.community",
  "screen.channel",
  "screen.dm_list",
  "screen.dm_thread",
  "screen.story_viewer",
  "screen.profile",
  "screen.settings",
];

const REQUIRED_ACTIONS = [
  "action.open_composer",
  "action.send_post",
  "action.open_notifications",
  "action.open_dm_thread",
  "action.send_dm",
  "action.reply",
  "action.react",
  "action.view_story",
  "action.edit_profile",
];

type CliOptions = {
  root: string;
  verbose: boolean;
};

type Screen = {
  id: string;
  route?: string;
  layout?: unknown;
};

type ContractScreen = {
  id: string;
  routes?: string[];
  steps_from_home?: number;
};

type ContractAction = {
  id: string;
  available_on?: string[];
  max_steps_from_home?: number;
};

function parseArgs(argv: string[]): CliOptions {
  let root: string | undefined;
  let verbose = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--root":
      case "-r":
        root = argv[i + 1];
        i += 1;
        break;
      case "--verbose":
      case "-v":
        verbose = true;
        break;
      default:
        break;
    }
  }

  return { root: root || ".", verbose };
}

function createFsSource(root: string) {
  return {
    async readFile(filePath: string): Promise<string> {
      const abs = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
      return fs.readFile(abs, "utf8");
    },
    async listFiles(dirPath: string): Promise<string[]> {
      const abs = path.isAbsolute(dirPath) ? dirPath : path.join(root, dirPath);
      const entries = await fs.readdir(abs, { withFileTypes: true });
      return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    },
  };
}

async function findAppMain(root: string): Promise<string | null> {
  const candidates = [
    "app/handlers.ts",
    "app/handlers.tsx",
    "app/handlers.js",
    "app/handlers.mjs",
    "app/handlers.cjs",
  ];
  for (const candidate of candidates) {
    const fullPath = path.join(root, candidate);
    try {
      await fs.access(fullPath);
      return fullPath;
    } catch {
      continue;
    }
  }
  return null;
}

async function scanHandlers(filePath: string): Promise<Set<string>> {
  const source = await fs.readFile(filePath, "utf8");
  const handlers = new Set<string>();

  const exportFunction = /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g;
  const exportConst = /export\s+(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\(/g;
  const exportNamed = /export\s*{\s*([^}]+)\s*}/gs;

  for (const match of source.matchAll(exportFunction)) {
    handlers.add(match[1]);
  }
  for (const match of source.matchAll(exportConst)) {
    handlers.add(match[1]);
  }
  for (const match of source.matchAll(exportNamed)) {
    const names = match[1].split(",").map((part) => part.trim().split(/\s+as\s+/i)[0]);
    names.filter(Boolean).forEach((name) => handlers.add(name));
  }

  return handlers;
}

async function collectHandlers(root: string): Promise<Set<string>> {
  const appMainPath = await findAppMain(root);
  if (!appMainPath) {
    return new Set();
  }

  try {
    const { pathToFileURL } = await import("node:url");
    const specifier = `${pathToFileURL(appMainPath).href}?t=${Date.now()}`;
    const loaded = await import(specifier);
    const registry = AppHandlerRegistry.fromModule(loaded as Record<string, unknown>);
    return new Set(registry.list());
  } catch {
    try {
      return await scanHandlers(appMainPath);
    } catch {
      return new Set();
    }
  }
}

async function loadUiContract(
  root: string,
): Promise<{ contract: UiContract | null; issues: AppManifestValidationIssue[]; source?: string }> {
  const issues: AppManifestValidationIssue[] = [];
  const contractPath = path.join(root, "schemas/ui-contract.json");

  try {
    const raw = await fs.readFile(contractPath, "utf8");
    const parsed = parseUiContractJson(raw, "schemas/ui-contract.json");
    issues.push(...parsed.issues);
    return { contract: parsed.contract ?? null, issues, source: "schemas/ui-contract.json" };
  } catch {
    issues.push({
      severity: "error",
      message: "schemas/ui-contract.json not found",
      file: contractPath,
    });
    return { contract: null, issues };
  }
}

function readJson(filePath: string): unknown {
  const raw = fss.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function walkJsonFiles(dir: string): string[] {
  if (!fss.existsSync(dir)) return [];
  const results: string[] = [];
  const entries = fss.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkJsonFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      results.push(full);
    }
  }
  return results;
}

function loadScreensFromViews(root: string): Screen[] {
  const viewsDir = path.join(root, "app", "views");
  const files = walkJsonFiles(viewsDir);
  const screens: Screen[] = [];
  for (const file of files) {
    try {
      const data = readJson(file) as { screens?: Screen[] };
      if (Array.isArray(data.screens)) {
        screens.push(...data.screens);
      }
    } catch {
      // Ignore invalid JSON files
    }
  }
  return screens;
}

function normalizeRoutePattern(pattern: string): string {
  if (typeof pattern !== "string") return "";
  return pattern
    .replace(/\${[^}]+}/g, ":param")
    .replace(/\{\{[^}]+\}\}/g, ":param")
    .replace(/\/+/g, "/")
    .trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function patternToRegExp(pattern: string): RegExp {
  const normalized = normalizeRoutePattern(pattern);
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) {
    return /^\/$/;
  }

  const parts = segments.map((raw) => {
    if (raw === "*") return ".*";
    const optional = raw.endsWith("?");
    const core = optional ? raw.slice(0, -1) : raw;
    const dynamicIndex = core.indexOf(":");
    const isDynamic = dynamicIndex >= 0;
    const prefix = isDynamic && dynamicIndex > 0 ? escapeRegex(core.slice(0, dynamicIndex)) : "";
    const token = isDynamic ? `${prefix}[^/]+` : escapeRegex(core);
    return optional ? `(?:/${token})?` : `/${token}`;
  });

  return new RegExp(`^${parts.join("")}$`);
}

function patternSamples(pattern: string): string[] {
  const normalized = normalizeRoutePattern(pattern);
  const segments = normalized.split("/").filter(Boolean);
  const base: string[] = [];
  const withOptionals: string[] = [];

  for (const raw of segments) {
    if (raw === "*") {
      base.push("x");
      withOptionals.push("x");
      continue;
    }
    const optional = raw.endsWith("?");
    const core = optional ? raw.slice(0, -1) : raw;
    const dynamicIndex = core.indexOf(":");
    const isDynamic = dynamicIndex >= 0;
    const token = isDynamic ? `${core.slice(0, dynamicIndex)}x` : core;
    if (!optional) {
      base.push(token);
      withOptionals.push(token);
    } else {
      withOptionals.push(token);
    }
  }

  const samples = new Set<string>();
  samples.add(`/${base.join("/")}`);
  samples.add(`/${withOptionals.join("/")}`);
  return Array.from(samples);
}

function isReservedRoute(pattern: string): boolean {
  const normalized = normalizeRoutePattern(pattern);
  return RESERVED_ROUTES.some((reserved) => patternToRegExp(reserved).test(normalized));
}

function patternsIntersect(a: string, b: string): boolean {
  const regexA = patternToRegExp(a);
  const regexB = patternToRegExp(b);
  const samplesA = patternSamples(a);
  const samplesB = patternSamples(b);

  const aMatchesB = samplesA.some((sample) => regexB.test(sample));
  const bMatchesA = samplesB.some((sample) => regexA.test(sample));
  return aMatchesB && bMatchesA;
}

function findScreensForPattern(pattern: string, screenMap: Map<string, Screen>): Screen[] {
  const matches: Screen[] = [];
  const normalized = normalizeRoutePattern(pattern);
  for (const screen of screenMap.values()) {
    if (!screen?.route) continue;
    if (patternsIntersect(normalized, normalizeRoutePattern(screen.route))) {
      matches.push(screen);
    }
  }
  return matches;
}

function extractTargetsFromAction(action: unknown): string[] {
  const targets: string[] = [];
  const add = (value: string) => {
    const normalized = normalizeRoutePattern(value);
    if (normalized.startsWith("/")) targets.push(normalized);
  };

  if (!action) return targets;
  if (typeof action === "string") return targets;
  if (Array.isArray(action)) {
    action.forEach((item) => targets.push(...extractTargetsFromAction(item)));
    return targets;
  }
  if (typeof action === "object" && (action as { type?: string; to?: string }).type === "navigate") {
    const to = (action as { to?: string }).to;
    if (to) add(to);
  }
  return targets;
}

function collectLayoutTargets(node: unknown, targets: Set<string>): void {
  if (!node || typeof node !== "object") return;
  const props = (node as { props?: Record<string, unknown> }).props || {};
  const href = props.href || props.to;
  if (typeof href === "string") {
    const normalized = normalizeRoutePattern(href);
    if (normalized.startsWith("/")) targets.add(normalized);
  }
  extractTargetsFromAction(props.action || props.onClick).forEach((t) =>
    targets.add(normalizeRoutePattern(t)),
  );

  const nodeWithChildren = node as { children?: unknown[]; else?: unknown[] };
  if (Array.isArray(nodeWithChildren.children)) {
    nodeWithChildren.children.forEach((child) => collectLayoutTargets(child, targets));
  }
  if (Array.isArray(nodeWithChildren.else)) {
    nodeWithChildren.else.forEach((child) => collectLayoutTargets(child, targets));
  }
}

function extractNavigationTargetsFromScreen(screen: Screen): Set<string> {
  const targets = new Set<string>();
  collectLayoutTargets(screen?.layout, targets);
  return targets;
}

function buildReachabilityEdges(screenMap: Map<string, Screen>): Map<string, Set<string>> {
  const edges = new Map<string, Set<string>>();
  const addEdge = (from: string, to: string) => {
    if (!from || !to) return;
    if (!edges.has(from)) edges.set(from, new Set());
    edges.get(from)!.add(to);
  };

  for (const screen of screenMap.values()) {
    const navTargets = extractNavigationTargetsFromScreen(screen);
    for (const target of navTargets) {
      const matches = findScreensForPattern(target, screenMap);
      matches.forEach((matched) => addEdge(screen.id, matched.id));
    }
  }

  const implicitEdges: [string, string][] = [
    ["screen.home", "screen.community"],
    ["screen.home", "screen.dm_list"],
    ["screen.home", "screen.stories"],
    ["screen.home", "screen.profile"],
    ["screen.home", "screen.notifications"],
    ["screen.home", "screen.story_viewer"],
    ["screen.home", "screen.connections"],
    ["screen.home", "screen.storage"],
    ["screen.community", "screen.channel"],
    ["screen.dm_list", "screen.dm_thread"],
    ["screen.storage", "screen.storage_folder"],
    ["screen.stories", "screen.story_viewer"],
    ["screen.profile", "screen.settings"],
    ["screen.profile", "screen.profile_edit"],
    ["screen.connections", "screen.users"],
    ["screen.connections", "screen.invitations"],
    ["screen.connections", "screen.follow_requests"],
  ];
  implicitEdges.forEach(([from, to]) => {
    if (screenMap.has(from) && screenMap.has(to)) {
      addEdge(from, to);
    }
  });

  return edges;
}

function computeReachability(edges: Map<string, Set<string>>): Map<string, number> {
  const distances = new Map<string, number>();
  const queue: string[] = [];
  distances.set("screen.home", 0);
  queue.push("screen.home");

  while (queue.length > 0) {
    const current = queue.shift()!;
    const nextStep = (distances.get(current) ?? 0) + 1;
    const nextScreens = edges.get(current);
    if (!nextScreens) continue;
    for (const target of nextScreens) {
      if (!distances.has(target) || nextStep < distances.get(target)!) {
        distances.set(target, nextStep);
        queue.push(target);
      }
    }
  }

  return distances;
}

function validateContractStructure(contract: UiContract): {
  errors: string[];
  contractScreens: Map<string, ContractScreen>;
  contractActions: Map<string, ContractAction>;
} {
  const errors: string[] = [];
  const contractScreens = new Map<string, ContractScreen>();
  const contractActions = new Map<string, ContractAction>();

  if (contract.schema_version !== EXPECTED_SCHEMA_VERSION) {
    errors.push(
      `schema_version must be "${EXPECTED_SCHEMA_VERSION}" (got ${contract.schema_version})`,
    );
  }

  if (!Array.isArray(contract.screens)) {
    errors.push("screens must be an array");
  } else {
    for (const screen of contract.screens) {
      if (!screen || typeof screen.id !== "string") {
        errors.push("screen.id must be a string");
        continue;
      }
      if (contractScreens.has(screen.id)) {
        errors.push(`duplicate screen id: ${screen.id}`);
        continue;
      }
      if (!Array.isArray(screen.routes) || screen.routes.length === 0) {
        errors.push(`screen ${screen.id} must declare at least one route`);
        continue;
      }
      const reserved = (screen.routes as string[]).filter(
        (route) => typeof route === "string" && isReservedRoute(route),
      );
      if (reserved.length > 0) {
        errors.push(`screen ${screen.id} cannot use reserved route(s): ${reserved.join(", ")}`);
        continue;
      }
      if (typeof screen.steps_from_home !== "number" || screen.steps_from_home < 0) {
        errors.push(`screen ${screen.id} must declare a non-negative steps_from_home`);
        continue;
      }
      contractScreens.set(screen.id, screen as ContractScreen);
    }
  }

  if (!Array.isArray(contract.actions)) {
    errors.push("actions must be an array");
  } else {
    for (const action of contract.actions) {
      if (!action || typeof action.id !== "string") {
        errors.push("action.id must be a string");
        continue;
      }
      if (contractActions.has(action.id)) {
        errors.push(`duplicate action id: ${action.id}`);
        continue;
      }
      if (!Array.isArray(action.available_on) || action.available_on.length === 0) {
        errors.push(`action ${action.id} must declare available_on screens`);
        continue;
      }
      if (typeof action.max_steps_from_home !== "number" || action.max_steps_from_home < 0) {
        errors.push(`action ${action.id} must declare a non-negative max_steps_from_home`);
        continue;
      }
      contractActions.set(action.id, action as ContractAction);
    }
  }

  REQUIRED_SCREENS.forEach((screenId) => {
    if (!contractScreens.has(screenId)) {
      errors.push(`required screen ${screenId} is missing from contract`);
    }
  });
  REQUIRED_ACTIONS.forEach((actionId) => {
    if (!contractActions.has(actionId)) {
      errors.push(`required action ${actionId} is missing from contract`);
    }
  });

  return { errors, contractScreens, contractActions };
}

function validateReachability(
  contractScreens: Map<string, ContractScreen>,
  contractActions: Map<string, ContractAction>,
  screenMap: Map<string, Screen>,
  distances: Map<string, number>,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!screenMap.has("screen.home")) {
    errors.push("screen.home must exist in manifest");
  } else if (distances.get("screen.home") !== 0) {
    errors.push("screen.home must have steps_from_home 0");
  }

  REQUIRED_SCREENS.forEach((screenId) => {
    if (!screenMap.has(screenId)) {
      errors.push(`manifest is missing required screen ${screenId}`);
    }
  });

  for (const manifestScreen of screenMap.values()) {
    if (manifestScreen?.route && isReservedRoute(manifestScreen.route)) {
      errors.push(
        `manifest screen ${manifestScreen.id} uses reserved route ${manifestScreen.route}`,
      );
    }
  }

  for (const manifestScreen of screenMap.values()) {
    if (
      manifestScreen?.id &&
      manifestScreen.id.startsWith("screen.") &&
      !contractScreens.has(manifestScreen.id)
    ) {
      errors.push(
        `manifest screen "${manifestScreen.id}" is not declared in schemas/ui-contract.json`,
      );
    }
  }

  for (const screen of contractScreens.values()) {
    const manifestScreen = screenMap.get(screen.id);
    if (!manifestScreen) {
      errors.push(`UI Contract screen "${screen.id}" is not defined in manifest`);
      continue;
    }

    if (typeof manifestScreen.route !== "string" || !manifestScreen.route.startsWith("/")) {
      errors.push(`screen ${screen.id} must declare a valid route`);
    } else if (screen.routes) {
      const match = screen.routes.some((route) =>
        patternsIntersect(normalizeRoutePattern(route), normalizeRoutePattern(manifestScreen.route!)),
      );
      if (!match) {
        errors.push(
          `screen ${screen.id} route "${manifestScreen.route}" does not match any contract route (${screen.routes.join(", ")})`,
        );
      }
    }

    const dist = distances.get(screen.id);
    if (dist === undefined) {
      const message = `screen ${screen.id} is not reachable from screen.home using navigation graph`;
      if (REQUIRED_SCREENS.includes(screen.id)) {
        errors.push(message);
      } else {
        warnings.push(message);
      }
    } else if (screen.steps_from_home !== undefined && dist > screen.steps_from_home) {
      errors.push(
        `screen ${screen.id} declares steps_from_home=${screen.steps_from_home} but minimum reachable steps is ${dist}`,
      );
    }
  }

  const profileDist = distances.get("screen.profile");
  if (profileDist !== undefined && profileDist > 2) {
    errors.push("screen.profile must be reachable within 2 steps from screen.home");
  }

  const settingsDist = distances.get("screen.settings");
  if (settingsDist !== undefined && settingsDist > 2) {
    errors.push("screen.settings must be reachable within 2 steps from screen.home");
  }

  for (const action of contractActions.values()) {
    let minDist = Infinity;
    for (const screenId of action.available_on || []) {
      if (!screenMap.has(screenId)) {
        errors.push(`action ${action.id} references unknown screen ${screenId}`);
        continue;
      }
      if (!contractScreens.has(screenId)) {
        errors.push(
          `action ${action.id} references screen ${screenId} that is missing from UI contract`,
        );
        continue;
      }
      const dist = distances.get(screenId);
      if (typeof dist === "number") {
        minDist = Math.min(minDist, dist);
      }
    }

    if (!Number.isFinite(minDist)) {
      errors.push(
        `action ${action.id} is not reachable from screen.home because none of its screens are reachable`,
      );
      continue;
    }

    if (action.max_steps_from_home !== undefined && minDist > action.max_steps_from_home) {
      errors.push(
        `action ${action.id} requires at least ${minDist} steps from screen.home but max_steps_from_home is ${action.max_steps_from_home}`,
      );
    }
  }

  const openComposer = contractActions.get("action.open_composer");
  if (openComposer) {
    if (!openComposer.available_on?.includes("screen.home")) {
      errors.push("action.open_composer must be available on screen.home");
    }
    if (openComposer.max_steps_from_home !== undefined && openComposer.max_steps_from_home > 1) {
      errors.push("action.open_composer must be achievable within 1 step from screen.home");
    }
  }

  const openNotifications = contractActions.get("action.open_notifications");
  if (openNotifications) {
    if (!openNotifications.available_on?.includes("screen.home")) {
      errors.push("action.open_notifications must be available on screen.home");
    }
    if (
      openNotifications.max_steps_from_home !== undefined &&
      openNotifications.max_steps_from_home > 1
    ) {
      errors.push("action.open_notifications must be achievable within 1 step from screen.home");
    }
  }

  const dmOpen = contractActions.get("action.open_dm_thread");
  if (dmOpen) {
    const allowed = dmOpen.available_on?.some(
      (id) => id === "screen.dm_list" || id === "screen.dm_thread",
    );
    if (!allowed) {
      errors.push("action.open_dm_thread must be available on screen.dm_list or screen.dm_thread");
    }
  }

  const dmSend = contractActions.get("action.send_dm");
  if (dmSend) {
    const allowed = dmSend.available_on?.some((id) => id === "screen.dm_thread");
    if (!allowed) {
      errors.push("action.send_dm must be available on screen.dm_thread");
    }
  }

  return { errors, warnings };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const workspaceRoot = path.resolve(process.cwd(), options.root);
  const appDir = path.join(workspaceRoot, "app");

  console.log("UI Contract validation\n");
  console.log(`Workspace: ${workspaceRoot}`);

  const handlers = await collectHandlers(workspaceRoot);
  const manifestResult = await loadAppManifest({
    source: createFsSource(workspaceRoot),
    rootDir: appDir,
    availableHandlers: handlers,
  });

  const uiContract = await loadUiContract(workspaceRoot);
  const allIssues: AppManifestValidationIssue[] = [
    ...manifestResult.issues,
    ...uiContract.issues,
  ];

  if (!uiContract.contract) {
    console.error("\nUI Contract validation failed:");
    for (const issue of allIssues) {
      console.error(`  ✗ ${issue.message}`);
    }
    process.exit(1);
  }

  const { errors: structureErrors, contractScreens, contractActions } = validateContractStructure(
    uiContract.contract,
  );

  console.log(`✓ Schema version: ${uiContract.contract.schema_version}`);

  const requiredScreensPresent = REQUIRED_SCREENS.filter((id) => contractScreens.has(id));
  console.log(
    `✓ Required screens present: ${requiredScreensPresent.length}/${REQUIRED_SCREENS.length}`,
  );

  const requiredActionsPresent = REQUIRED_ACTIONS.filter((id) => contractActions.has(id));
  console.log(
    `✓ Required actions present: ${requiredActionsPresent.length}/${REQUIRED_ACTIONS.length}`,
  );

  // Load screens from views directory (fallback if manifest is empty)
  let manifestScreens = manifestResult.manifest?.views?.screens || [];
  if (manifestScreens.length === 0) {
    manifestScreens = loadScreensFromViews(workspaceRoot);
  }

  const screenMap = new Map<string, Screen>();
  for (const screen of manifestScreens) {
    if (screen?.id) {
      screenMap.set(screen.id, screen as Screen);
    }
  }

  console.log(`✓ Screens loaded: ${screenMap.size}`);

  const edges = buildReachabilityEdges(screenMap);
  const distances = computeReachability(edges);

  const { errors: reachabilityErrors, warnings } = validateReachability(
    contractScreens,
    contractActions,
    screenMap,
    distances,
  );

  if (manifestResult.manifest && uiContract.contract) {
    const platformIssues = validateUiContractAgainstManifest(
      manifestResult.manifest,
      uiContract.contract,
      uiContract.source,
    );
    allIssues.push(...platformIssues);
  }

  console.log("✓ Reachability check:");
  for (const screen of contractScreens.values()) {
    const dist = distances.get(screen.id);
    const max = screen.steps_from_home;
    if (dist !== undefined && max !== undefined && dist <= max) {
      console.log(`  ✓ ${screen.id}: ${dist} step(s) from home (max: ${max})`);
    }
  }

  if (options.verbose) {
    console.log("\n✓ Action availability:");
    for (const action of contractActions.values()) {
      const availableScreens = (action.available_on || []).filter((id) => screenMap.has(id));
      console.log(`  ✓ ${action.id} available on: ${availableScreens.join(", ")}`);
    }
  }

  const allErrors = [
    ...structureErrors,
    ...reachabilityErrors,
    ...allIssues.filter((i) => i.severity === "error").map((i) => i.message),
  ];
  const allWarnings = [
    ...warnings,
    ...allIssues.filter((i) => i.severity === "warning").map((i) => i.message),
  ];

  const uniqueErrors = [...new Set(allErrors)];
  const uniqueWarnings = [...new Set(allWarnings)];

  if (uniqueWarnings.length > 0) {
    console.log("\nWarnings:");
    for (const warn of uniqueWarnings) {
      console.warn(`  ⚠ ${warn}`);
    }
  }

  if (uniqueErrors.length > 0) {
    console.error("\nUI Contract validation failed:");
    for (const err of uniqueErrors) {
      console.error(`  ✗ ${err}`);
    }
    process.exit(1);
  }

  console.log("\nUI Contract validation passed.");
  process.exit(0);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[ui:contract] unexpected failure: ${message}`);
  process.exit(1);
});
