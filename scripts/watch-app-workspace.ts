import chokidar from "chokidar";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  AppHandlerRegistry,
  loadAppManifest,
  type AppManifest,
  type AppManifestValidationIssue,
} from "@takos/platform/app";

type CliOptions = {
  root?: string;
  previewDir?: string;
  debounceMs?: number;
  workspaceId?: string;
};

type HandlerInfo = {
  handlers: Set<string>;
  appMainPath?: string | null;
  notes: string[];
};

type PreviewIndexEntry = {
  screenId: string;
  file?: string;
  warnings?: string[];
  error?: string;
};

type UiNode = {
  type: string;
  id?: string;
  props?: Record<string, unknown>;
  children?: UiNode[];
};

const DEFAULT_ROOT = path.resolve(process.cwd(), "dev/workspace");
const args = parseArgs(process.argv.slice(2));
const workspaceRoot = path.resolve(args.root ?? DEFAULT_ROOT);
const previewDir = path.resolve(args.previewDir ?? path.join(workspaceRoot, ".preview"));
const debounceMs = Math.max(50, Number(args.debounceMs ?? 200));
const workspaceId = args.workspaceId || path.basename(workspaceRoot);

let pendingRun: NodeJS.Timeout | null = null;

log(`dev workspace: ${workspaceRoot}`);
log(`preview output: ${previewDir}`);
log(`watching: takos-app.json, app/**/*.json, app-main.*`);

const watcher = chokidar.watch(
  [
    path.join(workspaceRoot, "takos-app.json"),
    path.join(workspaceRoot, "app/**/*.json"),
    path.join(workspaceRoot, "app-main.@(js|ts|mjs|cjs|tsx)"),
  ],
  {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 60 },
  },
);

watcher.on("ready", () => runValidation("initial scan"));
watcher.on("all", (_, filePath) => {
  const rel = path.relative(workspaceRoot, filePath);
  scheduleRun(rel || filePath);
});
watcher.on("error", (error) => {
  console.error("[app-watch] watcher error", error);
});

process.on("SIGINT", () => {
  log("stopping watcher");
  void watcher.close();
  process.exit(0);
});

function scheduleRun(reason: string) {
  if (pendingRun) {
    clearTimeout(pendingRun);
  }
  pendingRun = setTimeout(() => runValidation(reason), debounceMs);
}

async function runValidation(reason: string) {
  pendingRun = null;
  const started = Date.now();
  log(`change detected (${reason}) -> validating...`);
  try {
    const handlerInfo = await collectHandlers(workspaceRoot);
    const manifestResult = await loadAppManifest({
      source: createFsSource(workspaceRoot),
      rootDir: workspaceRoot,
      availableHandlers: handlerInfo.handlers,
    });

    await persistValidationSummary(manifestResult.issues, handlerInfo);

    const errors = manifestResult.issues.filter((issue) => issue.severity === "error");
    if (!manifestResult.manifest || errors.length > 0) {
      logIssues(manifestResult.issues);
      return;
    }

    const screens = manifestResult.manifest.views?.screens ?? [];
    const previews = await emitPreviews(manifestResult.manifest, handlerInfo.notes);
    const duration = Date.now() - started;
    log(
      `ok (${screens.length} screens, ${handlerInfo.handlers.size} handlers, ${manifestResult.issues.length} issues) in ${duration}ms`,
    );
    if (previews.errors > 0) {
      log(`preview generation warnings: ${previews.errors}`);
    }
  } catch (error) {
    console.error("[app-watch] validation failed", error);
  }
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

async function collectHandlers(root: string): Promise<HandlerInfo> {
  const appMainPath = await findAppMain(root);
  if (!appMainPath) {
    return { handlers: new Set(), appMainPath: null, notes: ["app-main not found"] };
  }

  const notes: string[] = [];
  const specifier = `${pathToFileURL(appMainPath).href}?t=${Date.now()}`;
  try {
    const loaded = await import(specifier);
    const registry = AppHandlerRegistry.fromModule(loaded as Record<string, unknown>);
    return {
      handlers: new Set(registry.list()),
      appMainPath,
      notes,
    };
  } catch (error) {
    notes.push(`module import failed (${(error as Error).message}); falling back to static scan`);
    const fallback = await scanHandlers(appMainPath);
    return {
      handlers: fallback,
      appMainPath,
      notes,
    };
  }
}

async function findAppMain(root: string): Promise<string | null> {
  const candidates = ["app-main.ts", "app-main.tsx", "app-main.js", "app-main.mjs", "app-main.cjs"];
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
  const exportDefault = /export\s+default\s*{([^}]+)}/gs;

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
  for (const match of source.matchAll(exportDefault)) {
    const objectBody = match[1];
    const props = objectBody
      .split(",")
      .map((chunk) => chunk.trim().split(":")[0]?.split(/\s+as\s+/i)[0])
      .filter(Boolean);
    props.forEach((name) => handlers.add(name));
  }

  return handlers;
}

async function persistValidationSummary(
  issues: AppManifestValidationIssue[],
  handlers: HandlerInfo,
): Promise<void> {
  const summary = {
    workspaceId,
    workspaceRoot,
    appMain: handlers.appMainPath ?? null,
    handlerCount: handlers.handlers.size,
    handlerNotes: handlers.notes,
    issues,
    generatedAt: new Date().toISOString(),
  };

  await fs.mkdir(previewDir, { recursive: true });
  await fs.writeFile(path.join(previewDir, "validation.json"), JSON.stringify(summary, null, 2));
}

async function emitPreviews(
  manifest: AppManifest,
  handlerNotes: string[],
): Promise<{ errors: number }> {
  const screens = Array.isArray(manifest.views?.screens) ? manifest.views.screens : [];
  const index: PreviewIndexEntry[] = [];
  let errorCount = 0;

  await fs.mkdir(previewDir, { recursive: true });

  for (const screen of screens) {
    try {
      const preview = resolveScreenPreview(manifest, screen.id);
      const safeName = screenIdToFile(screen.id);
      const fileName = `screen.${safeName}.json`;
      const filePath = path.join(previewDir, fileName);
      await fs.writeFile(
        filePath,
        JSON.stringify(
          {
            workspaceId,
            screenId: preview.screenId,
            warnings: preview.warnings,
            resolvedTree: preview.resolvedTree,
          },
          null,
          2,
        ),
      );
      index.push({ screenId: screen.id, file: fileName, warnings: preview.warnings });
    } catch (error) {
      errorCount += 1;
      index.push({ screenId: screen.id, error: (error as Error).message });
    }
  }

  const indexPayload = {
    workspaceId,
    workspaceRoot,
    handlerNotes,
    generatedAt: new Date().toISOString(),
    screens: index,
  };
  await fs.writeFile(path.join(previewDir, "index.json"), JSON.stringify(indexPayload, null, 2));

  return { errors: errorCount };
}

function resolveScreenPreview(manifest: AppManifest, screenId: string) {
  const screens = Array.isArray(manifest.views?.screens) ? manifest.views.screens : [];
  const screen = screens.find((item) => item.id === screenId);
  if (!screen) {
    throw new Error(`screen not found: ${screenId}`);
  }
  if (!screen.layout) {
    throw new Error(`screen ${screenId} is missing layout`);
  }

  const baseTree = cloneNode(screen.layout as UiNode);
  const inserts = Array.isArray(manifest.views?.insert) ? manifest.views.insert : [];
  const ordered = inserts
    .filter((entry) => entry && entry.screen === screenId)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const warnings: string[] = [];
  for (const insert of ordered) {
    const targets = findTargets(baseTree, insert.position);
    if (targets.length === 0) {
      warnings.push(`insert skipped: position "${insert.position || "root"}" not found`);
      continue;
    }
    for (const target of targets) {
      const nextNode = cloneNode(insert.node as UiNode);
      const children = Array.isArray(target.children) ? target.children : [];
      target.children = [...children, nextNode];
    }
  }

  return { screenId: screen.id, resolvedTree: baseTree, warnings };
}

function findTargets(root: UiNode, position?: string): UiNode[] {
  if (!position) return [root];
  const matches: UiNode[] = [];

  const walk = (node: UiNode) => {
    if (matchPosition(node, position)) {
      matches.push(node);
    }
    if (Array.isArray(node.children)) {
      node.children.forEach((child) => walk(child));
    }
  };

  walk(root);
  return matches;
}

function matchPosition(node: UiNode, position: string): boolean {
  if (!position) return false;
  const props = node.props || {};
  return (
    node.id === position ||
    props.id === position ||
    props.slot === position ||
    props.position === position ||
    props.region === position
  );
}

function cloneNode<T>(node: T): T {
  try {
    // @ts-ignore structuredClone is available in Node 18+
    return structuredClone(node);
  } catch {
    return JSON.parse(JSON.stringify(node)) as T;
  }
}

function screenIdToFile(screenId: string): string {
  const normalized = screenId.replace(/[^a-zA-Z0-9_-]+/g, "_");
  return normalized.length > 0 ? normalized : "screen";
}

function logIssues(issues: AppManifestValidationIssue[]): void {
  if (!issues.length) return;
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  if (errors.length) {
    console.error(`[app-watch] validation errors (${errors.length}):`);
    errors.forEach((issue) => {
      console.error(`  - ${formatIssue(issue)}`);
    });
  }
  if (warnings.length) {
    console.warn(`[app-watch] validation warnings (${warnings.length}):`);
    warnings.forEach((issue) => {
      console.warn(`  - ${formatIssue(issue)}`);
    });
  }
}

function formatIssue(issue: AppManifestValidationIssue): string {
  const location = [issue.file, issue.path].filter(Boolean).join("#");
  return `${issue.message}${location ? ` [${location}]` : ""}`;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--root":
      case "-r":
        options.root = argv[i + 1];
        i += 1;
        break;
      case "--preview":
      case "-p":
        options.previewDir = argv[i + 1];
        i += 1;
        break;
      case "--debounce":
        options.debounceMs = Number(argv[i + 1]);
        i += 1;
        break;
      case "--workspace":
      case "-w":
        options.workspaceId = argv[i + 1];
        i += 1;
        break;
      default:
        break;
    }
  }
  return options;
}

function log(message: string) {
  console.log(`[app-watch] ${message}`);
}
