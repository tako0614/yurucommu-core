/**
 * Compatibility barrel: some files import "./ui" (no extension).
 * Re-export the real ui index to satisfy Deno's module resolution.
 */
export * from "./ui/index.ts";