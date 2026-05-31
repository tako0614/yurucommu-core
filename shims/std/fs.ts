// Bun migration shim: @std/fs (and @std/fs/walk) -> node:fs based implementation.
// Wired via tsconfig.json "paths". Covers the @std/fs surface used across the
// ecosystem: the `walk` async iterator plus a few common helpers.
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";

export interface WalkEntry {
  path: string;
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
}

export interface WalkOptions {
  maxDepth?: number;
  includeFiles?: boolean;
  includeDirs?: boolean;
  includeSymlinks?: boolean;
  followSymlinks?: boolean;
  exts?: string[];
  match?: RegExp[];
  skip?: RegExp[];
}

function toWalkEntry(p: string, st: fs.Stats | fs.Dirent): WalkEntry {
  const isDirectory = "isDirectory" in st ? st.isDirectory() : false;
  const isFile = "isFile" in st ? st.isFile() : false;
  const isSymlink = "isSymbolicLink" in st ? st.isSymbolicLink() : false;
  return { path: p, name: path.basename(p), isFile, isDirectory, isSymlink };
}

/** Mirrors @std/fs `walk`: recursive async directory traversal. */
export async function* walk(
  root: string | URL,
  options: WalkOptions = {},
): AsyncIterableIterator<WalkEntry> {
  const {
    maxDepth = Infinity,
    includeFiles = true,
    includeDirs = true,
    includeSymlinks = true,
    followSymlinks = false,
    exts,
    match,
    skip,
  } = options;

  const rootPath = root instanceof URL ? root.pathname : root;

  function matches(p: string): boolean {
    if (skip && skip.some((re) => re.test(p))) return false;
    if (exts && !exts.some((e) => p.endsWith(e))) return false;
    if (match && !match.some((re) => re.test(p))) return false;
    return true;
  }

  async function* visit(dir: string, depth: number): AsyncIterableIterator<WalkEntry> {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      let isSymlink = ent.isSymbolicLink();
      let isDirectory = ent.isDirectory();
      let isFile = ent.isFile();
      if (isSymlink && followSymlinks) {
        try {
          const st = await fsp.stat(full);
          isDirectory = st.isDirectory();
          isFile = st.isFile();
        } catch { /* dangling symlink */ }
      }
      if (isDirectory) {
        if (includeDirs && matches(full)) {
          yield { path: full, name: ent.name, isFile: false, isDirectory: true, isSymlink };
        }
        if (!isSymlink || followSymlinks) {
          yield* visit(full, depth + 1);
        }
      } else if (isSymlink && !followSymlinks) {
        if (includeSymlinks && matches(full)) {
          yield { path: full, name: ent.name, isFile: false, isDirectory: false, isSymlink: true };
        }
      } else if (isFile) {
        if (includeFiles && matches(full)) {
          yield { path: full, name: ent.name, isFile: true, isDirectory: false, isSymlink };
        }
      }
    }
  }

  const rootStat = await fsp.stat(rootPath);
  if (includeDirs) yield toWalkEntry(rootPath, rootStat);
  yield* visit(rootPath, 1);
}

export async function exists(p: string | URL): Promise<boolean> {
  try {
    await fsp.stat(p);
    return true;
  } catch {
    return false;
  }
}

export function existsSync(p: string | URL): boolean {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(p: string | URL): Promise<void> {
  await fsp.mkdir(p, { recursive: true });
}

export function ensureDirSync(p: string | URL): void {
  fs.mkdirSync(p, { recursive: true });
}

export async function copy(src: string | URL, dest: string | URL): Promise<void> {
  await fsp.cp(src, dest, { recursive: true });
}
