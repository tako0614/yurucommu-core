/**
 * App Bundler CLI
 *
 * Command-line interface for validating and bundling App code.
 *
 * Usage:
 *   npx @takos/app-bundler validate [appDir]
 *   npx @takos/app-bundler bundle [appDir] [outDir]
 */

import * as path from "node:path";
import { bundleApp } from "./bundler.js";
import { validateApp } from "./validator.js";

// ANSI color codes
const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m"
};

function log(message: string): void {
  console.log(message);
}

function logError(message: string): void {
  console.error(`${colors.red}error${colors.reset}: ${message}`);
}

function logWarning(message: string): void {
  console.warn(`${colors.yellow}warning${colors.reset}: ${message}`);
}

function logSuccess(message: string): void {
  console.log(`${colors.green}success${colors.reset}: ${message}`);
}

function logInfo(message: string): void {
  console.log(`${colors.cyan}info${colors.reset}: ${message}`);
}

function printUsage(): void {
  log(`
${colors.cyan}@takos/app-bundler${colors.reset} - App bundler and validator

${colors.yellow}Usage:${colors.reset}
  app-bundler validate [options] [appDir]
  app-bundler bundle [options] [appDir] [outDir]

${colors.yellow}Commands:${colors.reset}
  validate    Validate App manifest and structure
  bundle      Bundle App code for deployment

${colors.yellow}Options:${colors.reset}
  --strict    Enable strict mode (warnings become errors)
  --help      Show this help message
  --version   Show version

${colors.yellow}Examples:${colors.reset}
  app-bundler validate ./app
  app-bundler validate --strict ./app
  app-bundler bundle ./app ./dist/app
`);
}

function printVersion(): void {
  // Read version from package.json
  log("0.1.0");
}

interface ParsedArgs {
  command: string;
  appDir: string;
  outDir?: string;
  strict: boolean;
  help: boolean;
  version: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    command: "",
    appDir: "./app",
    strict: false,
    help: false,
    version: false
  };

  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--strict") {
      result.strict = true;
    } else if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--version" || arg === "-v") {
      result.version = true;
    } else if (!arg.startsWith("-")) {
      positional.push(arg);
    }
  }

  // First positional is command
  if (positional.length > 0) {
    result.command = positional[0];
  }

  // Second positional is appDir
  if (positional.length > 1) {
    result.appDir = positional[1];
  }

  // Third positional is outDir (for bundle command)
  if (positional.length > 2) {
    result.outDir = positional[2];
  }

  return result;
}

async function runValidate(appDir: string, strict: boolean): Promise<number> {
  const resolvedDir = path.resolve(appDir);
  logInfo(`Validating App at ${resolvedDir}`);

  const result = await validateApp({
    appDir: resolvedDir,
    strict
  });

  // Print errors
  for (const error of result.errors) {
    const file = error.location?.file ?? error.file;
    const line = error.location?.line ?? undefined;
    const column = error.location?.column ?? undefined;
    const locSuffix = file
      ? `${colors.dim}${path.relative(process.cwd(), file)}${line ? `:${line}${column ? `:${column}` : ""}` : ""}${colors.reset}`
      : "";
    const jsonPath = error.path ? `${colors.dim} (${error.path})${colors.reset}` : "";
    const code = (error as any).code ? `${colors.dim}[${(error as any).code}]${colors.reset} ` : "";
    const suggestion = (error as any).suggestion ? `${colors.dim} ${(error as any).suggestion}${colors.reset}` : "";
    logError(`${code}${error.message} ${locSuffix}${jsonPath}${suggestion}`);
  }

  // Print warnings
  for (const warning of result.warnings) {
    const file = warning.location?.file ?? warning.file;
    const line = warning.location?.line ?? undefined;
    const column = warning.location?.column ?? undefined;
    const locSuffix = file
      ? `${colors.dim}${path.relative(process.cwd(), file)}${line ? `:${line}${column ? `:${column}` : ""}` : ""}${colors.reset}`
      : "";
    const jsonPath = warning.path ? `${colors.dim} (${warning.path})${colors.reset}` : "";
    const code = (warning as any).code ? `${colors.dim}[${(warning as any).code}]${colors.reset} ` : "";
    const suggestion = (warning as any).suggestion ? `${colors.dim} ${(warning as any).suggestion}${colors.reset}` : "";
    logWarning(`${code}${warning.message} ${locSuffix}${jsonPath}${suggestion}`);
  }

  // Summary
  log("");
  if (result.valid) {
    logSuccess(
      `Validation passed${result.warnings.length > 0 ? ` with ${result.warnings.length} warning(s)` : ""}`
    );
    return 0;
  } else {
    logError(
      `Validation failed with ${result.errors.length} error(s) and ${result.warnings.length} warning(s)`
    );
    return 1;
  }
}

async function runBundle(appDir: string, outDir: string): Promise<number> {
  const resolvedAppDir = path.resolve(appDir);
  const resolvedOutDir = path.resolve(outDir);

  logInfo(`Bundling App at ${resolvedAppDir}`);
  logInfo(`Output directory: ${resolvedOutDir}`);

  // First validate
  const validationResult = await validateApp({
    appDir: resolvedAppDir,
    strict: false
  });

  if (!validationResult.valid) {
    logError("Validation failed. Fix errors before bundling.");
    for (const error of validationResult.errors) {
      logError(error.message);
    }
    return 1;
  }

  // Then bundle
  const result = await bundleApp({
    appDir: resolvedAppDir,
    outDir: resolvedOutDir
  });

  if (!result.success) {
    logError("Bundle failed");
    for (const error of result.errors || []) {
      logError(error.message);
    }
    return 1;
  }

  // Print generated files
  log("");
  log("Generated files:");
  for (const file of result.files) {
    const sizeKb = (file.size / 1024).toFixed(2);
    log(`  ${colors.green}${file.path}${colors.reset} ${colors.dim}(${sizeKb} KB)${colors.reset}`);
  }

  log("");
  logSuccess("Bundle completed successfully");
  return 0;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  if (args.version) {
    printVersion();
    process.exit(0);
  }

  if (!args.command) {
    printUsage();
    process.exit(1);
  }

  let exitCode: number;

  switch (args.command) {
    case "validate":
      exitCode = await runValidate(args.appDir, args.strict);
      break;

    case "bundle":
      exitCode = await runBundle(args.appDir, args.outDir || "./dist/app");
      break;

    default:
      logError(`Unknown command: ${args.command}`);
      printUsage();
      exitCode = 1;
  }

  process.exit(exitCode);
}

main().catch((error) => {
  logError(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
