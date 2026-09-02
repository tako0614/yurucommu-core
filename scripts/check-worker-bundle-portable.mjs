#!/usr/bin/env bun

/**
 * The published Worker export must load on a host that grants NO compatibility
 * flags.
 *
 * A wrapper host — a self-hosted Takoserver, or a managed Workers-for-Platforms
 * backend — publishes this bundle through a Takoform `WorkerVersion`, and that
 * form carries no compatibility flag at all (Takoserver decision 0019). The
 * generated workerd config therefore has `compatibilityFlags =
 * ["disallow_importable_env"]` and nothing else: no `nodejs_compat`, and no
 * portable way to ask for it. workerd resolves every STATIC import when it
 * instantiates the module, so one `import x from "node:…"` anywhere in the
 * graph — even an import whose binding is never read — makes the whole Worker
 * unloadable with
 *
 *     Uncaught exception: remote.jsg.Error: No such module "node:path".
 *
 * That is not a hypothetical: `@takosjp/yurucommu-core@4.1.0` shipped exactly
 * that dead `node:path` import (reached through `runtime/shared.ts`), and the
 * Host reported it as "the Worker Version's module does not export every
 * handler it declares", which points an operator at the wrong file entirely.
 *
 * So this gate bundles the published export the way a wrapper host does and
 * refuses:
 *
 *   - any STATIC `node:` import — the load-time failure above;
 *   - a `require("…")` call with a literal specifier — CommonJS does not exist
 *     on this runtime (the bundler's own unreachable `__require` throw-helper
 *     is not that, and is ignored);
 *   - a bare `process.` / `process[` member access — `process` is a global only
 *     under `nodejs_compat`; a capability PROBE written as `globalThis.process`
 *     is fine and is how this repo asks the question.
 *
 * A LAZY `import("node:…")` is a different thing and is allowed only from
 * {@link ALLOWED_LAZY_NODE_MODULES}. workerd resolves a dynamic import when it
 * is evaluated, not when the module loads, so one that is unreachable on this
 * runtime costs nothing — but each one has to be argued for here rather than
 * appearing by accident.
 */

/**
 * Lazy `node:` imports the portable Worker is allowed to carry, and why.
 *
 * `node:dns/promises` — `lib/ssrf.ts` validates a federation target with the
 * SAME resolver `fetch` will connect with, so that an attacker who controls
 * authoritative DNS cannot serve a public address to the validator and a
 * private one to the connection. On Bun/Node that resolver is the host OS's,
 * reached through `node:dns`. The call sits behind a `globalThis.process`
 * probe, which is absent on a wrapper host, so the import is never evaluated
 * there and the lane falls back to DoH — which is the right answer on a Worker,
 * where there is no host-OS resolver to diverge from in the first place.
 */
const ALLOWED_LAZY_NODE_MODULES = new Set(["node:dns/promises"]);

const repoRoot = new URL("../", import.meta.url);
const corePackage = await Bun.file(new URL("package.json", repoRoot)).json();

/**
 * Bundle the entry a consumer actually publishes, read off the manifest rather
 * than hardcoded, so renaming the export cannot silently retire this gate.
 */
const exported = corePackage.exports?.["./server"];
if (typeof exported !== "string") {
  throw new Error(
    'package.json exports["./server"] must be a single module path.',
  );
}
const entrypoint = new URL(exported, repoRoot).pathname;

// The same shape a wrapper host's build has: a browser-platform ESM bundle with
// the workerd conditions, and `node:*` left EXTERNAL. The external marking is
// what makes this faithful — a bundler that silently polyfills `node:path`
// would hide the very defect this gate exists to catch.
const built = await Bun.build({
  entrypoints: [entrypoint],
  target: "browser",
  format: "esm",
  conditions: ["workerd", "worker"],
  external: ["node:*", "cloudflare:*"],
});
if (!built.success) {
  console.error(built.logs.join("\n"));
  throw new Error(`Failed to bundle ${exported} for the portable Worker lane.`);
}
if (built.outputs.length !== 1) {
  throw new Error(
    `Expected one bundle for ${exported}, got ${built.outputs.length}.`,
  );
}
const bundle = await built.outputs[0].text();

const problems = [];

// `import … from "node:x"`, `import "node:x"`, `export … from "node:x"`. Any
// occurrence of a `node:` specifier that is NOT the argument of a dynamic
// `import(` is treated as static, so a form this regex does not enumerate still
// fails closed.
for (const match of bundle.matchAll(/["'](node:[^"']+)["']/g)) {
  const specifier = match[1];
  const before = bundle.slice(Math.max(0, match.index - 16), match.index);
  const isLazyImport = /\bimport\s*\(\s*$/.test(before);
  if (!isLazyImport) {
    problems.push(
      `Static \`node:\` specifier ${JSON.stringify(specifier)} in the Worker ` +
        `bundle. workerd resolves static imports at load; a host that grants ` +
        `no \`nodejs_compat\` refuses the whole module. Move the code that ` +
        `needs it out of the portable graph (see runtime/node-paths.ts).`,
    );
    continue;
  }
  if (!ALLOWED_LAZY_NODE_MODULES.has(specifier)) {
    problems.push(
      `Lazy \`import(${JSON.stringify(specifier)})\` in the Worker bundle is ` +
        `not one of the allowed host-platform seams ` +
        `(${[...ALLOWED_LAZY_NODE_MODULES].join(", ")}). Add it to ` +
        `ALLOWED_LAZY_NODE_MODULES with the reason it can never be evaluated ` +
        `on a wrapper host, or move it off the portable graph.`,
    );
  }
}

for (const match of bundle.matchAll(/(?<![.\w$])require\s*\(\s*["']/g)) {
  problems.push(
    `A \`require(\` call with a literal specifier at offset ${match.index}. ` +
      `The portable Worker is an ES module on a runtime with no CommonJS.`,
  );
}

for (const match of bundle.matchAll(/(?<![.\w$])process\s*(?:\.|\[)/g)) {
  const line = bundle.slice(
    bundle.lastIndexOf("\n", match.index) + 1,
    bundle.indexOf("\n", match.index),
  );
  problems.push(
    `A bare \`process\` member access, which throws on a host without ` +
      `\`nodejs_compat\`: ${line.trim().slice(0, 160)}. Probe it as ` +
      `\`globalThis.process\` instead.`,
  );
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Portable Worker bundle clean: ${exported} bundles to ` +
      `${(bundle.length / 1024).toFixed(0)} KiB with no static \`node:\` ` +
      `import, no literal \`require\`, and no bare \`process\` — it needs no ` +
      `compatibility flags.`,
  );
}
