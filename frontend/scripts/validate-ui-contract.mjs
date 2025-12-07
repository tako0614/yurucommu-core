import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const contractPath = path.resolve(repoRoot, "takos-ui-contract.json");
const viewsDir = path.resolve(repoRoot, "app", "views");
const sideNavPath = path.resolve(repoRoot, "frontend", "src", "components", "Navigation", "SideNav.tsx");
const appTabPath = path.resolve(repoRoot, "frontend", "src", "components", "Navigation", "AppTab.tsx");

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to parse JSON at ${filePath}: ${error.message}`);
  }
}

function walkJsonFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
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

function loadScreens() {
  const files = walkJsonFiles(viewsDir);
  const screens = [];
  for (const file of files) {
    const data = readJson(file);
    if (Array.isArray(data.screens)) {
      screens.push(...data.screens);
    }
  }
  return screens;
}

function normalizeRoutePattern(pattern) {
  if (typeof pattern !== "string") return "";
  return pattern
    .replace(/\${[^}]+}/g, ":param")
    .replace(/\{\{[^}]+\}\}/g, ":param")
    .replace(/\/+/g, "/")
    .trim();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function patternToRegExp(pattern) {
  const normalized = normalizeRoutePattern(pattern);
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) {
    return /^\/$/;
  }

  const parts = segments.map((raw) => {
    if (raw === "*") return ".*";
    const optional = raw.endsWith("?");
    const core = optional ? raw.slice(0, -1) : raw;
    const isDynamic = core.startsWith(":");
    const token = isDynamic ? "[^/]+" : escapeRegex(core);
    return optional ? `(?:/${token})?` : `/${token}`;
  });

  return new RegExp(`^${parts.join("")}$`);
}

function patternSamples(pattern) {
  const normalized = normalizeRoutePattern(pattern);
  const segments = normalized.split("/").filter(Boolean);
  const base = [];
  const withOptionals = [];

  for (const raw of segments) {
    if (raw === "*") {
      base.push("x");
      withOptionals.push("x");
      continue;
    }
    const optional = raw.endsWith("?");
    const core = optional ? raw.slice(0, -1) : raw;
    const isDynamic = core.startsWith(":");
    const token = isDynamic ? "x" : core;
    if (!optional) {
      base.push(token);
      withOptionals.push(token);
    } else {
      withOptionals.push(token);
    }
  }

  const samples = new Set();
  samples.add(`/${base.join("/")}`);
  samples.add(`/${withOptionals.join("/")}`);
  return Array.from(samples);
}

function patternsIntersect(a, b) {
  const regexA = patternToRegExp(a);
  const regexB = patternToRegExp(b);
  const samplesA = patternSamples(a);
  const samplesB = patternSamples(b);

  const aMatchesB = samplesA.some((sample) => regexB.test(sample));
  const bMatchesA = samplesB.some((sample) => regexA.test(sample));
  return aMatchesB && bMatchesA;
}

function findScreensForPattern(pattern, screenMap) {
  const matches = [];
  const normalized = normalizeRoutePattern(pattern);
  for (const screen of screenMap.values()) {
    if (!screen?.route) continue;
    if (patternsIntersect(normalized, normalizeRoutePattern(screen.route))) {
      matches.push(screen);
    }
  }
  return matches;
}

function extractNavigationTargetsFromTsx(filePath) {
  if (!fs.existsSync(filePath)) return new Set();
  const source = fs.readFileSync(filePath, "utf8");
  const targets = new Set();
  const literalHref = /href=["']([^"']+)["']/g;
  const templateHref = /href=\{\s*`([^`]+)`\s*\}/g;
  const navigateCall = /navigate\(\s*["'`]([^"'`]+)["'`]/g;
  const genericRouteLiteral = /["'`](\/[^"'`]+)["'`]/g;

  let match;
  while ((match = literalHref.exec(source))) {
    const normalized = normalizeRoutePattern(match[1] || "");
    if (normalized.startsWith("/")) targets.add(normalized);
  }
  while ((match = templateHref.exec(source))) {
    const normalized = normalizeRoutePattern(match[1] || "");
    if (normalized.startsWith("/")) targets.add(normalized);
  }
  while ((match = navigateCall.exec(source))) {
    const normalized = normalizeRoutePattern(match[1] || "");
    if (normalized.startsWith("/")) targets.add(normalized);
  }
  while ((match = genericRouteLiteral.exec(source))) {
    const normalized = normalizeRoutePattern(match[1] || "");
    if (normalized.startsWith("/")) targets.add(normalized);
  }

  return targets;
}

function extractTargetsFromAction(action) {
  const targets = [];
  const add = (value) => {
    const normalized = normalizeRoutePattern(value);
    if (normalized.startsWith("/")) targets.push(normalized);
  };
  if (!action) return targets;
  if (typeof action === "string") {
    return targets;
  }
  if (Array.isArray(action)) {
    action.forEach((item) => targets.push(...extractTargetsFromAction(item)));
    return targets;
  }
  if (typeof action === "object" && action.type === "navigate" && action.to) {
    add(action.to);
  }
  return targets;
}

function collectLayoutTargets(node, targets) {
  if (!node || typeof node !== "object") return;
  const props = node.props || {};
  const href = props.href || props.to;
  if (typeof href === "string") {
    const normalized = normalizeRoutePattern(href);
    if (normalized.startsWith("/")) targets.add(normalized);
  }
  extractTargetsFromAction(props.action || props.onClick).forEach((t) => targets.add(normalizeRoutePattern(t)));

  if (Array.isArray(node.children)) {
    node.children.forEach((child) => collectLayoutTargets(child, targets));
  }
  if (Array.isArray(node.else)) {
    node.else.forEach((child) => collectLayoutTargets(child, targets));
  }
}

function extractNavigationTargetsFromScreen(screen) {
  const targets = new Set();
  collectLayoutTargets(screen?.layout, targets);
  return targets;
}

function buildReachabilityEdges(screenMap) {
  const edges = new Map();
  const addEdge = (from, to) => {
    if (!from || !to) return;
    if (!edges.has(from)) edges.set(from, new Set());
    edges.get(from).add(to);
  };

  const shellNavTargets = new Set([
    ...extractNavigationTargetsFromTsx(sideNavPath),
    ...extractNavigationTargetsFromTsx(appTabPath),
  ]);
  for (const target of shellNavTargets) {
    const matchedScreens = findScreensForPattern(target, screenMap);
    matchedScreens.forEach((screen) => addEdge("screen.home", screen.id));
  }

  for (const screen of screenMap.values()) {
    const navTargets = extractNavigationTargetsFromScreen(screen);
    for (const target of navTargets) {
      const matches = findScreensForPattern(target, screenMap);
      matches.forEach((matched) => addEdge(screen.id, matched.id));
    }
  }

  const implicitEdges = [
    ["screen.community", "screen.channel"],
    ["screen.dm_list", "screen.dm_thread"],
    ["screen.storage", "screen.storage_folder"],
    ["screen.stories", "screen.story_viewer"],
  ];
  implicitEdges.forEach(([from, to]) => {
    if (screenMap.has(from) && screenMap.has(to)) {
      addEdge(from, to);
    }
  });

  return edges;
}

function computeReachability(edges) {
  const distances = new Map();
  const queue = [];
  distances.set("screen.home", 0);
  queue.push("screen.home");

  while (queue.length > 0) {
    const current = queue.shift();
    const nextStep = (distances.get(current) ?? 0) + 1;
    const nextScreens = edges.get(current);
    if (!nextScreens) continue;
    for (const target of nextScreens) {
      if (!distances.has(target) || nextStep < distances.get(target)) {
        distances.set(target, nextStep);
        queue.push(target);
      }
    }
  }

  return distances;
}

function validateContract(contract) {
  const errors = [];
  if (contract.schema_version !== "1.0") {
    errors.push(`schema_version must be "1.0" (got ${contract.schema_version})`);
  }

  const contractScreens = new Map();
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
      if (typeof screen.steps_from_home !== "number" || screen.steps_from_home < 0) {
        errors.push(`screen ${screen.id} must declare a non-negative steps_from_home`);
        continue;
      }
      contractScreens.set(screen.id, screen);
    }
  }

  const contractActions = new Map();
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
      contractActions.set(action.id, action);
    }
  }

  return { errors, contractScreens, contractActions };
}

function validateAgainstManifest(contractScreens, contractActions, screenMap, distances) {
  const errors = [];

  if (!screenMap.has("screen.home")) {
    errors.push("screen.home must exist in manifest");
  } else if (distances.get("screen.home") !== 0) {
    errors.push("screen.home must have steps_from_home 0");
  }

  for (const screen of contractScreens.values()) {
    const manifestScreen = screenMap.get(screen.id);
    if (!manifestScreen) {
      errors.push(`UI Contract screen "${screen.id}" is not defined in manifest`);
      continue;
    }
    if (typeof manifestScreen.route !== "string" || !manifestScreen.route.startsWith("/")) {
      errors.push(`screen ${screen.id} must declare a valid route`);
    } else {
      const match = screen.routes.some((route) =>
        patternsIntersect(normalizeRoutePattern(route), normalizeRoutePattern(manifestScreen.route))
      );
      if (!match) {
        errors.push(
          `screen ${screen.id} route "${manifestScreen.route}" does not match any contract route (${screen.routes.join(
            ", "
          )})`
        );
      }
    }

    const dist = distances.get(screen.id);
    if (dist === undefined) {
      errors.push(`screen ${screen.id} is not reachable from screen.home using navigation graph`);
    } else if (dist > screen.steps_from_home) {
      errors.push(
        `screen ${screen.id} declares steps_from_home=${screen.steps_from_home} but minimum reachable steps is ${dist}`
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
    for (const screenId of action.available_on) {
      if (!screenMap.has(screenId)) {
        errors.push(`action ${action.id} references unknown screen ${screenId}`);
        continue;
      }
      const dist = distances.get(screenId);
      if (typeof dist === "number") {
        minDist = Math.min(minDist, dist);
      }
    }
    if (!Number.isFinite(minDist)) {
      errors.push(`action ${action.id} is not reachable from screen.home because none of its screens are reachable`);
      continue;
    }
    if (minDist > action.max_steps_from_home) {
      errors.push(
        `action ${action.id} requires at least ${minDist} steps from screen.home but max_steps_from_home is ${action.max_steps_from_home}`
      );
    }
  }

  const openComposer = contractActions.get("action.open_composer");
  if (openComposer) {
    if (!openComposer.available_on.includes("screen.home")) {
      errors.push("action.open_composer must be available on screen.home");
    }
    if (openComposer.max_steps_from_home > 1) {
      errors.push("action.open_composer must be achievable within 1 step from screen.home");
    }
  }

  const openNotifications = contractActions.get("action.open_notifications");
  if (openNotifications) {
    if (!openNotifications.available_on.includes("screen.home")) {
      errors.push("action.open_notifications must be available on screen.home");
    }
    if (openNotifications.max_steps_from_home > 1) {
      errors.push("action.open_notifications must be achievable within 1 step from screen.home");
    }
  }

  const dmOpen = contractActions.get("action.open_dm_thread");
  if (dmOpen) {
    const allowed = dmOpen.available_on.some((id) => id === "screen.dm_list" || id === "screen.dm_thread");
    if (!allowed) {
      errors.push("action.open_dm_thread must be available on screen.dm_list or screen.dm_thread");
    }
  }

  const dmSend = contractActions.get("action.send_dm");
  if (dmSend) {
    const allowed = dmSend.available_on.some((id) => id === "screen.dm_thread");
    if (!allowed) {
      errors.push("action.send_dm must be available on screen.dm_thread");
    }
  }

  return errors;
}

function main() {
  const contract = readJson(contractPath);
  const screens = loadScreens();
  const screenMap = new Map();
  for (const screen of screens) {
    if (screen?.id) {
      screenMap.set(screen.id, screen);
    }
  }

  const { errors: contractErrors, contractScreens, contractActions } = validateContract(contract);
  const edges = buildReachabilityEdges(screenMap);
  const distances = computeReachability(edges);
  const manifestErrors = validateAgainstManifest(contractScreens, contractActions, screenMap, distances);

  const allErrors = [...contractErrors, ...manifestErrors];
  if (allErrors.length > 0) {
    console.error("UI Contract validation failed:");
    for (const err of allErrors) {
      console.error(`- ${err}`);
    }
    process.exit(1);
  }

  console.log("UI Contract validation passed.");
}

main();
