import { readdir, readFile } from "node:fs/promises";
import { argv, env } from "node:process";

type Options = {
  resource: string;
  migrationsDir: string;
  space?: string;
};

function parseArgs(args: string[]): Options {
  const options: Options = {
    resource: env.TAKOS_D1_RESOURCE ?? "yurucommu-db",
    migrationsDir: env.MIGRATIONS_DIR ?? "migrations",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--resource" && next) {
      options.resource = next;
      index += 1;
      continue;
    }
    if (arg === "--migrations-dir" && next) {
      options.migrationsDir = next;
      index += 1;
      continue;
    }
    if (arg === "--space" && next) {
      options.space = next;
      index += 1;
      continue;
    }
    throw new Error(`Unknown or incomplete argument: ${arg}`);
  }

  return options;
}

async function listMigrationFiles(migrationsDir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(migrationsDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".sql")) {
      files.push(entry.name);
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

async function runTakosSql(
  options: Options,
  file: string,
  sql: string,
): Promise<void> {
  const args = ["resource", "sql", "query"];
  if (options.space) args.push("--space", options.space);
  args.push(options.resource, sql);

  console.log(`[app:migrate] Applying ${file} to ${options.resource}`);
  const child = Bun.spawn(["takos", ...args], {
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await child.exited;
  if (code !== 0) {
    throw new Error(`Migration failed: ${file}`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(argv.slice(2));
  const files = await listMigrationFiles(options.migrationsDir);
  if (files.length === 0) {
    throw new Error(`No .sql migrations found in ${options.migrationsDir}`);
  }

  for (const file of files) {
    const path = `${options.migrationsDir.replace(/\/+$/, "")}/${file}`;
    const sql = await readFile(path, "utf8");
    await runTakosSql(options, file, sql);
  }
}

await main();
