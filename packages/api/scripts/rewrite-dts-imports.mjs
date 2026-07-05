import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(path)));
    } else if (entry.isFile() && entry.name.endsWith(".d.ts")) {
      files.push(path);
    }
  }
  return files;
}

for (const file of await walk(
  fileURLToPath(new URL("../dist", import.meta.url)),
)) {
  const source = await readFile(file, "utf8");
  const rewritten = source.replace(/\.ts(["'])/g, ".js$1");
  if (rewritten !== source) {
    await writeFile(file, rewritten);
  }
}
