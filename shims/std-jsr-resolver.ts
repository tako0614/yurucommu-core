// Bun migration shim: resolve `jsr:@std/*` import specifiers to local shims.
//
// yurucommu test files import std via the JSR scheme, e.g.
//   import { assertEquals } from "jsr:@std/assert";
//   import { ... } from "jsr:@std/assert@1.0.19";   // version-pinned
//   import { FakeTime } from "jsr:@std/testing/time";
//   import { ... } from "jsr:@std/testing/mock";
//   import { ... } from "jsr:@std/fmt/colors";
//
// tsconfig "paths" covers the unversioned forms, but Bun does not honor a
// `paths` key that contains an `@version` segment in the specifier. Rather than
// edit the test sources, register a Bun resolver plugin (loaded via bunfig
// preload) that strips the `jsr:` scheme and any `@version`, then maps the
// std subpath to the corresponding shim file. Idempotent.

import { plugin } from "bun";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const shimsDir = dirname(fileURLToPath(import.meta.url));

// std subpath (after @std/) -> shim file, relative to this shims dir.
const STD_MAP: Record<string, string> = {
  "assert": "std/assert.ts",
  "assert/equals": "std/assert/equals.ts",
  "fmt/colors": "std/colors.ts",
  "testing/mock": "std/mock.ts",
  "testing/time": "std/time.ts",
};

const g = globalThis as unknown as { __yuruStdJsrResolver?: boolean };
if (!g.__yuruStdJsrResolver) {
  g.__yuruStdJsrResolver = true;
  plugin({
    name: "jsr-std-resolver",
    setup(build) {
      // Match any specifier that begins with the JSR std scheme.
      build.onResolve({ filter: /^jsr:@std\// }, (args) => {
        // Strip leading "jsr:@std/" and any trailing "@<version>".
        let spec = args.path.slice("jsr:@std/".length);
        // Remove a version on the package root, e.g. "assert@1.0.19" or
        // "assert@1.0.19/equals".
        spec = spec.replace(/@\d[\w.\-]*(?=$|\/)/, "");
        const target = STD_MAP[spec];
        if (!target) {
          throw new Error(
            `jsr-std-resolver: no shim mapping for jsr:@std/${spec} (from ${args.importer})`,
          );
        }
        return { path: join(shimsDir, target) };
      });
    },
  });
}
