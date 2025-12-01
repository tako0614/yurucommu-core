import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const frontendDir = path.resolve(repoRoot, "frontend");
const contractPath = path.resolve(repoRoot, "takos-ui-contract.json");
const appPath = path.resolve(frontendDir, "src", "App.tsx");
const sideNavPath = path.resolve(frontendDir, "src", "components", "Navigation", "SideNav.tsx");
const appTabPath = path.resolve(frontendDir, "src", "components", "Navigation", "AppTab.tsx");
const chatPath = path.resolve(frontendDir, "src", "pages", "Chat.tsx");

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function parseJson(filePath) {
  try {
    return JSON.parse(readText(filePath));
  } catch (error) {
    throw new Error(`Failed to parse JSON at ${filePath}: ${error.message}`);
  }
}

function extractRoutePaths(source) {
  const regex = /<Route\s+[^>]*?path=["']([^"']+)["']/g;
  const paths = new Set();
  let match;
  while ((match = regex.exec(source))) {
    paths.add(match[1]);
  }
  return paths;
}

function extractNestedChatRoutes(source) {
  const regex = /useMatch\(\s*\(\s*\)\s*=>\s*["']([^"']+)["']/g;
  const paths = new Set();
  let match;
  while ((match = regex.exec(source))) {
    paths.add(match[1]);
  }
  return paths;
}

function routePatternCovered(pattern, topLevelRoutes, nestedRoutes) {
  if (topLevelRoutes.has(pattern) || nestedRoutes.has(pattern)) {
    return true;
  }

  for (const route of topLevelRoutes) {
    if (route.endsWith("/*")) {
      const base = route.replace(/\/\*$/, "");
      if (pattern === base || pattern.startsWith(`${base}/`)) {
        return true;
      }
    }
  }

  return false;
}

function normalizeRoutePattern(pattern) {
  if (typeof pattern !== "string") return "";
  return pattern
    .replace(/\${[^}]+}/g, ":param")
    .replace(/\/+/g, "/")
    .trim();
}

function extractNavigationTargets(source) {
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

function findScreensForPattern(pattern, screens) {
  const matches = [];
  for (const screen of screens.values()) {
    if (!Array.isArray(screen.routes)) continue;
    const ok = screen.routes.some((route) => patternsIntersect(route, pattern));
    if (ok) matches.push(screen);
  }
  return matches;
}

function buildReachabilityEdges(screens) {
  const edges = new Map();
  const addEdge = (from, to) => {
    if (!edges.has(from)) edges.set(from, new Set());
    edges.get(from).add(to);
  };

  const navTargets = new Set([
    ...extractNavigationTargets(readText(sideNavPath)),
    ...extractNavigationTargets(readText(appTabPath))
  ]);
  for (const target of navTargets) {
    const matchedScreens = findScreensForPattern(target, screens);
    for (const screen of matchedScreens) {
      addEdge("screen.home", screen.id);
    }
  }

  const chatTargets = Array.from(extractNavigationTargets(readText(chatPath))).filter(
    (route) => route.startsWith("/chat/") && route !== "/chat"
  );
  const chatScreens = findScreensForPattern("/chat", screens);
  for (const chatScreen of chatScreens) {
    for (const target of chatTargets) {
      const matchedScreens = findScreensForPattern(target, screens);
      for (const screen of matchedScreens) {
        addEdge(chatScreen.id, screen.id);
      }
    }
  }

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

function validateReachability(screens, actions, distances) {
  const errors = [];

  if (distances.get("screen.home") !== 0) {
    errors.push("screen.home must be the starting point with 0 steps_from_home");
  }

  for (const screen of screens.values()) {
    if (screen.id === "screen.home") continue;
    const dist = distances.get(screen.id);
    if (dist === undefined) {
      errors.push(
        `screen ${screen.id} is not reachable from screen.home using discovered navigation edges`
      );
      continue;
    }
    if (dist > screen.steps_from_home) {
      errors.push(
        `screen ${screen.id} declares steps_from_home=${screen.steps_from_home} but minimum reachable steps from screen.home is ${dist}`
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

  for (const action of actions.values()) {
    let minDist = Infinity;
    for (const screenId of action.available_on) {
      const dist = distances.get(screenId);
      if (typeof dist === "number") {
        minDist = Math.min(minDist, dist);
      }
    }
    if (!Number.isFinite(minDist)) {
      errors.push(
        `action ${action.id} is not reachable from screen.home because none of its screens are reachable`
      );
      continue;
    }
    if (minDist > action.max_steps_from_home) {
      errors.push(
        `action ${action.id} requires at least ${minDist} steps from screen.home but max_steps_from_home is ${action.max_steps_from_home}`
      );
    }
  }

  return errors;
}

function validateContract(contract, topLevelRoutes, nestedRoutes) {
  const errors = [];
  if (contract.schema_version !== "1.0") {
    errors.push(`schema_version must be "1.0" (got ${contract.schema_version})`);
  }

  if (!Array.isArray(contract.screens)) {
    errors.push("screens must be an array");
    return { errors };
  }

  const screens = new Map();
  for (const screen of contract.screens) {
    if (!screen || typeof screen.id !== "string") {
      errors.push("screen.id must be a string");
      continue;
    }
    if (screens.has(screen.id)) {
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
    screens.set(screen.id, screen);
  }

  const requiredScreens = [
    "screen.home",
    "screen.community",
    "screen.channel",
    "screen.dm_list",
    "screen.dm_thread",
    "screen.story_viewer",
    "screen.profile",
    "screen.settings"
  ];
  for (const id of requiredScreens) {
    if (!screens.has(id)) {
      errors.push(`missing required screen: ${id}`);
    }
  }

  for (const screen of screens.values()) {
    for (const route of screen.routes) {
      if (typeof route !== "string" || !route.trim()) {
        errors.push(`screen ${screen.id} has an invalid route entry`);
        continue;
      }
      if (!routePatternCovered(route, topLevelRoutes, nestedRoutes)) {
        errors.push(`route "${route}" for ${screen.id} is not covered by Solid routes`);
      }
    }
  }

  if (!Array.isArray(contract.actions)) {
    errors.push("actions must be an array");
    return { errors };
  }

  const actions = new Map();
  for (const action of contract.actions) {
    if (!action || typeof action.id !== "string") {
      errors.push("action.id must be a string");
      continue;
    }
    if (actions.has(action.id)) {
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
    actions.set(action.id, action);
  }

  const requiredActions = [
    "action.open_composer",
    "action.send_post",
    "action.open_notifications",
    "action.open_dm_thread",
    "action.send_dm",
    "action.reply",
    "action.react",
    "action.view_story",
    "action.edit_profile"
  ];
  for (const id of requiredActions) {
    if (!actions.has(id)) {
      errors.push(`missing required action: ${id}`);
    }
  }

  for (const action of actions.values()) {
    let minSteps = Infinity;
    for (const screenId of action.available_on) {
      if (!screens.has(screenId)) {
        errors.push(`action ${action.id} references unknown screen ${screenId}`);
        continue;
      }
      const steps = screens.get(screenId).steps_from_home;
      if (typeof steps === "number") {
        minSteps = Math.min(minSteps, steps);
      }
    }
    if (!Number.isFinite(minSteps)) {
      errors.push(`action ${action.id} does not resolve any screen steps_from_home`);
      continue;
    }
    if (minSteps > action.max_steps_from_home) {
      errors.push(
        `action ${action.id} requires at least ${minSteps} steps from home but max_steps_from_home is ${action.max_steps_from_home}`
      );
    }
  }

  // Plan 7.1 navigation constraints
  const home = screens.get("screen.home");
  if (home && home.steps_from_home > 1) {
    errors.push("screen.home must be reachable within 1 step from login");
  }

  const profile = screens.get("screen.profile");
  if (profile && profile.steps_from_home > 2) {
    errors.push("screen.profile must be reachable within 2 steps from screen.home");
  }

  const settings = screens.get("screen.settings");
  if (settings && settings.steps_from_home > 2) {
    errors.push("screen.settings must be reachable within 2 steps from screen.home");
  }

  const openComposer = actions.get("action.open_composer");
  if (openComposer) {
    if (!openComposer.available_on.includes("screen.home")) {
      errors.push("action.open_composer must be available on screen.home");
    }
    if (openComposer.max_steps_from_home > 1) {
      errors.push("action.open_composer must be achievable within 1 step from screen.home");
    }
  }

  const openNotifications = actions.get("action.open_notifications");
  if (openNotifications) {
    if (!openNotifications.available_on.includes("screen.home")) {
      errors.push("action.open_notifications must be available on screen.home");
    }
    if (openNotifications.max_steps_from_home > 1) {
      errors.push("action.open_notifications must be achievable within 1 step from screen.home");
    }
  }

  const dmOpen = actions.get("action.open_dm_thread");
  if (dmOpen) {
    const allowed = dmOpen.available_on.some((id) =>
      id === "screen.dm_list" || id === "screen.dm_thread"
    );
    if (!allowed) {
      errors.push("action.open_dm_thread must be available on screen.dm_list or screen.dm_thread");
    }
    if (dmOpen.max_steps_from_home > 2) {
      errors.push("action.open_dm_thread must be achievable within 2 steps from screen.home");
    }
  }

  const dmSend = actions.get("action.send_dm");
  if (dmSend) {
    const allowed = dmSend.available_on.some((id) => id === "screen.dm_thread");
    if (!allowed) {
      errors.push("action.send_dm must be available on screen.dm_thread");
    }
    if (dmSend.max_steps_from_home > 2) {
      errors.push("action.send_dm must be achievable within 2 steps from screen.home");
    }
  }

  return { errors, screens, actions };
}

function main() {
  const contract = parseJson(contractPath);
  const appRoutes = extractRoutePaths(readText(appPath));
  const nestedChatRoutes = extractNestedChatRoutes(readText(chatPath));

  const { errors, screens, actions } = validateContract(
    contract,
    appRoutes,
    nestedChatRoutes
  );

  const reachabilityEdges = buildReachabilityEdges(screens);
  const distances = computeReachability(reachabilityEdges);
  const reachErrors = validateReachability(screens, actions, distances);

  const allErrors = [...errors, ...reachErrors];
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
