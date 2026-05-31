// @std/assert/equals subpath replacement for bun migration.
// Re-exports assertEquals from the canonical @std/assert shim so the nested
// specifier "@std/assert/equals" resolves under bun without tsconfig path quirks.
export { assertEquals } from "../assert.ts";
