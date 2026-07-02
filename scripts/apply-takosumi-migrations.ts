import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  retryAttempts?: number;
  retryDelayMs?: number;
  batchPendingMigrations?: boolean;
  sqlCommand?: readonly string[];
  sqlCommandTemplate?: readonly string[];
  executeSql?: SqlExecutor;
};

export function parseArgs(args: string[]): Options {
  const batchPendingMigrations = parseOptionalBooleanEnv(
    env.YURUCOMMU_SQL_BATCH_PENDING,
  );
  const options: Options = {
    resource:
      env.YURUCOMMU_SQL_RESOURCE ??
      env.TAKOSUMI_RESOURCE ??
      env.TAKOSUMI_D1_RESOURCE ??
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
    retryAttempts: parseIntegerEnv(env.YURUCOMMU_SQL_RETRY_ATTEMPTS, 4),
    retryDelayMs: parseIntegerEnv(env.YURUCOMMU_SQL_RETRY_DELAY_MS, 1500),
    ...(batchPendingMigrations === undefined ? {} : { batchPendingMigrations }),
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
    if (arg === "--retry-attempts" && next) {
      options.retryAttempts = parsePositiveInteger(next, "--retry-attempts");
      index += 1;
      continue;
    }
    if (arg === "--retry-delay-ms" && next) {
      options.retryDelayMs = parseNonNegativeInteger(next, "--retry-delay-ms");
      index += 1;
      continue;
    }
    if (arg === "--batch-pending-migrations") {
      options.batchPendingMigrations = true;
      continue;
    }
    if (arg === "--no-batch-pending-migrations") {
      options.batchPendingMigrations = false;
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
  const skipped = files.filter((file) => appliedSet.has(file));
  const pending = files.filter((file) => !appliedSet.has(file));

  for (const file of skipped) {
    console.log(`[app:activate] Skipping already applied ${file}`);
  }
  if (pending.length === 0) return { applied: [], skipped };
  if (shouldBatchPendingMigrations(options)) {
    const applied = await applyPendingMigrationsBatch(options, pending);
    return { applied, skipped };
  }

  const applied: string[] = [];
  for (const file of pending) {
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

async function applyPendingMigrationsBatch(
  options: Options,
  files: readonly string[],
): Promise<string[]> {
  const blocks: string[] = [];
  for (const file of files) {
    const path = `${options.migrationsDir.replace(/\/+$/, "")}/${file}`;
    const sql = await readFile(path, "utf8");
    blocks.push(`-- yurucommu migration: ${file}`);
    blocks.push(migrationSqlWithLedgerMark(file, sql, options));
  }
  const first = files[0]!;
  const last = files.at(-1)!;
  console.log(
    `[app:activate] Applying ${files.length} pending migrations to ${options.resource} in one batch`,
  );
  await executeSql(
    {
      ...options,
      // A failed batch may have applied and ledger-marked an earlier migration.
      // A later run can resume from the ledger, but retrying the same batch in
      // this process would re-run non-idempotent ALTER statements.
      retryAttempts: 1,
    },
    blocks.join("\n\n"),
    {
      resource: options.resource,
      migration: first === last ? first : `${first}..${last}`,
      purpose: "migration",
    },
  );
  return [...files];
}

function shouldBatchPendingMigrations(options: Options): boolean {
  if (options.batchPendingMigrations === false) return false;
  if (options.batchPendingMigrations === true) return true;
  return Boolean(
    options.sqlCommandTemplate?.some((part) => part.includes("{sql_file}")),
  );
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
  const ensureLedger = migrationLedgerTableSql();
  const markApplied =
    `INSERT INTO ${MIGRATION_LEDGER_TABLE} (name, applied_at) ` +
    `VALUES (${sqlString(file)}, ${sqlString(new Date().toISOString())});`;
  if (options.wrapTransactions === false || migrationOwnsTransaction(sql)) {
    return `${ensureLedger}\n${sql.trim()}\n${markApplied}\n`;
  }
  return `BEGIN;\n${ensureLedger}\n${sql.trim()}\n${markApplied}\nCOMMIT;\n`;
}

function migrationLedgerTableSql(): string {
  return `
CREATE TABLE IF NOT EXISTS ${MIGRATION_LEDGER_TABLE} (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  applied_at TEXT NOT NULL
);`.trim();
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

  const sqlFile = await materializeSqlFileIfNeeded(options, sql);
  try {
    const args = buildSqlCommandArgs(options, sql, sqlFile?.path);
    const target = context.migration ?? context.purpose;
    const maxAttempts = Math.max(1, options.retryAttempts ?? 1);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const result = await runSqlCommand(args);
      const output = parseSqlCommandOutput(result.stdout);
      const outputFailure = sqlCommandOutputFailure(output);
      const failure = sqlExecutionFailure({
        code: result.code,
        stdout: result.stdout,
        stderr: result.stderr,
        outputFailure,
      });
      if (!failure) return output;
      if (attempt < maxAttempts && isRetryableSqlFailure(failure.message)) {
        const delayMs = retryDelayMs(options, attempt);
        console.warn(
          `[app:activate] Retrying ${target} after transient SQL failure ` +
            `(${attempt}/${maxAttempts}): ${oneLine(failure.message)}`,
        );
        if (delayMs > 0) await sleep(delayMs);
        continue;
      }
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
      throw new Error(
        `SQL command failed for ${target}${sqlFailureDetail(
          result.stdout,
          result.stderr,
          failure.message,
        )}`,
      );
    }
    throw new Error(`SQL command failed for ${target}`);
  } finally {
    if (sqlFile) await rm(sqlFile.dir, { recursive: true, force: true });
  }
}

async function runSqlCommand(args: readonly string[]): Promise<{
  stdout: string;
  stderr: string;
  code: number;
}> {
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
  return { stdout, stderr, code };
}

function sqlExecutionFailure(input: {
  code: number;
  stdout: string;
  stderr: string;
  outputFailure?: string;
}): { message: string } | undefined {
  if (input.code === 0 && !input.outputFailure) return undefined;
  return {
    message:
      input.outputFailure ??
      [input.stdout, input.stderr].filter(Boolean).join("\n") ??
      `exit code ${input.code}`,
  };
}

function isRetryableSqlFailure(message: string): boolean {
  return /(?:no such table|database is locked|SQLITE_BUSY|SQLITE_LOCKED|internal error|timed?\s*out|timeout)/iu.test(
    message,
  );
}

function retryDelayMs(
  options: Pick<Options, "retryDelayMs">,
  attempt: number,
): number {
  const base = options.retryDelayMs ?? 0;
  if (base <= 0) return 0;
  return Math.min(base * 2 ** Math.max(0, attempt - 1), 8000);
}

function oneLine(value: string): string {
  return value.replace(/\s+/gu, " ").slice(0, 220);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function materializeSqlFileIfNeeded(
  options: Pick<Options, "sqlCommandTemplate">,
  sql: string,
): Promise<{ dir: string; path: string } | undefined> {
  if (
    !options.sqlCommandTemplate?.some((part) => part.includes("{sql_file}"))
  ) {
    return undefined;
  }
  const dir = await mkdtemp(join(tmpdir(), "yurucommu-d1-sql-"));
  const path = join(dir, "command.sql");
  await writeFile(path, sql);
  return { dir, path };
}

function sqlFailureDetail(
  stdout: string,
  stderr: string,
  parsedFailure?: string,
): string {
  const combined = [parsedFailure, stdout, stderr]
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n")
    .replaceAll(
      /\b(CLOUDFLARE_API_TOKEN|CF_API_TOKEN|AUTH_TOKEN)=\S+/giu,
      "$1=[redacted]",
    );
  if (!combined) return "";
  const maxLength = 2_000;
  const clipped =
    combined.length > maxLength
      ? `${combined.slice(0, maxLength)}...`
      : combined;
  return `: ${clipped}`;
}

export function buildSqlCommandArgs(
  options: Pick<
    Options,
    "resource" | "space" | "sqlCommand" | "sqlCommandTemplate"
  >,
  sql: string,
  sqlFilePath?: string,
): readonly string[] {
  if (options.sqlCommandTemplate) {
    if (
      options.sqlCommandTemplate.some((part) => part.includes("{sql_file}")) &&
      !sqlFilePath
    ) {
      throw new Error("SQL command template uses {sql_file} without a file");
    }
    return options.sqlCommandTemplate.map((part) =>
      part
        .replaceAll("{resource}", options.resource)
        .replaceAll("{space}", options.space ?? "")
        .replaceAll("{sql_file}", sqlFilePath ?? "")
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
  for (const candidate of jsonCandidates(trimmed)) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next JSON-looking suffix. Wrangler prints progress lines before
      // the JSON payload when executing SQL files remotely.
    }
  }
  return {};
}

function jsonCandidates(text: string): string[] {
  const candidates = [text];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "{" || char === "[") {
      const suffix = text.slice(index).trim();
      if (!candidates.includes(suffix)) candidates.push(suffix);
    }
  }
  return candidates;
}

function sqlCommandOutputFailure(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const failure = sqlCommandOutputFailure(entry);
      if (failure) return failure;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  if (value.success === false) {
    return `D1 command returned success=false${sqlErrorSuffix(value.error)}`;
  }
  if ("error" in value && value.error !== undefined && value.error !== null) {
    return `D1 command returned error${sqlErrorSuffix(value.error)}`;
  }
  for (const key of ["result", "results"]) {
    const failure = sqlCommandOutputFailure(value[key]);
    if (failure) return failure;
  }
  return undefined;
}

function sqlErrorSuffix(value: unknown): string {
  const message = sqlErrorMessage(value);
  return message ? `: ${message}` : "";
}

function sqlErrorMessage(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return undefined;
  for (const key of ["text", "message", "code", "name"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
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
  const parsed = parseOptionalBooleanEnv(value);
  return parsed ?? defaultValue;
}

function parseOptionalBooleanEnv(
  value: string | undefined,
): boolean | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`Invalid boolean env value: ${value}`);
}

function parseIntegerEnv(
  value: string | undefined,
  defaultValue: number,
): number {
  if (!value?.trim()) return defaultValue;
  return parsePositiveInteger(value, "integer env value");
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return parsed;
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
