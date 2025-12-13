#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

type Hit = {
  file: string;
  specifier: string;
};

type ServiceReport = {
  name: string;
  module: string;
  hits: Hit[];
};

// NOTE: 以下の Service は App 層に完全移行済み (app/default/src/server.ts)
// - CommunityService
// - DMService
// - StoryService
// - BlockMuteService
const SERVICE_MODULE_MARKERS = [
  { name: "PostService.timeline", marker: "post-service" },
];

const SOURCE_DIRS = ["api/src", "platform/src", "backend/src"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);

const IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  ".tmp",
  ".wrangler",
  ".turbo",
  ".vite",
  "coverage",
]);

async function main() {
  process.stdout.on("error", (error: any) => {
    if (error?.code === "EPIPE") {
      process.exit(0);
    }
    throw error;
  });

  const root = process.cwd();
  const files = (
    await Promise.all(
      SOURCE_DIRS.map(async (dir) => {
        const abs = path.join(root, dir);
        return listSourceFiles(abs);
      }),
    )
  ).flat();

  const reports = new Map<string, ServiceReport>();
  for (const service of SERVICE_MODULE_MARKERS) {
    reports.set(service.name, {
      name: service.name,
      module: `platform/src/app/services/${service.marker}.ts`,
      hits: [],
    });
  }

  for (const filePath of files) {
    const rel = path.relative(root, filePath).replace(/\\/g, "/");
    const text = await fs.readFile(filePath, "utf8");
    const specifiers = extractModuleSpecifiers(text);
    if (specifiers.length === 0) continue;

    for (const service of SERVICE_MODULE_MARKERS) {
      const match = specifiers.filter((specifier) => specifier.includes(service.marker));
      if (match.length === 0) continue;

      const report = reports.get(service.name);
      if (!report) continue;
      match.forEach((specifier) => {
        report.hits.push({ file: rel, specifier });
      });
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    root,
    sources: SOURCE_DIRS,
    services: Array.from(reports.values())
      .map((report) => ({
        ...report,
        hitCount: report.hits.length,
        importers: Array.from(new Set(report.hits.map((hit) => hit.file))).sort(),
      }))
      .sort((a, b) => b.hitCount - a.hitCount),
  };

  process.stdout.write(JSON.stringify(output, null, 2));
  process.stdout.write("\n");
}

function extractModuleSpecifiers(source: string): string[] {
  const specifiers: string[] = [];

  const staticImport = /\bfrom\s+["']([^"']+)["']/g;
  const dynamicImport = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  const requireCall = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;

  for (const match of source.matchAll(staticImport)) specifiers.push(match[1]);
  for (const match of source.matchAll(dynamicImport)) specifiers.push(match[1]);
  for (const match of source.matchAll(requireCall)) specifiers.push(match[1]);

  return specifiers;
}

async function listSourceFiles(rootDir: string): Promise<string[]> {
  const out: string[] = [];
  await walk(rootDir, out);
  return out;
}

async function walk(dir: string, out: string[]): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      await walk(path.join(dir, entry.name), out);
      continue;
    }

    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name);
    if (!SOURCE_EXTENSIONS.has(ext)) continue;
    out.push(path.join(dir, entry.name));
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[audit-core-app-boundary] failed: ${message}`);
  process.exit(1);
});
