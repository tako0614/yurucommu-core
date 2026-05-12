/**
 * Shared Node.js module loader and utility functions
 *
 * Provides lazy-loaded Node.js modules (better-sqlite3, fs/promises, path)
 * and common utilities used across the compatibility layer.
 */

import { Buffer } from "node:buffer";
import type BetterSqlite3 from "better-sqlite3";

type DatabaseConstructor = typeof BetterSqlite3;

let Database: DatabaseConstructor | null = null;
let fs: typeof import("fs/promises") | null = null;
let path: typeof import("path") | null = null;

export async function loadNodeModules(): Promise<void> {
  if (!Database) {
    Database = asDatabaseConstructor(await import("better-sqlite3"));
  }
  if (!fs) {
    fs = await import("fs/promises");
  }
  if (!path) {
    path = await import("path");
  }
}

function asDatabaseConstructor(module: unknown): DatabaseConstructor {
  if (typeof module !== "object" || module === null) {
    throw new Error("better-sqlite3 module must be an object");
  }
  const namespace = module as { default?: unknown };
  const candidate = typeof namespace.default === "function"
    ? namespace.default
    : module;
  if (typeof candidate !== "function") {
    throw new Error(
      "better-sqlite3 must export a Database constructor (default or namespace)",
    );
  }
  return candidate as DatabaseConstructor;
}

export function getDatabase(): DatabaseConstructor {
  return Database!;
}

export function getFs(): typeof import("fs/promises") {
  return fs!;
}

export function getPath(): typeof import("path") {
  return path!;
}

/**
 * Read a ReadableStream into a single Uint8Array.
 */
export async function drainStream(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Convert various input types to a Buffer for filesystem storage.
 */
export async function toBuffer(
  value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob,
): Promise<Buffer> {
  if (typeof value === "string") return Buffer.from(value, "utf-8");
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof Blob) return Buffer.from(await value.arrayBuffer());
  // ReadableStream
  return Buffer.from(await drainStream(value as ReadableStream<Uint8Array>));
}

/**
 * Read and parse a JSON metadata sidecar file, returning an empty object on failure.
 */
export async function readMetaFile<T extends object>(
  metaPath: string,
): Promise<T> {
  try {
    const content = await getFs().readFile(metaPath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return {} as T;
  }
}
