#!/usr/bin/env bun
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { argv, env } from "node:process";

import { applyMigrations } from "./apply-takos-migrations.ts";

type JsonRecord = Record<string, unknown>;

export type YurucommuReleaseConfig = {
  workerName: string;
  appUrl: string;
  d1DatabaseName: string;
  d1DatabaseId: string;
  kvNamespaceId: string;
  r2BucketName?: string;
  deliveryQueueName?: string;
  deliveryDlqName?: string;
  vars: Record<string, string>;
  secrets: Record<string, string>;
};

const SECRET_ENV_MAP: Record<string, string> = {
  YURUCOMMU_ENCRYPTION_KEY: "ENCRYPTION_KEY",
  YURUCOMMU_AUTH_PASSWORD_HASH: "AUTH_PASSWORD_HASH",
  YURUCOMMU_GOOGLE_CLIENT_SECRET: "GOOGLE_CLIENT_SECRET",
  YURUCOMMU_X_CLIENT_SECRET: "X_CLIENT_SECRET",
  YURUCOMMU_OIDC_CLIENT_SECRET: "OIDC_CLIENT_SECRET",
  YURUCOMMU_TAKOSUMI_ACCOUNTS_CLIENT_SECRET: "TAKOSUMI_ACCOUNTS_CLIENT_SECRET",
  YURUCOMMU_SESSION_HASH_SALT: "YURUCOMMU_SESSION_HASH_SALT",
  ENCRYPTION_KEY: "ENCRYPTION_KEY",
  AUTH_PASSWORD_HASH: "AUTH_PASSWORD_HASH",
  GOOGLE_CLIENT_SECRET: "GOOGLE_CLIENT_SECRET",
  X_CLIENT_SECRET: "X_CLIENT_SECRET",
  OIDC_CLIENT_SECRET: "OIDC_CLIENT_SECRET",
  TAKOSUMI_ACCOUNTS_CLIENT_SECRET: "TAKOSUMI_ACCOUNTS_CLIENT_SECRET",
};

const OPTIONAL_VAR_ENV = [
  "AUTH_MODE",
  "GOOGLE_CLIENT_ID",
  "X_CLIENT_ID",
  "OIDC_ISSUER_URL",
  "OIDC_CLIENT_ID",
  "OAUTH_ISSUER_URL",
  "TAKOSUMI_ACCOUNTS_ISSUER_URL",
  "TAKOSUMI_ACCOUNTS_CLIENT_ID",
  "OIDC_OWNER_SUB",
  "OIDC_ALLOWED_SUBS",
  "TAKOS_URL",
  "YURUCOMMU_SOFTWARE_VERSION",
  "CSRF_ALLOWED_ORIGINS",
  "YURUCOMMU_STRICT_READINESS",
] as const;

export function parseTakosumiOutputsJson(text: string): JsonRecord {
  const outputs = JSON.parse(text) as unknown;
  if (!isRecord(outputs)) {
    throw new Error("TAKOSUMI_OUTPUTS_JSON must be a JSON object");
  }
  return outputs;
}

export function releaseConfigFromOutputs(
  outputs: JsonRecord,
  sourceEnv: Record<string, string | undefined> = env,
): YurucommuReleaseConfig {
  const workerName = requireStringOutput(outputs, "worker_name");
  const appUrl =
    firstString(sourceEnv.YURUCOMMU_APP_URL, sourceEnv.APP_URL) ??
    requireStringOutput(outputs, "launch_url");
  const d1DatabaseName = requireStringOutput(
    outputs,
    "cloudflare_d1_database_name",
  );
  const d1DatabaseId = requireStringOutput(
    outputs,
    "cloudflare_d1_database_id",
  );
  const kvNamespaceId = requireStringOutput(
    outputs,
    "cloudflare_kv_namespace_id",
  );
  const queueNames = outputValue(outputs.cloudflare_queue_names);
  const vars = collectWorkerVars(appUrl, queueNames, sourceEnv);
  return {
    workerName,
    appUrl,
    d1DatabaseName,
    d1DatabaseId,
    kvNamespaceId,
    r2BucketName: optionalStringOutput(outputs, "cloudflare_r2_bucket_name"),
    deliveryQueueName: nestedString(queueNames, "delivery"),
    deliveryDlqName: nestedString(queueNames, "delivery_dlq"),
    vars,
    secrets: collectWorkerSecrets(sourceEnv),
  };
}

export function buildWranglerToml(config: YurucommuReleaseConfig): string {
  const lines = [
    `name = ${tomlString(config.workerName)}`,
    `main = "../../src/backend/index.ts"`,
    `compatibility_date = "2026-04-01"`,
    `compatibility_flags = ["nodejs_compat", "global_fetch_strictly_public"]`,
    `workers_dev = true`,
    "",
    "[vars]",
    ...Object.entries(config.vars)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => `${name} = ${tomlString(value)}`),
    "",
    "[[d1_databases]]",
    `binding = "DB"`,
    `database_name = ${tomlString(config.d1DatabaseName)}`,
    `database_id = ${tomlString(config.d1DatabaseId)}`,
    "",
    "[[kv_namespaces]]",
    `binding = "KV"`,
    `id = ${tomlString(config.kvNamespaceId)}`,
  ];

  if (config.r2BucketName) {
    lines.push(
      "",
      "[[r2_buckets]]",
      `binding = "MEDIA"`,
      `bucket_name = ${tomlString(config.r2BucketName)}`,
    );
  }

  if (config.deliveryQueueName) {
    lines.push(
      "",
      "[[queues.producers]]",
      `binding = "DELIVERY_QUEUE"`,
      `queue = ${tomlString(config.deliveryQueueName)}`,
      "",
      "[[queues.consumers]]",
      `queue = ${tomlString(config.deliveryQueueName)}`,
      "max_batch_size = 10",
      "max_batch_timeout = 1",
      "max_retries = 3",
    );
  }

  if (config.deliveryDlqName) {
    lines.push(
      "",
      "[[queues.producers]]",
      `binding = "DELIVERY_DLQ"`,
      `queue = ${tomlString(config.deliveryDlqName)}`,
      "",
      "[[queues.consumers]]",
      `queue = ${tomlString(config.deliveryDlqName)}`,
      "max_batch_size = 10",
      "max_batch_timeout = 60",
      "max_retries = 1",
    );
  }

  lines.push(
    "",
    "[assets]",
    `directory = "../../dist"`,
    `binding = "ASSETS"`,
    "run_worker_first = true",
    `not_found_handling = "single-page-application"`,
    "",
  );
  return `${lines.join("\n")}\n`;
}

export function buildDeployArgs(
  configPath: string,
  secretsPath?: string,
): string[] {
  return [
    "bunx",
    "wrangler",
    "deploy",
    "--config",
    configPath,
    ...(secretsPath ? ["--secrets-file", secretsPath] : []),
  ];
}

export function buildInstallArgs(): string[] {
  return ["bun", "install", "--frozen-lockfile"];
}

export function buildD1ExecuteTemplate(configPath: string): string[] {
  return [
    "bunx",
    "wrangler",
    "d1",
    "execute",
    "{resource}",
    "--remote",
    "--json",
    "--yes",
    "--config",
    configPath,
    "--command",
    "{sql}",
  ];
}

export function buildDeleteWorkerArgs(workerName: string): string[] {
  return ["bunx", "wrangler", "delete", workerName, "--force"];
}

async function main(args = argv.slice(2)): Promise<void> {
  const dryRun = args.includes("--dry-run");
  const keepGenerated = args.includes("--keep-generated");
  const destroy = args.includes("--destroy");
  const unknown = args.find(
    (arg) =>
      !["--dry-run", "--keep-generated", "--destroy"].includes(arg),
  );
  if (unknown) throw new Error(`Unknown argument: ${unknown}`);

  const rawOutputs = env.TAKOSUMI_OUTPUTS_JSON;
  if (!rawOutputs?.trim()) {
    throw new Error("TAKOSUMI_OUTPUTS_JSON is required for Yurucommu release");
  }
  const config = releaseConfigFromOutputs(parseTakosumiOutputsJson(rawOutputs));
  if (destroy) {
    await run(buildDeleteWorkerArgs(config.workerName));
    console.log(
      JSON.stringify({
        ok: true,
        destroyed: true,
        workerName: config.workerName,
      }),
    );
    return;
  }
  const generatedDir = join(".takosumi-release", randomUUID());
  const configPath = join(generatedDir, "wrangler.toml");
  const secretsPath =
    Object.keys(config.secrets).length > 0
      ? join(generatedDir, "secrets.json")
      : undefined;

  await mkdir(generatedDir, { recursive: true });
  try {
    await writeFile(configPath, buildWranglerToml(config));
    if (secretsPath) {
      await writeFile(secretsPath, JSON.stringify(config.secrets));
    }

    if (dryRun) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            dryRun: true,
            workerName: config.workerName,
            appUrl: config.appUrl,
            configPath,
            secretNames: Object.keys(config.secrets).sort(),
            deployArgs: buildDeployArgs(configPath, secretsPath),
          },
          null,
          2,
        ),
      );
      return;
    }

    warnIfReadinessWillBeIncomplete(config);
    await run(buildInstallArgs());
    await run(["bun", "run", "build"]);
    if (shouldSkipD1Migrations(env.YURUCOMMU_SKIP_D1_MIGRATIONS)) {
      console.warn(
        "[takosumi:release] Skipping D1 migrations because YURUCOMMU_SKIP_D1_MIGRATIONS is enabled.",
      );
    } else {
      await applyMigrations({
        resource: "DB",
        migrationsDir: "migrations",
        sqlCommandTemplate: buildD1ExecuteTemplate(configPath),
      });
    }
    await run(buildDeployArgs(configPath, secretsPath));
    console.log(
      JSON.stringify({
        ok: true,
        workerName: config.workerName,
        appUrl: config.appUrl,
        secretNames: Object.keys(config.secrets).sort(),
      }),
    );
  } finally {
    if (!keepGenerated) {
      await rm(generatedDir, { recursive: true, force: true });
    }
  }
}

async function run(command: readonly string[]): Promise<void> {
  console.log(`\n> ${command.map(shellArg).join(" ")}\n`);
  const child = Bun.spawn([...command], {
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await child.exited;
  if (code !== 0) {
    throw new Error(`Command failed (${code}): ${command.join(" ")}`);
  }
}

export function shouldSkipD1Migrations(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function collectWorkerVars(
  appUrl: string,
  queueNames: unknown,
  sourceEnv: Record<string, string | undefined>,
): Record<string, string> {
  const vars: Record<string, string> = {
    APP_URL: appUrl,
    DELIVERY_QUEUE_NAME: nestedString(queueNames, "delivery") ?? "",
    DELIVERY_DLQ_NAME: nestedString(queueNames, "delivery_dlq") ?? "",
  };
  for (const name of OPTIONAL_VAR_ENV) {
    const value = sourceEnv[name];
    if (value?.trim()) vars[name] = value;
  }
  return Object.fromEntries(
    Object.entries(vars).filter(([, value]) => value.trim() !== ""),
  );
}

function collectWorkerSecrets(
  sourceEnv: Record<string, string | undefined>,
): Record<string, string> {
  const secrets: Record<string, string> = {};
  for (const [source, target] of Object.entries(SECRET_ENV_MAP)) {
    const value = sourceEnv[source];
    if (value?.trim()) secrets[target] = value;
  }
  return secrets;
}

function warnIfReadinessWillBeIncomplete(config: YurucommuReleaseConfig): void {
  const hasAuth =
    Boolean(config.secrets.AUTH_PASSWORD_HASH) ||
    (Boolean(config.vars.GOOGLE_CLIENT_ID) &&
      Boolean(config.secrets.GOOGLE_CLIENT_SECRET)) ||
    (Boolean(config.vars.X_CLIENT_ID) &&
      Boolean(config.secrets.X_CLIENT_SECRET)) ||
    (Boolean(config.vars.TAKOSUMI_ACCOUNTS_ISSUER_URL) &&
      Boolean(config.vars.TAKOSUMI_ACCOUNTS_CLIENT_ID)) ||
    (Boolean(config.vars.OIDC_ISSUER_URL) &&
      Boolean(config.vars.OIDC_CLIENT_ID));
  const missing: string[] = [];
  if (!config.secrets.ENCRYPTION_KEY) missing.push("ENCRYPTION_KEY");
  if (!hasAuth) missing.push("AUTH_METHOD");
  if (missing.length > 0) {
    console.warn(
      `[takosumi:release] Worker will deploy, but /readyz will be misconfigured until operator env provides: ${missing.join(", ")}`,
    );
  }
}

function requireStringOutput(outputs: JsonRecord, name: string): string {
  const value = optionalStringOutput(outputs, name);
  if (!value) {
    throw new Error(
      `TAKOSUMI_OUTPUTS_JSON must include string output "${name}"`,
    );
  }
  return value;
}

function optionalStringOutput(
  outputs: JsonRecord,
  name: string,
): string | undefined {
  const value = outputValue(outputs[name]);
  return typeof value === "string" && value.trim() ? value : undefined;
}

function outputValue(entry: unknown): unknown {
  if (isRecord(entry) && "value" in entry && "sensitive" in entry) {
    return entry.value;
  }
  return entry;
}

function nestedString(value: unknown, key: string): string | undefined {
  const record = outputValue(value);
  if (!isRecord(record)) return undefined;
  const nested = outputValue(record[key]);
  return typeof nested === "string" && nested.trim() ? nested : undefined;
}

function firstString(
  ...values: readonly (string | undefined)[]
): string | undefined {
  return values.find((value) => value?.trim())?.trim();
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function shellArg(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.main) {
  await main();
}
