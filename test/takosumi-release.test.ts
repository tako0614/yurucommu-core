import { expect, test } from "bun:test";

import {
  buildD1ExecuteTemplate,
  buildDeleteWorkerArgs,
  buildDeployArgs,
  buildDestroyArgs,
  buildInstallArgs,
  buildRemoveQueueConsumerArgs,
  buildWranglerToml,
  parseTakosumiOutputsJson,
  releaseConfigFromOutputs,
  shouldSkipD1Migrations,
} from "../scripts/takosumi-release.ts";

const rawOutputs = {
  worker_name: "yuru-smoke",
  launch_url: "https://yuru-smoke.example.workers.dev",
  cloudflare_account_id: "cf_account_123",
  cloudflare_d1_database_name: "yuru-smoke-db",
  cloudflare_d1_database_id: "d1_123",
  cloudflare_kv_namespace_id: "kv_123",
  cloudflare_r2_bucket_name: "yuru-smoke-media",
  cloudflare_queue_names: {
    delivery: "yuru-smoke-delivery",
    delivery_dlq: "yuru-smoke-delivery-dlq",
  },
};

test("releaseConfigFromOutputs accepts raw Takosumi outputs and operator env", () => {
  const config = releaseConfigFromOutputs(rawOutputs, {
    YURUCOMMU_ENCRYPTION_KEY: "0".repeat(64),
    YURUCOMMU_AUTH_PASSWORD_HASH: "salt:hash",
    TAKOSUMI_ACCOUNTS_ISSUER_URL: "https://app.takosumi.test",
    TAKOSUMI_ACCOUNTS_CLIENT_ID: "client_public",
  });

  expect(config).toMatchObject({
    workerName: "yuru-smoke",
    appUrl: "https://yuru-smoke.example.workers.dev",
    cloudflareAccountId: "cf_account_123",
    d1DatabaseName: "yuru-smoke-db",
    d1DatabaseId: "d1_123",
    kvNamespaceId: "kv_123",
    r2BucketName: "yuru-smoke-media",
    deliveryQueueName: "yuru-smoke-delivery",
    deliveryDlqName: "yuru-smoke-delivery-dlq",
    vars: {
      APP_URL: "https://yuru-smoke.example.workers.dev",
      DELIVERY_QUEUE_NAME: "yuru-smoke-delivery",
      DELIVERY_DLQ_NAME: "yuru-smoke-delivery-dlq",
      TAKOSUMI_ACCOUNTS_ISSUER_URL: "https://app.takosumi.test",
      TAKOSUMI_ACCOUNTS_CLIENT_ID: "client_public",
    },
    secrets: {
      ENCRYPTION_KEY: "0".repeat(64),
      AUTH_PASSWORD_HASH: "salt:hash",
    },
  });
});

test("releaseConfigFromOutputs accepts tofu output envelopes and app url override", () => {
  const envelope = Object.fromEntries(
    Object.entries(rawOutputs).map(([name, value]) => [
      name,
      { value, sensitive: false, type: "dynamic" },
    ]),
  );

  const config = releaseConfigFromOutputs(envelope, {
    YURUCOMMU_APP_URL: "https://custom.example.com",
  });

  expect(config.appUrl).toBe("https://custom.example.com");
  expect(config.workerName).toBe("yuru-smoke");
});

test("buildWranglerToml renders the Worker bindings without secrets", () => {
  const config = releaseConfigFromOutputs(rawOutputs, {
    YURUCOMMU_ENCRYPTION_KEY: "0".repeat(64),
  });
  const toml = buildWranglerToml(config);

  expect(toml).toContain('name = "yuru-smoke"');
  expect(toml).toContain('main = "../../src/backend/index.ts"');
  expect(toml).toContain('APP_URL = "https://yuru-smoke.example.workers.dev"');
  expect(toml).toContain('database_id = "d1_123"');
  expect(toml).toContain('id = "kv_123"');
  expect(toml).toContain('bucket_name = "yuru-smoke-media"');
  expect(toml).toContain('binding = "DELIVERY_QUEUE"');
  expect(toml).not.toContain("0000000000");
  expect(toml).not.toContain("ENCRYPTION_KEY");
});

test("release commands use generated wrangler config", () => {
  expect(buildInstallArgs()).toEqual([
    "bun",
    "install",
    "--frozen-lockfile",
    "--ignore-scripts",
  ]);
  expect(buildDeployArgs(".takosumi-release/run/wrangler.toml")).toEqual([
    "bunx",
    "wrangler",
    "deploy",
    "--config",
    ".takosumi-release/run/wrangler.toml",
  ]);
  expect(
    buildDeployArgs(
      ".takosumi-release/run/wrangler.toml",
      ".takosumi-release/run/secrets.json",
    ),
  ).toContain("--secrets-file");
  expect(buildD1ExecuteTemplate(".takosumi-release/run/wrangler.toml")).toEqual(
    [
      "bunx",
      "wrangler",
      "d1",
      "execute",
      "{resource}",
      "--remote",
      "--json",
      "--yes",
      "--config",
      ".takosumi-release/run/wrangler.toml",
      "--file",
      "{sql_file}",
    ],
  );
  expect(buildDeleteWorkerArgs("yuru-smoke")).toEqual([
    "bunx",
    "wrangler",
    "delete",
    "yuru-smoke",
    "--force",
  ]);
  expect(
    buildRemoveQueueConsumerArgs("yuru-smoke-delivery", "yuru-smoke"),
  ).toEqual([
    "bunx",
    "wrangler",
    "queues",
    "consumer",
    "remove",
    "yuru-smoke-delivery",
    "yuru-smoke",
  ]);
  expect(buildDestroyArgs(releaseConfigFromOutputs(rawOutputs))).toEqual([
    [
      "bunx",
      "wrangler",
      "queues",
      "consumer",
      "remove",
      "yuru-smoke-delivery",
      "yuru-smoke",
    ],
    [
      "bunx",
      "wrangler",
      "queues",
      "consumer",
      "remove",
      "yuru-smoke-delivery-dlq",
      "yuru-smoke",
    ],
    ["bunx", "wrangler", "delete", "yuru-smoke", "--force"],
  ]);
});

test("migrations-only mode is accepted in dry-run output", async () => {
  const proc = Bun.spawn(
    ["bun", "scripts/takosumi-release.ts", "--dry-run", "--migrations-only"],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        TAKOSUMI_OUTPUTS_JSON: JSON.stringify(rawOutputs),
      },
    },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(stderr).toBe("");
  expect(code).toBe(0);
  expect(JSON.parse(stdout)).toMatchObject({
    ok: true,
    dryRun: true,
    migrationsOnly: true,
    workerName: "yuru-smoke",
  });
});

test("shouldSkipD1Migrations only accepts explicit truthy operator values", () => {
  expect(shouldSkipD1Migrations("1")).toBe(true);
  expect(shouldSkipD1Migrations("true")).toBe(true);
  expect(shouldSkipD1Migrations("YES")).toBe(true);
  expect(shouldSkipD1Migrations("0")).toBe(false);
  expect(shouldSkipD1Migrations("false")).toBe(false);
  expect(shouldSkipD1Migrations(undefined)).toBe(false);
});

test("parseTakosumiOutputsJson rejects non-object payloads", () => {
  expect(parseTakosumiOutputsJson(JSON.stringify(rawOutputs))).toEqual(
    rawOutputs,
  );
  expect(() => parseTakosumiOutputsJson("[]")).toThrow(
    "TAKOSUMI_OUTPUTS_JSON must be a JSON object",
  );
});
