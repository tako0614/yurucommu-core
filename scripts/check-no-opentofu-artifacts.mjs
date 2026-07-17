import { readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const ignoredDirectories = new Set([".git", "dist", "node_modules"]);
const forbiddenExactPaths = new Set([
  ".terraform.lock.hcl",
  ".well-known/tcs.json",
  "terraform.tfstate",
  "terraform.tfstate.backup",
]);

function isOpenTofuArtifact(path) {
  return (
    forbiddenExactPaths.has(path) ||
    path.endsWith(".tf") ||
    path.endsWith(".tf.json") ||
    path.endsWith(".tfvars") ||
    path.endsWith(".tfvars.json")
  );
}

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(absolutePath)));
    } else if (entry.isFile()) {
      files.push(relative(root, absolutePath));
    }
  }
  return files;
}

const forbidden = (await collectFiles(root)).filter(isOpenTofuArtifact).sort();
if (forbidden.length > 0) {
  throw new Error(
    `yurucommu-core is a library and must not contain OpenTofu or Capsule metadata:\n${forbidden.join("\n")}`,
  );
}

console.log(
  "Verified yurucommu-core contains no OpenTofu or Capsule artifacts.",
);
