import { readdir, readFile } from "node:fs/promises";
import { argv, env } from "node:process";

export type SqlExecutionContext = {
  resource: string;
  migration?: string;
  purpose: "ledger-init" | "ledger-read" | "migration";
};

export type SqlExecutor = (
  sql: string,
  context: SqlExecutionContext,
) => Promise<unknown>;

export const MIGRATION_LEDGER_TABLE = "yurucommu_migrations";

export type Options = {
  resource: string;
  migrationsDir: string;
  space?: string;
  wrapTransactions?: boolean;
  sqlCommand?: readonly string[];
  sqlCommandTemplate?: readonly string[];
  executeSql?: SqlExecutor;
};

export function parseArgs(args: string[]): Options {
  const options: Options = {
    resource:
      env.YURUCOMMU_SQL_RESOURCE ??
      env.TAKOS_RESOURCE ??
      env.TAKOS_D1_RESOURCE ??
      "database",
    migrationsDir: env.MIGRATIONS_DIR ?? "migrations",
    sqlCommand: parseSqlCommandEnv(env.YURUCOMMU_SQL_COMMAND_JSON),
    sqlCommandTemplate: parseSqlCommandEnv(
      env.YURUCOMMU_SQL_COMMAND_TEMPLATE_JSON,
    ),
    wrapTransactions: parseBooleanEnv(
      env.YURUCOMMU_SQL_WRAP_TRANSACTIONS,
      true,
    ),
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
    if (arg === "--sql-command-json" && next) {
      options.sqlCommand = parseSqlCommandEnv(next);
      index += 1;
      continue;
    }
    if (arg === "--sql-command-template-json" && next) {
      options.sqlCommandTemplate = parseSqlCommandEnv(next);
      index += 1;
      continue;
    }
    if (arg === "--no-wrap-transactions") {
      options.wrapTransactions = false;
      continue;
    }
    throw new Error(`Unknown or incomplete argument: ${arg}`);
  }

  return options;
}

export async function applyMigrations(options: Options): Promise<{
  applied: string[];
  skipped: string[];
}> {
  const files = await listMigrationFiles(options.migrationsDir);
  if (files.length === 0) {
    throw new Error(`No .sql migrations found in ${options.migrationsDir}`);
  }

  await executeSql(
    options,
    `
      CREATE TABLE IF NOT EXISTS ${MIGRATION_LEDGER_TABLE} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        applied_at TEXT NOT NULL
      )
    `,
    { resource: options.resource, purpose: "ledger-init" },
  );

  const appliedRows = await executeSql(
    options,
    `SELECT name FROM ${MIGRATION_LEDGER_TABLE}`,
    { resource: options.resource, purpose: "ledger-read" },
  );
  const appliedSet = new Set(parseAppliedMigrationNames(appliedRows));
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`[app:activate] Skipping already applied ${file}`);
      skipped.push(file);
      continue;
    }

    const path = `${options.migrationsDir.replace(/\/+$/, "")}/${file}`;
    const sql = await readFile(path, "utf8");
    console.log(`[app:activate] Applying ${file} to ${options.resource}`);
    await executeSql(options, migrationSqlWithLedgerMark(file, sql, options), {
      resource: options.resource,
      migration: file,
      purpose: "migration",
    });
    appliedSet.add(file);
    applied.push(file);
  }

  return { applied, skipped };
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

function migrationSqlWithLedgerMark(
  file: string,
  sql: string,
  options: Pick<Options, "wrapTransactions">,
): string {
  const markApplied =
    `INSERT INTO ${MIGRATION_LEDGER_TABLE} (name, applied_at) ` +
    `VALUES (${sqlString(file)}, ${sqlString(new Date().toISOString())});`;
  if (options.wrapTransactions === false || migrationOwnsTransaction(sql)) {
    return `${sql.trim()}\n${markApplied}\n`;
  }
  return `BEGIN;\n${sql.trim()}\n${markApplied}\nCOMMIT;\n`;
}

function migrationOwnsTransaction(sql: string): boolean {
  return /(^|\n)\s*BEGIN(\s+(IMMEDIATE|DEFERRED|EXCLUSIVE|TRANSACTION))?\s*;/i.test(
    sql,
  );
}

function parseAppliedMigrationNames(raw: unknown): string[] {
  const rows = extractRows(raw);
  return rows
    .map((row) =>
      isRecord(row) && typeof row.name === "string" ? row.name : "",
    )
    .filter(Boolean);
}

function extractRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) {
    if (raw.every(isRecord) && raw.some((row) => "name" in row)) return raw;
    const nested = raw.flatMap((entry) => extractRows(entry));
    if (nested.length > 0) return nested;
  }
  if (!isRecord(raw)) return [];
  if (Array.isArray(raw.rows)) return raw.rows;
  if (Array.isArray(raw.results)) return raw.results;
  if (Array.isArray(raw.result)) return extractRows(raw.result);
  return [];
}

async function executeSql(
  options: Options,
  sql: string,
  context: SqlExecutionContext,
): Promise<unknown> {
  if (options.executeSql) return await options.executeSql(sql, context);

  const args = buildSqlCommandArgs(options, sql);
  const [command, ...commandArgs] = args;
  const child = Bun.spawn([command!, ...commandArgs], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) {
    process.stdout.write(stdout);
    process.stderr.write(stderr);
    const target = context.migration ?? context.purpose;
    throw new Error(`SQL command failed for ${target}`);
  }
  return parseSqlCommandOutput(stdout);
}

export function buildSqlCommandArgs(
  options: Pick<
    Options,
    "resource" | "space" | "sqlCommand" | "sqlCommandTemplate"
  >,
  sql: string,
): readonly string[] {
  if (options.sqlCommandTemplate) {
    return options.sqlCommandTemplate.map((part) =>
      part
        .replaceAll("{resource}", options.resource)
        .replaceAll("{space}", options.space ?? "")
        .replaceAll("{sql}", sql),
    );
  }
  if (options.sqlCommand) {
    const args = [...options.sqlCommand];
    if (options.space) args.push("--space", options.space);
    args.push(options.resource, sql);
    return args;
  }
  throw new Error(
    "No SQL command configured for app activation. Set YURUCOMMU_SQL_COMMAND_JSON " +
      'for prefix mode, or YURUCOMMU_SQL_COMMAND_TEMPLATE_JSON with "{resource}" and "{sql}" placeholders.',
  );
}

function parseSqlCommandOutput(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return {};
  }
}

function parseSqlCommandEnv(
  value: string | undefined,
): readonly string[] | undefined {
  if (!value) return undefined;
  const parsed = JSON.parse(value) as unknown;
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    !parsed.every((part) => typeof part === "string" && part.trim())
  ) {
    throw new Error("SQL command env must be a string array");
  }
  return parsed;
}

function parseBooleanEnv(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`Invalid boolean env value: ${value}`);
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.main) {
  const result = await applyMigrations(parseArgs(argv.slice(2)));
  console.log(
    JSON.stringify({
      ok: true,
      applied: result.applied.length,
      skipped: result.skipped.length,
    }),
  );
}
