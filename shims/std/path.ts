// Bun migration shim: @std/path -> node:path (+ node:url for file URL helpers).
// Wired via tsconfig.json "paths". Covers the @std/path surface used across the
// ecosystem. Deno's @std/path defaults to POSIX semantics on POSIX hosts, which
// matches node:path on Linux.
import * as nodePath from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const join = nodePath.join;
export const resolve = nodePath.resolve;
export const dirname = nodePath.dirname;
export const basename = nodePath.basename;
export const extname = nodePath.extname;
export const normalize = nodePath.normalize;
export const relative = nodePath.relative;
export const isAbsolute = nodePath.isAbsolute;
export const parse = nodePath.parse;
export const format = nodePath.format;
export const SEPARATOR = nodePath.sep;
export const SEP = nodePath.sep;
export const delimiter = nodePath.delimiter;

export function fromFileUrl(url: string | URL): string {
  return fileURLToPath(url);
}

export function toFileUrl(path: string): URL {
  return pathToFileURL(path);
}

/** @std/path `globToRegExp` is rarely used; provide a minimal best-effort. */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "::GLOBSTAR::")
    .replace(/\*/g, "[^/]*")
    .replace(/::GLOBSTAR::/g, ".*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}$`);
}

export default {
  join,
  resolve,
  dirname,
  basename,
  extname,
  normalize,
  relative,
  isAbsolute,
  parse,
  format,
  fromFileUrl,
  toFileUrl,
  SEPARATOR,
  SEP,
  delimiter,
  globToRegExp,
};
