/**
 * Filesystem path containment for the Bun/Node runtime ONLY.
 *
 * These helpers need `node:path`, so they live apart from `shared.ts`. That
 * separation is load-bearing rather than tidy: `shared.ts` is reached from
 * `edge-kv.ts` and `edge-objects.ts`, which are on the portable Worker's
 * import path. A `node:` specifier anywhere in that graph survives bundling as
 * a real static import, and a wrapper host (self-hosted Takoserver, managed
 * Workers-for-Platforms) runs the Worker with no `nodejs_compat` flag — the
 * portable `WorkerVersion` form has nowhere to ask for one — so the module
 * fails to load with `No such module "node:path"` before a single request is
 * served. Nothing in this file may be imported from a module the Worker
 * bundle reaches; `scripts/check-worker-bundle-portable.mjs` enforces that.
 */

import path from "node:path";

import { hasNulByte } from "./shared.ts";

export function isPathWithinBasePath(
  basePath: string,
  candidatePath: string,
): boolean {
  const relative = path.relative(basePath, candidatePath);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

export function resolvePathWithinBasePath(
  basePath: string,
  key: string,
): string {
  if (hasNulByte(key)) {
    throw new Error("Invalid path");
  }
  const resolvedPath = path.resolve(basePath, key);
  if (!isPathWithinBasePath(basePath, resolvedPath)) {
    throw new Error("Path escapes base directory");
  }
  return resolvedPath;
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

export async function assertPathChainWithinBasePath(
  basePath: string,
  targetPath: string,
  realpath: (path: string) => Promise<string>,
): Promise<void> {
  let currentPath = targetPath;

  while (true) {
    try {
      const realCurrentPath = await realpath(currentPath);
      if (!isPathWithinBasePath(basePath, realCurrentPath)) {
        throw new Error("Path escapes base directory");
      }
      return;
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) {
        throw error;
      }
      currentPath = parentPath;
    }
  }
}
