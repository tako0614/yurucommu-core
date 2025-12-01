#!/usr/bin/env node

const { readFile } = require("node:fs/promises");

function usage() {
  const script = "npm exec takos-config -- diff --file takos-config.json --url http://127.0.0.1:8787";
  console.log(
    [
      "takos-config helper CLI",
      "",
      `Usage: ${script} [--token <jwt>] [--cookie \"name=value\"] [--force]`,
      "",
      "Commands:",
      "  diff   Show differences between the current config on the server and a candidate file",
      "",
      "Options:",
      "  --file <path>   Path to takos-config.json (default: takos-config.json, use - for stdin)",
      "  --url <url>     Base URL of the takos backend (default: http://127.0.0.1:8787 or TAKOS_URL)",
      "  --token <jwt>   Bearer token used for Authorization (env: TAKOS_TOKEN)",
      "  --cookie <c>    Cookie header value to forward (env: TAKOS_COOKIE)",
      "  --force         Allow cross-major distro imports (passes ?force=true)",
      "  --help          Show this help message",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const args = { command: "diff", force: false };
  const input = [...argv];
  while (input.length) {
    const current = input.shift();
    switch (current) {
      case "diff":
        args.command = "diff";
        break;
      case "--file":
        args.file = input.shift();
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
        if (!args.command) {
          args.command = current;
        }
        break;
    }
  }
  return args;
}

async function readConfig(filePath) {
  const content =
    filePath === "-" ? await readStdin() : await readFile(filePath, "utf8");
  try {
    return JSON.parse(content);
  } catch (error) {
    const hint = filePath === "-" ? "stdin" : filePath;
    throw new Error(`Failed to parse JSON from ${hint}: ${error.message || error}`);
  }
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function renderValue(value) {
  if (value === undefined) return "(absent)";
  return JSON.stringify(value);
}

function printWarnings(warnings) {
  if (!warnings || !warnings.length) return;
  console.log("Warnings:");
  warnings.forEach((warning) => console.log(`- ${warning}`));
}

function printDiff(diff = []) {
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

async function requestDiff(options) {
  const baseUrl = (options.url || "http://127.0.0.1:8787").replace(/\/+$/, "");
  const query = options.force ? "?force=true" : "";
  const endpoint = `${baseUrl}/admin/config/diff${query}`;
  const headers = { "content-type": "application/json" };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.cookie) {
    headers.Cookie = options.cookie;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(options.config),
  });

  let json = null;
  try {
    json = await response.json();
  } catch {
    // ignore
  }

  if (!response.ok || !json?.ok) {
    const reason = json?.error || response.statusText || "request failed";
    throw new Error(reason);
  }

  return json.data || {};
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }

  if (args.command !== "diff") {
    console.error(`Unknown command: ${args.command}`);
    usage();
    process.exit(1);
  }

  const filePath = args.file || process.env.TAKOS_CONFIG_FILE || "takos-config.json";
  const token = args.token || process.env.TAKOS_TOKEN;
  const cookie = args.cookie || process.env.TAKOS_COOKIE;
  const url = args.url || process.env.TAKOS_URL;

  let config;
  try {
    config = await readConfig(filePath);
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }

  let result;
  try {
    result = await requestDiff({
      config,
      force: args.force,
      token,
      cookie,
      url,
    });
  } catch (error) {
    console.error(`Diff request failed: ${error.message || error}`);
    process.exit(1);
  }

  if (result.source) {
    console.log(`Current config source: ${result.source}`);
  }

  printWarnings(result.warnings || []);
  printDiff(result.diff || []);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
