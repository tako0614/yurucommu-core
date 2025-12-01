#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const frontendDir = path.resolve(repoRoot, "frontend");
const appPath = path.resolve(frontendDir, "src", "App.tsx");
const defaultOutPath = path.resolve(repoRoot, "takos-ui-contract.generated.json");
const manualContractPath = path.resolve(repoRoot, "takos-ui-contract.json");

function parseArgs(argv) {
  const args = {
    outPath: defaultOutPath,
    stdout: false,
    quiet: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out" || arg === "-o") {
      const next = argv[i + 1];
      if (!next) {
        throw new Error("Missing value for --out");
      }
      args.outPath = path.resolve(process.cwd(), next);
      i += 1;
    } else if (arg === "--stdout") {
      args.stdout = true;
      args.outPath = null;
    } else if (arg === "--quiet") {
      args.quiet = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    }
  }
  return args;
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function createSourceFile(filePath) {
  return ts.createSourceFile(
    filePath,
    readText(filePath),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
}

function normalizeRoutePattern(pattern) {
  if (!pattern) return pattern;
  let normalized = pattern.trim();
  normalized = normalized.replace(/\/\*$/, "");
  if (normalized === "") normalized = "/";
  return normalized;
}

function getTagName(tag) {
  if (ts.isIdentifier(tag)) return tag.text;
  if (ts.isPropertyAccessExpression(tag)) return tag.getText();
  return tag.getText();
}

function collectJsxTagNames(node, set) {
  if (!node) return;
  if (ts.isJsxElement(node)) {
    set.add(getTagName(node.openingElement.tagName));
    node.children.forEach((child) => collectJsxTagNames(child, set));
    return;
  }
  if (ts.isJsxSelfClosingElement(node)) {
    set.add(getTagName(node.tagName));
    return;
  }
  if (ts.isJsxFragment(node)) {
    node.children.forEach((child) => collectJsxTagNames(child, set));
    return;
  }
  ts.forEachChild(node, (child) => collectJsxTagNames(child, set));
}

function extractComponentNames(initializer) {
  if (!initializer) return [];
  if (ts.isStringLiteral(initializer)) {
    return [initializer.text];
  }
  if (ts.isJsxExpression(initializer) && initializer.expression) {
    const expr = initializer.expression;
    if (ts.isIdentifier(expr)) {
      return [expr.text];
    }
    if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
      const names = new Set();
      collectJsxTagNames(expr.body, names);
      return Array.from(names);
    }
  }
  return [];
}

function collectRoutesFromApp() {
  const sourceFile = createSourceFile(appPath);
  const routes = [];
  function visit(node) {
    const maybeOpening =
      ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node);
    if (maybeOpening && getTagName(node.tagName) === "Route") {
      let pathValue = null;
      let componentNames = [];
      for (const attr of node.attributes.properties) {
        if (!ts.isJsxAttribute(attr) || !attr.name) continue;
        const name = attr.name.text;
        if (name === "path" && attr.initializer) {
          if (ts.isStringLiteral(attr.initializer)) {
            pathValue = attr.initializer.text;
          } else if (
            ts.isJsxExpression(attr.initializer) &&
            attr.initializer.expression &&
            ts.isStringLiteral(attr.initializer.expression)
          ) {
            pathValue = attr.initializer.expression.text;
          }
        }
        if (name === "component") {
          componentNames = extractComponentNames(attr.initializer);
        }
      }
      if (pathValue) {
        routes.push({
          path: pathValue,
          componentNames,
          source: appPath
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return routes;
}

function collectUseMatchPatterns(filePaths) {
  const patterns = [];
  for (const filePath of filePaths) {
    const sourceFile = createSourceFile(filePath);
    const baseName = path.basename(filePath, path.extname(filePath));
    function visit(node) {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "useMatch"
      ) {
        const firstArg = node.arguments[0];
        if (firstArg && (ts.isArrowFunction(firstArg) || ts.isFunctionExpression(firstArg))) {
          const body = firstArg.body;
          if (ts.isStringLiteral(body)) {
            patterns.push({
              path: body.text,
              componentNames: [baseName],
              source: filePath
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }
  return patterns;
}

function walkTsFiles(dir) {
  const results = [];
  const ignoredDirs = new Set(["node_modules", "dist", "public", ".git", ".wrangler", "coverage", "build"]);
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) continue;
      results.push(...walkTsFiles(fullPath));
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

function buildComponentIndex(dir) {
  const index = new Map();
  const files = walkTsFiles(dir);
  for (const filePath of files) {
    const ext = path.extname(filePath);
    if (ext !== ".tsx" && ext !== ".ts") continue;
    const name = path.basename(filePath, ext);
    const list = index.get(name) || [];
    list.push(filePath);
    index.set(name, list);
  }
  return index;
}

function resolveComponentPath(componentName, index) {
  const entries = index.get(componentName);
  if (!entries || entries.length === 0) return null;
  if (entries.length === 1) return entries[0];
  const pagesEntry = entries.find((entry) => entry.includes(`${path.sep}pages${path.sep}`));
  return pagesEntry || entries[0];
}

function buildScreens(routeRecords, componentIndex) {
  const SCREEN_RULES = [
    { id: "screen.home", label: "Home Timeline", steps: 0, match: (p) => p === "/" },
    {
      id: "screen.community",
      label: "Community Hub",
      steps: 1,
      match: (p) => p === "/connections" || p.startsWith("/c/")
    },
    {
      id: "screen.channel",
      label: "Community Channel",
      steps: 2,
      match: (p) => p.startsWith("/chat/c/")
    },
    {
      id: "screen.dm_list",
      label: "Direct Messages",
      steps: 1,
      match: (p) => p === "/chat" || p === "/chat/*"
    },
    {
      id: "screen.dm_thread",
      label: "Direct Message Thread",
      steps: 2,
      match: (p) => p.startsWith("/chat/dm/")
    },
    {
      id: "screen.story_viewer",
      label: "Stories",
      steps: 1,
      match: (p) => p.startsWith("/stories")
    },
    {
      id: "screen.profile",
      label: "Profile",
      steps: 1,
      match: (p) => p.startsWith("/profile") || p.startsWith("/@")
    },
    {
      id: "screen.settings",
      label: "Settings",
      steps: 1,
      match: (p) => p.startsWith("/settings")
    }
  ];

  const screens = new Map();
  const unknownRoutes = new Set();

  for (const record of routeRecords) {
    const normalized = normalizeRoutePattern(record.path);
    if (!normalized) continue;
    const rule = SCREEN_RULES.find((item) => item.match(normalized));
    if (!rule) {
      unknownRoutes.add(normalized);
      continue;
    }
    const existing = screens.get(rule.id);
    const screen = existing || {
      id: rule.id,
      label: rule.label,
      routes: new Set(),
      components: new Set(),
      steps_from_home: rule.steps
    };
    screen.routes.add(normalized);
    for (const name of record.componentNames || []) {
      screen.components.add(name);
    }
    screen.steps_from_home = Math.min(screen.steps_from_home, rule.steps);
    screens.set(rule.id, screen);
  }

  // Resolve component file paths for later feature detection
  for (const screen of screens.values()) {
    const filePaths = Array.from(screen.components)
      .map((name) => resolveComponentPath(name, componentIndex))
      .filter(Boolean);
    screen.componentPaths = Array.from(new Set(filePaths));
  }

  return { screens, unknownRoutes };
}

function computeMaxSteps(availableOn, screens, offset) {
  const steps = availableOn
    .map((id) => screens.get(id)?.steps_from_home)
    .filter((value) => typeof value === "number");
  if (steps.length === 0) return offset;
  return Math.min(...steps) + offset;
}

function detectActions(screens, appSource) {
  const fileCache = new Map();
  const readFileCached = (filePath) => {
    if (!fileCache.has(filePath)) {
      fileCache.set(filePath, readText(filePath));
    }
    return fileCache.get(filePath);
  };

  const screenFeatures = new Map();
  for (const screen of screens.values()) {
    const featureSet = new Set();
    for (const filePath of screen.componentPaths || []) {
      const content = readFileCached(filePath);
      if (content.includes("PostCard")) {
        featureSet.add("postCard");
      }
      if (content.includes("AllStoriesBar") || content.includes("Stories")) {
        featureSet.add("stories");
      }
      if (content.includes("postDirectMessage") || content.includes("postChannelMessage")) {
        featureSet.add("messaging");
      }
      if (content.includes("EditProfile")) {
        featureSet.add("profileEdit");
      }
      if (content.includes("Settings")) {
        featureSet.add("settings");
      }
    }
    screenFeatures.set(screen.id, featureSet);
  }

  const screenIds = Array.from(screens.keys());
  const hasGlobalComposer = appSource.includes("PostComposer");
  const hasGlobalNotifications = appSource.includes("NotificationPanel");

  const actions = [];

  const addAction = (id, availableOn, offset) => {
    if (!availableOn || availableOn.length === 0) return;
    const unique = Array.from(new Set(availableOn)).sort();
    actions.push({
      id,
      available_on: unique,
      max_steps_from_home: computeMaxSteps(unique, screens, offset)
    });
  };

  if (hasGlobalComposer) {
    addAction("action.open_composer", screenIds, 1);
    addAction("action.send_post", screenIds, 2);
  } else {
    const composerScreens = screenIds.filter((id) =>
      (screenFeatures.get(id) || new Set()).has("postCard")
    );
    addAction("action.open_composer", composerScreens, 1);
    addAction("action.send_post", composerScreens, 2);
  }

  if (hasGlobalNotifications) {
    addAction("action.open_notifications", screenIds, 1);
  }

  const dmListScreens = screenIds.filter((id) => id === "screen.dm_list");
  const dmThreadScreens = screenIds.filter((id) => id === "screen.dm_thread");
  addAction("action.open_dm_thread", [...dmListScreens, ...dmThreadScreens], 1);
  addAction("action.send_dm", dmThreadScreens, 0);

  const feedScreens = screenIds.filter((id) => {
    const features = screenFeatures.get(id) || new Set();
    return features.has("postCard");
  });
  addAction("action.reply", feedScreens, 2);
  addAction("action.react", feedScreens, 1);

  const storyScreens = screenIds.filter((id) => {
    const features = screenFeatures.get(id) || new Set();
    return id === "screen.story_viewer" || features.has("stories");
  });
  addAction("action.view_story", storyScreens, 1);

  const profileScreens = screenIds.filter((id) => {
    const features = screenFeatures.get(id) || new Set();
    return id === "screen.profile" || id === "screen.settings" || features.has("profileEdit");
  });
  addAction("action.edit_profile", profileScreens, 1);

  return actions;
}

function formatContract(screens, actions) {
  const sortedScreens = Array.from(screens.values()).map((screen) => ({
    id: screen.id,
    label: screen.label,
    routes: Array.from(screen.routes).sort(),
    steps_from_home: screen.steps_from_home
  }));
  sortedScreens.sort((a, b) => a.id.localeCompare(b.id));

  const sortedActions = actions.slice().sort((a, b) => a.id.localeCompare(b.id));

  return {
    schema_version: "1.0",
    screens: sortedScreens,
    actions: sortedActions
  };
}

function diffContracts(manual, generated) {
  const warnings = [];
  const manualScreens = new Map((manual.screens || []).map((screen) => [screen.id, screen]));
  const generatedScreens = new Map(generated.screens.map((screen) => [screen.id, screen]));

  for (const [id, screen] of generatedScreens) {
    const manualScreen = manualScreens.get(id);
    if (!manualScreen) {
      warnings.push(`Manual contract is missing screen ${id}`);
      continue;
    }
    const manualRoutes = new Set(manualScreen.routes || []);
    const generatedRoutes = new Set(screen.routes || []);
    const missingRoutes = Array.from(generatedRoutes).filter((route) => !manualRoutes.has(route));
    const extraRoutes = Array.from(manualRoutes).filter((route) => !generatedRoutes.has(route));
    if (missingRoutes.length > 0) {
      warnings.push(`Screen ${id} missing routes in manual: ${missingRoutes.join(", ")}`);
    }
    if (extraRoutes.length > 0) {
      warnings.push(`Screen ${id} contains routes not detected in code: ${extraRoutes.join(", ")}`);
    }
    if (manualScreen.steps_from_home !== screen.steps_from_home) {
      warnings.push(
        `Screen ${id} steps_from_home differs (manual ${manualScreen.steps_from_home}, generated ${screen.steps_from_home})`
      );
    }
  }

  for (const id of manualScreens.keys()) {
    if (!generatedScreens.has(id)) {
      warnings.push(`Generated contract did not detect screen ${id} from manual`);
    }
  }

  const manualActions = new Map((manual.actions || []).map((action) => [action.id, action]));
  const generatedActions = new Map(generated.actions.map((action) => [action.id, action]));

  for (const [id, action] of generatedActions) {
    const manualAction = manualActions.get(id);
    if (!manualAction) {
      warnings.push(`Manual contract is missing action ${id}`);
      continue;
    }
    const manualScreensSet = new Set(manualAction.available_on || []);
    const generatedScreensSet = new Set(action.available_on || []);
    const missingScreens = Array.from(generatedScreensSet).filter(
      (screenId) => !manualScreensSet.has(screenId)
    );
    const extraScreens = Array.from(manualScreensSet).filter(
      (screenId) => !generatedScreensSet.has(screenId)
    );
    if (missingScreens.length > 0) {
      warnings.push(
        `Action ${id} missing available_on screens in manual: ${missingScreens.join(", ")}`
      );
    }
    if (extraScreens.length > 0) {
      warnings.push(
        `Action ${id} declares screens not detected in code: ${extraScreens.join(", ")}`
      );
    }
    if (manualAction.max_steps_from_home !== action.max_steps_from_home) {
      warnings.push(
        `Action ${id} max_steps_from_home differs (manual ${manualAction.max_steps_from_home}, generated ${action.max_steps_from_home})`
      );
    }
  }

  for (const id of manualActions.keys()) {
    if (!generatedActions.has(id)) {
      warnings.push(`Generated contract did not detect action ${id} from manual`);
    }
  }

  return warnings;
}

function printHelp() {
  console.log(`Usage: node frontend/scripts/generate-ui-contract.mjs [options]

Options:
  --out <path>    Write generated contract to a file (default: ${defaultOutPath})
  --stdout        Print the generated contract JSON to stdout
  --quiet         Silence informational logs (warnings are always shown)
  --help, -h      Show this help message
`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const srcDir = path.resolve(frontendDir, "src");
  const allTsFiles = walkTsFiles(srcDir);
  const routeRecords = collectRoutesFromApp();
  const useMatchRecords = collectUseMatchPatterns(allTsFiles);
  const componentIndex = buildComponentIndex(srcDir);

  const { screens, unknownRoutes } = buildScreens(
    [...routeRecords, ...useMatchRecords],
    componentIndex
  );

  const actions = detectActions(screens, readText(appPath));
  const contract = formatContract(screens, actions);

  if (args.stdout) {
    console.log(JSON.stringify(contract, null, 2));
  }
  if (args.outPath) {
    fs.writeFileSync(args.outPath, `${JSON.stringify(contract, null, 2)}\n`, "utf8");
    if (!args.quiet) {
      console.error(`Generated contract written to ${args.outPath}`);
    }
  }

  if (!args.quiet && unknownRoutes.size > 0) {
    const unknownList = Array.from(unknownRoutes).sort();
    console.error(`Found routes not mapped to UI contract: ${unknownList.join(", ")}`);
  }

  if (fs.existsSync(manualContractPath)) {
    const manual = readJson(manualContractPath);
    const warnings = diffContracts(manual, contract);
    if (warnings.length > 0) {
      console.warn("UI Contract differences detected:");
      for (const warning of warnings) {
        console.warn(`- ${warning}`);
      }
    } else if (!args.quiet) {
      console.error("Generated contract matches manual definition.");
    }
  } else {
    console.warn(`Manual contract not found at ${manualContractPath}`);
  }
}

main();
