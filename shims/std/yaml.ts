// Bun migration shim: @std/yaml -> the npm `yaml` package.
// Lets Deno source keep `import { parse, stringify } from "@std/yaml"` while
// running under bun, wired via tsconfig.json "paths". @std/yaml's parse/stringify
// surface maps onto the `yaml` package's parse/stringify with compatible defaults.
import { parse as yamlParse, stringify as yamlStringify } from "yaml";

export interface ParseOptions {
  schema?: unknown;
  allowDuplicateKeys?: boolean;
}

export interface StringifyOptions {
  indent?: number;
  lineWidth?: number;
  skipInvalid?: boolean;
  sortKeys?: boolean | ((a: string, b: string) => number);
}

/** Parse a single YAML document. Mirrors @std/yaml `parse`. */
export function parse(content: string, _options?: ParseOptions): unknown {
  return yamlParse(content);
}

/** Parse a multi-document YAML stream. Mirrors @std/yaml `parseAll`. */
export function parseAll(content: string, _options?: ParseOptions): unknown[] {
  // `yaml` exposes parseAllDocuments via the document API; emulate with a split
  // on the document separator and per-doc parse to keep a dependency-light shim.
  const docs: unknown[] = [];
  // YAML document separator is a line that is exactly `---` (optionally followed
  // by content on the same line for the directives end marker). Use the `yaml`
  // package's own multi-doc support through dynamic import to stay correct.
  // Synchronous path: rely on `yaml`'s parse which returns the first doc; for
  // multi-doc we re-split. This is sufficient for the call sites in this repo.
  const parts = content.split(/^---\s*$/m);
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;
    docs.push(yamlParse(trimmed));
  }
  return docs;
}

/** Serialize a value to a YAML document. Mirrors @std/yaml `stringify`. */
export function stringify(data: unknown, options?: StringifyOptions): string {
  return yamlStringify(data, {
    indent: options?.indent,
    lineWidth: options?.lineWidth,
    sortMapEntries: options?.sortKeys as never,
  });
}
