#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  AppHandlerRegistry,
  loadAppManifest,
  parseUiContractJson,
  validateUiContractAgainstManifest,
  type AppManifestValidationIssue,
  type UiContract,
} from "@takos/platform/app";
import { validateAppSchemaVersion } from "@takos/platform/app/manifest";

type CliOptions = {
  root: string;
};

type HandlerInfo = {
  handlers: Set<string>;
  appMainPath: string | null;
  notes: string[];
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const workspaceRoot = path.resolve(process.cwd(), options.root);

  const handlerInfo = await collectHandlers(workspaceRoot);
  const manifestResult = await loadAppManifest({
    source: createFsSource(workspaceRoot),
    rootDir: workspaceRoot,
    availableHandlers: handlerInfo.handlers,
  });

  const issues: AppManifestValidationIssue[] = [...manifestResult.issues];

  const uiContract = await loadUiContract(workspaceRoot);
  issues.push(...uiContract.issues);

  if (manifestResult.manifest) {
    const hasSchemaIssues = issues.some((issue) => issue.path === "schema_version");
    if (!hasSchemaIssues) {
      const schemaCheck = validateAppSchemaVersion(manifestResult.manifest);
      if (!schemaCheck.ok) {
        issues.push({
          severity: "error",
          message: schemaCheck.error || "app manifest schema_version is not compatible",
          file: path.join(workspaceRoot, "takos-app.json"),
          path: "schema_version",
        });
      }
      issues.push(
        ...schemaCheck.warnings.map((message) => ({
          severity: "warning",
          message,
          file: path.join(workspaceRoot, "takos-app.json"),
          path: "schema_version",
        })),
      );
    }

    issues.push(
      ...validateUiContractAgainstManifest(
        manifestResult.manifest,
        uiContract.contract,
        uiContract.source,
      ),
    );
  }
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");

  const summary = {
    ok: errors.length === 0 && Boolean(manifestResult.manifest),
    workspaceRoot,
    workspaceId: path.basename(workspaceRoot),
    schemaVersion: manifestResult.manifest?.schemaVersion ?? null,
    manifestVersion: manifestResult.manifest?.version ?? null,
    layout: manifestResult.layout ?? null,
    appMain: handlerInfo.appMainPath,
    handlerCount: handlerInfo.handlers.size,
    handlerNotes: handlerInfo.notes,
    uiContract: uiContract.source ?? null,
    issueCounts: { errors: errors.length, warnings: warnings.length },
    issues,
    generatedAt: new Date().toISOString(),
  };

  const label = `[validate:app] ${summary.ok ? "ok" : "failed"}`;
  console.error(`${label} (${errors.length} errors, ${warnings.length} warnings)`);

  process.stdout.write(JSON.stringify(summary, null, 2));
  process.stdout.write("\n");
  process.exit(summary.ok ? 0 : 1);
}

function parseArgs(argv: string[]): CliOptions {
  let root: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--root":
      case "-r":
        root = argv[i + 1];
        i += 1;
        break;
      default:
        break;
    }
  }
  return { root: root || "." };
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
    return {
      handlers: new Set(),
      appMainPath: null,
      notes: ["app-main not found; handler linking checks will fail"],
    };
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
    notes.push(`app-main import failed (${(error as Error).message}); falling back to static scan`);
    try {
      const fallback = await scanHandlers(appMainPath);
      return {
        handlers: fallback,
        appMainPath,
        notes,
      };
    } catch (scanError) {
      notes.push(`static handler scan failed (${(scanError as Error).message})`);
      return {
        handlers: new Set(),
        appMainPath,
        notes,
      };
    }
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

async function loadUiContract(
  root: string,
): Promise<{ contract: UiContract | null; issues: AppManifestValidationIssue[]; source?: string }> {
  const issues: AppManifestValidationIssue[] = [];
  const contractPath = path.join(root, "takos-ui-contract.json");
  const defaultPath = path.resolve(process.cwd(), "takos-ui-contract.json");

  const parseFromFile = async (filePath: string, label: string): Promise<UiContract | null> => {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = parseUiContractJson(raw, label);
      issues.push(...parsed.issues);
      return parsed.contract ?? null;
    } catch {
      return null;
    }
  };

  const fromWorkspace = await parseFromFile(contractPath, "takos-ui-contract.json");
  if (fromWorkspace) {
    return { contract: fromWorkspace, issues, source: "takos-ui-contract.json" };
  }

  const fallback = await parseFromFile(defaultPath, "takos-ui-contract.json (default)");
  if (fallback) {
    issues.push({
      severity: "warning",
      message: "takos-ui-contract.json not found in workspace; using default contract",
      file: contractPath,
    });
    return { contract: fallback, issues, source: path.relative(root, defaultPath) || defaultPath };
  }

  issues.push({
    severity: "warning",
    message: "takos-ui-contract.json not found; skipping UI contract validation",
    file: contractPath,
  });

  return { contract: null, issues, source: undefined };
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[validate:app] unexpected failure: ${message}`);
  process.exit(1);
});
