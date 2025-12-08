#!/usr/bin/env tsx

import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import type { TakosConfig } from "../../platform/src/config/takos-config.js";
import {
  TAKOS_CONFIG_SCHEMA_VERSION,
  checkConfigVersionGates,
  validateTakosConfig,
} from "../../platform/src/config/takos-config.js";
import { checkSemverCompatibility } from "../../platform/src/utils/semver.js";
import { TAKOS_CORE_VERSION } from "../../platform/src/config/versions.js";
import { validateTakosProfile, type TakosProfile } from "../../api/src/lib/profile-validator.js";
import { assertConfigAiActionsAllowed } from "../../api/src/lib/ai-action-allowlist.js";
import semver from "semver";

type Command = "compat" | "export" | "diff" | "import";

type CliArgs = {
  command: Command;
  configPath?: string;
  profilePath?: string;
  outPath?: string;
  url?: string;
  token?: string;
  cookie?: string;
  force: boolean;
  help?: boolean;
};

const DEFAULT_CONFIG_PATH = "takos-config.json";
const DEFAULT_PROFILE_PATH = "takos-profile.json";

function usage(): void {
  const script = "tsx scripts/api/config-tools.ts";
  console.log(
    [
      "takos config/profile helper",
      "",
      `Usage: ${script} <command> [options]`,
      "",
      "Commands:",
      "  compat   Validate takos-profile.json and takos-config.json compatibility",
      "  export   Fetch config from backend (/admin/config/export)",
      "  diff     Compare local config with backend (/admin/config/diff)",
      "  import   Apply local config to backend (/admin/config/import)",
      "",
      "Options:",
      `  --config <path>   Path to takos-config.json (default: ${DEFAULT_CONFIG_PATH}, use - for stdin) [compat/diff/import]`,
      `  --profile <path>  Path to takos-profile.json (default: ${DEFAULT_PROFILE_PATH}) [compat]`,
      "  --out <path>      Write export output to a file instead of stdout [export]",
      "  --url <url>       Base URL of backend (default: http://127.0.0.1:8787 or TAKOS_URL)",
      "  --token <jwt>     Bearer token (env: TAKOS_TOKEN)",
      "  --cookie <c>      Cookie header (env: TAKOS_COOKIE)",
      "  --force           Allow major version mismatch (compat/diff/import)",
      "  --help            Show this help",
    ].join("\n"),
  );
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { command: "compat", force: false };
  const input = [...argv];

  while (input.length) {
    const current = input.shift();
    switch (current) {
      case "compat":
      case "export":
      case "diff":
      case "import":
        args.command = current;
        break;
      case "--config":
      case "--file":
        args.configPath = input.shift();
        break;
      case "--profile":
        args.profilePath = input.shift();
        break;
      case "--out":
        args.outPath = input.shift();
        break;
      case "--url":
        args.url = input.shift();
        break;
      case "--token":
        args.token = input.shift();
        break;
      case "--cookie":
        args.cookie = input.shift();
        break;
      case "--force":
        args.force = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        break;
    }
  }

  return args;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJsonFromPath(path: string, label: string): Promise<any> {
  const contents = path === "-" ? await readStdin() : await readFile(path, "utf8");
  try {
    return JSON.parse(contents);
  } catch (error: any) {
    const hint = path === "-" ? "stdin" : path;
    throw new Error(`Failed to parse ${label} JSON from ${hint}: ${error?.message || error}`);
  }
}

function buildBaseUrl(url?: string): string {
  const base = url || process.env.TAKOS_URL || "http://127.0.0.1:8787";
  return base.replace(/\/+$/, "");
}

function buildHeaders(args: CliArgs): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = args.token || process.env.TAKOS_TOKEN;
  const cookie = args.cookie || process.env.TAKOS_COOKIE;

  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;
  return headers;
}

function printWarnings(warnings: string[]): void {
  if (!warnings.length) return;
  console.log("Warnings:");
  warnings.forEach((warning) => console.log(`- ${warning}`));
}

function renderValue(value: unknown): string {
  if (value === undefined) return "(absent)";
  return JSON.stringify(value);
}

function printDiff(diff: Array<{ path: string; change: string; previous?: unknown; next?: unknown }>): void {
  if (!diff.length) {
    console.log("No changes detected between current and incoming config.");
    return;
  }

  console.log(`Changes (${diff.length}):`);
  diff.forEach((entry) => {
    const label = `${entry.change}`.padEnd(7, " ");
    console.log(`- ${label} ${entry.path}`);
    if (entry.previous !== undefined) {
      console.log(`    from: ${renderValue(entry.previous)}`);
    }
    if (entry.next !== undefined) {
      console.log(`    to:   ${renderValue(entry.next)}`);
    }
  });
}

function printReloadResult(reload: any): void {
  if (!reload) return;
  const status = reload.ok ? "ok" : "error";
  console.log(`Reload: ${status}`);
  if (reload.source) {
    console.log(`- source: ${reload.source}`);
  }
  if (reload.reloaded !== undefined) {
    console.log(`- reloaded: ${reload.reloaded}`);
  }
  if (reload.error) {
    console.log(`- error: ${reload.error}`);
  }
  if (Array.isArray(reload.warnings) && reload.warnings.length) {
    console.log("- reload warnings:");
    reload.warnings.forEach((warning: string) => console.log(`  - ${warning}`));
  }
}

function validateConfigInput(config: TakosConfig): { config: TakosConfig; warnings: string[] } {
  const validation = validateTakosConfig(config);
  if (!validation.ok || !validation.config) {
    const message = validation.errors?.length ? validation.errors.join("; ") : "invalid config";
    throw new Error(message);
  }

  try {
    assertConfigAiActionsAllowed(validation.config);
  } catch (error: any) {
    throw new Error(error?.message || "invalid AI action allowlist");
  }

  const gateCheck = checkConfigVersionGates(validation.config);
  if (!gateCheck.ok) {
    throw new Error(gateCheck.error || "config.gates incompatible with runtime");
  }

  return { config: validation.config, warnings: gateCheck.warnings };
}

async function handleExport(args: CliArgs): Promise<void> {
  const endpoint = `${buildBaseUrl(args.url)}/admin/config/export`;
  const response = await fetch(endpoint, { method: "GET", headers: buildHeaders(args) });

  let json: any = null;
  try {
    json = await response.json();
  } catch {
    // ignore
  }

  if (!response.ok || !json?.ok) {
    const reason = json?.error || response.statusText || "request failed";
    throw new Error(reason);
  }

  const data = json.data || {};
  if (data.source) {
    console.log(`Config source: ${data.source}`);
  }
  printWarnings(data.warnings || []);

  const serialized = JSON.stringify(data.config ?? data, null, 2);
  const outPath = args.outPath;
  if (outPath && outPath !== "-") {
    await writeFile(outPath, `${serialized}\n`, "utf8");
    console.log(`Wrote config export to ${outPath}`);
  } else {
    console.log(serialized);
  }
}

async function handleDiff(args: CliArgs): Promise<void> {
  const configPath = args.configPath || DEFAULT_CONFIG_PATH;
  const configInput = (await readJsonFromPath(configPath, "config")) as TakosConfig;
  const localValidation = validateConfigInput(configInput);
  const query = args.force ? "?force=true" : "";
  const endpoint = `${buildBaseUrl(args.url)}/admin/config/diff${query}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: buildHeaders(args),
    body: JSON.stringify(localValidation.config),
  });

  let json: any = null;
  try {
    json = await response.json();
  } catch {
    // ignore
  }

  if (!response.ok || !json?.ok) {
    const reason = json?.error || response.statusText || "request failed";
    throw new Error(reason);
  }

  const data = json.data || {};
  if (data.source) {
    console.log(`Current config source: ${data.source}`);
  }
  const warnings = [...localValidation.warnings, ...(data.warnings || [])];
  printWarnings(warnings);
  printDiff(data.diff || []);
}

async function handleImport(args: CliArgs): Promise<void> {
  const configPath = args.configPath || DEFAULT_CONFIG_PATH;
  const configInput = (await readJsonFromPath(configPath, "config")) as TakosConfig;
  const localValidation = validateConfigInput(configInput);
  const query = args.force ? "?force=true" : "";
  const endpoint = `${buildBaseUrl(args.url)}/admin/config/import${query}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: buildHeaders(args),
    body: JSON.stringify(localValidation.config),
  });

  let json: any = null;
  try {
    json = await response.json();
  } catch {
    // ignore
  }

  if (!response.ok || !json?.ok) {
    const reason = json?.error || response.statusText || "request failed";
    throw new Error(reason);
  }

  const data = json.data || {};
  const warnings = [...localValidation.warnings, ...(data.warnings || [])];
  printWarnings(warnings);
  console.log("Config import applied.");
  printReloadResult(data.reload);
}

function checkProfileRuntimeCompatibility(profile: TakosProfile, warnings: string[], errors: string[]): void {
  const coreRange = profile.base?.core_version;
  if (!coreRange) return;

  if (!semver.validRange(coreRange)) {
    errors.push(`base.core_version is not a valid SemVer range: ${coreRange}`);
    return;
  }

  if (!semver.satisfies(TAKOS_CORE_VERSION, coreRange, { includePrerelease: true })) {
    errors.push(
      `runtime core ${TAKOS_CORE_VERSION} is outside takos-profile base.core_version range ${coreRange}`,
    );
  }
}

async function handleCompat(args: CliArgs): Promise<void> {
  const configPath = args.configPath || DEFAULT_CONFIG_PATH;
  const profilePath = args.profilePath || DEFAULT_PROFILE_PATH;

  const profile = (await readJsonFromPath(profilePath, "profile")) as TakosProfile;
  const profileValidation = validateTakosProfile(profile);

  const config = (await readJsonFromPath(configPath, "config")) as TakosConfig;
  const configValidation = validateTakosConfig(config);

  const errors: string[] = [];
  const warnings: string[] = [];

  if (!profileValidation.ok) {
    errors.push(...(profileValidation.errors || []));
  }
  warnings.push(...(profileValidation.warnings || []));

  if (!configValidation.ok || !configValidation.config) {
    errors.push(...(configValidation.errors || ["invalid takos-config.json"]));
  }

  if (errors.length === 0 && configValidation.config) {
    const distro = configValidation.config.distro;
    if (!distro?.name || !distro?.version) {
      errors.push("config.distro.name/version must be provided");
    } else {
      if (distro.name !== profile.name) {
        errors.push(`distro.name mismatch (config: ${distro.name}, profile: ${profile.name})`);
      }
      const versionCheck = checkSemverCompatibility(profile.version, distro.version, {
        allowMajorMismatch: args.force,
        context: "distro version",
        action: "config",
      });
      if (!versionCheck.ok) {
        errors.push(versionCheck.error || "distro version incompatible");
      } else {
        warnings.push(...versionCheck.warnings);
      }
    }

    const gateCheck = checkConfigVersionGates(configValidation.config);
    if (!gateCheck.ok && gateCheck.error) {
      errors.push(`config.gates incompatible with runtime: ${gateCheck.error}`);
    }
    warnings.push(...gateCheck.warnings);

    try {
      assertConfigAiActionsAllowed(configValidation.config);
    } catch (error: any) {
      errors.push(error?.message || "ai.enabled_actions invalid for takos-profile");
    }

    if (configValidation.config.schema_version !== TAKOS_CONFIG_SCHEMA_VERSION) {
      errors.push(
        `config.schema_version expected ${TAKOS_CONFIG_SCHEMA_VERSION} but got ${configValidation.config.schema_version}`,
      );
    }

    checkProfileRuntimeCompatibility(profile, warnings, errors);
  }

  if (errors.length) {
    console.error("Compatibility check failed:");
    errors.forEach((err) => console.error(`- ${err}`));
    if (warnings.length) {
      printWarnings(warnings);
    }
    process.exit(1);
  }

  console.log("takos-profile.json and takos-config.json look compatible.");
  printWarnings(warnings);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  try {
    switch (args.command) {
      case "compat":
        await handleCompat(args);
        break;
      case "export":
        await handleExport(args);
        break;
      case "diff":
        await handleDiff(args);
        break;
      case "import":
        await handleImport(args);
        break;
      default:
        usage();
        process.exit(1);
    }
  } catch (error: any) {
    console.error(error?.message || error);
    process.exit(1);
  }
}

main();
