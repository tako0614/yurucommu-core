#!/usr/bin/env node

import { validateManifestFile, type ValidationResult } from "./validator.js";

function printUsage(): void {
  console.log(`Usage: app-bundler-validate [options] <manifest-file>

Options:
  -h, --help     Show this help message
  -j, --json     Output as JSON
  -q, --quiet    Only output errors (no warnings)

Examples:
  app-bundler-validate app/manifest.json
  app-bundler-validate --json dist/app-manifest.json
`);
}

interface CliOptions {
  json: boolean;
  quiet: boolean;
  help: boolean;
  file: string | null;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    json: false,
    quiet: false,
    help: false,
    file: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "-j":
      case "--json":
        options.json = true;
        break;
      case "-q":
      case "--quiet":
        options.quiet = true;
        break;
      default:
        if (!arg.startsWith("-")) {
          options.file = arg;
        }
        break;
    }
  }

  return options;
}

function formatResult(result: ValidationResult, options: CliOptions): string {
  if (options.json) {
    return JSON.stringify(result, null, 2);
  }

  const lines: string[] = [];

  if (result.errors.length > 0) {
    lines.push("Errors:");
    for (const error of result.errors) {
      const pathInfo = error.path ? ` (${error.path})` : "";
      lines.push(`  ✗ [${error.code}]${pathInfo}: ${error.message}`);
    }
  }

  if (!options.quiet && result.warnings.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("Warnings:");
    for (const warning of result.warnings) {
      const pathInfo = warning.path ? ` (${warning.path})` : "";
      lines.push(`  ⚠ [${warning.code}]${pathInfo}: ${warning.message}`);
    }
  }

  if (result.valid) {
    lines.push("");
    lines.push("✓ Manifest is valid");
    if (result.warnings.length > 0 && !options.quiet) {
      lines.push(`  (${result.warnings.length} warning(s))`);
    }
  } else {
    lines.push("");
    lines.push(`✗ Manifest is invalid (${result.errors.length} error(s))`);
  }

  return lines.join("\n");
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printUsage();
    process.exit(0);
  }

  if (!options.file) {
    console.error("Error: No manifest file specified\n");
    printUsage();
    process.exit(1);
  }

  const result = validateManifestFile(options.file);
  console.log(formatResult(result, options));
  process.exit(result.valid ? 0 : 1);
}

main();
