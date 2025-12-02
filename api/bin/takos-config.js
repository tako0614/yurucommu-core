#!/usr/bin/env node

const { readFile, writeFile } = require("node:fs/promises");

function usage() {
  const script = "npm exec takos-config --";
  console.log(
    [
      "takos-config helper CLI",
      "",
      `Usage: ${script} <command> [options]`,
      "",
      "Commands:",
      "  export  Fetch the current config from the server (/admin/config/export)",
      "  diff    Show differences between the current config and a file (/admin/config/diff)",
      "  import  Apply a config file to the server (/admin/config/import)",
      "",
      "Options:",
      "  --file <path>   Input takos-config.json (default: takos-config.json, use - for stdin) [diff/import]",
      "  --out <path>    Write export output to a file instead of stdout [export]",
      "  --url <url>     Base URL of the takos backend (default: http://127.0.0.1:8787 or TAKOS_URL)",
      "  --token <jwt>   Bearer token used for Authorization (env: TAKOS_TOKEN)",
      "  --cookie <c>    Cookie header value to forward (env: TAKOS_COOKIE)",
      "  --force         Allow cross-major distro imports (passes ?force=true on diff/import)",
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
      case "export":
        args.command = "export";
        break;
      case "diff":
        args.command = "diff";
        break;
      case "import":
        args.command = "import";
        break;
      case "--file":
        args.file = input.shift();
        break;
      case "--out":
        args.out = input.shift();
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

const buildBaseUrl = (url) => (url || "http://127.0.0.1:8787").replace(/\/+$/, "");

function buildHeaders(options) {
  const headers = { "content-type": "application/json" };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.cookie) {
    headers.Cookie = options.cookie;
  }
  return headers;
}

async function requestExport(options) {
  const baseUrl = buildBaseUrl(options.url);
  const endpoint = `${baseUrl}/admin/config/export`;
  const headers = buildHeaders(options);

  const response = await fetch(endpoint, { method: "GET", headers });

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

async function requestDiff(options) {
  const baseUrl = buildBaseUrl(options.url);
  const query = options.force ? "?force=true" : "";
  const endpoint = `${baseUrl}/admin/config/diff${query}`;
  const headers = buildHeaders(options);

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

async function requestImport(options) {
  const baseUrl = buildBaseUrl(options.url);
  const query = options.force ? "?force=true" : "";
  const endpoint = `${baseUrl}/admin/config/import${query}`;
  const headers = buildHeaders(options);

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

function printReloadResult(reload = {}) {
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
  if (reload.warnings?.length) {
    console.log("- reload warnings:");
    reload.warnings.forEach((warning) => console.log(`  - ${warning}`));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }

  const filePath = args.file || process.env.TAKOS_CONFIG_FILE || "takos-config.json";
  const token = args.token || process.env.TAKOS_TOKEN;
  const cookie = args.cookie || process.env.TAKOS_COOKIE;
  const url = args.url || process.env.TAKOS_URL;

  if (args.command === "export") {
    let exportResult;
    try {
      exportResult = await requestExport({ token, cookie, url });
    } catch (error) {
      console.error(`Export request failed: ${error.message || error}`);
      process.exit(1);
    }

    if (exportResult.source) {
      console.log(`Config source: ${exportResult.source}`);
    }
    printWarnings(exportResult.warnings || []);

    const serialized = JSON.stringify(exportResult.config, null, 2);
    const outPath = args.out;

    if (outPath && outPath !== "-") {
      try {
        await writeFile(outPath, `${serialized}\n`, "utf8");
        console.log(`Wrote config export to ${outPath}`);
      } catch (error) {
        console.error(`Failed to write export to ${outPath}: ${error.message || error}`);
        process.exit(1);
      }
    } else {
      console.log(serialized);
    }
    return;
  }

  if (args.command !== "diff" && args.command !== "import") {
    console.error(`Unknown command: ${args.command}`);
    usage();
    process.exit(1);
  }

  let config;
  try {
    config = await readConfig(filePath);
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }

  if (args.command === "diff") {
    let diffResult;
    try {
      diffResult = await requestDiff({
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

    if (diffResult.source) {
      console.log(`Current config source: ${diffResult.source}`);
    }

    printWarnings(diffResult.warnings || []);
    printDiff(diffResult.diff || []);
    return;
  }

  let importResult;
  try {
    importResult = await requestImport({
      config,
      force: args.force,
      token,
      cookie,
      url,
    });
  } catch (error) {
    console.error(`Import request failed: ${error.message || error}`);
    process.exit(1);
  }

  printWarnings(importResult.warnings || []);
  console.log("Config import applied.");
  printReloadResult(importResult.reload);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
