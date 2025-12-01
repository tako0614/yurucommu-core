#!/usr/bin/env node

const { existsSync } = require("node:fs");
const { mkdir, writeFile } = require("node:fs/promises");
const path = require("node:path");

function usage() {
  const script = "npm exec ai-action:init -- --id ai.example";
  const alias = "npm exec ai-action -- --id ai.example";
  console.log(
    [
      "Generate a scaffold for a new AI action (definition, handler, test).",
      "",
      `Usage: ${script} [--label <label>] [--description <text>] [--dir <path>] [--force]`,
      `Alias: ${alias} [--label <label>] [--description <text>] [--dir <path>] [--force]`,
      "",
      "Options:",
      "  --id            Action ID (e.g. ai.summary)",
      "  --label         Human readable label (optional)",
      "  --description   Description for admins (optional)",
      "  --dir           Base output directory (default: src/ai/actions)",
      "  --force         Overwrite existing files",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const args = { force: false };
  const input = [...argv];
  while (input.length) {
    const current = input.shift();
    switch (current) {
      case "--id":
        args.id = input.shift();
        break;
      case "--label":
        args.label = input.shift();
        break;
      case "--description":
        args.description = input.shift();
        break;
      case "--dir":
        args.dir = input.shift();
        break;
      case "--force":
        args.force = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        if (!args.id) {
          args.id = current;
        }
        break;
    }
  }
  return args;
}

function toSlug(id) {
  return (id || "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function escapeForTs(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function deriveLabel(id) {
  const parts = (id || "")
    .split(/[\.\-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1));
  return parts.length ? parts.join(" ") : "New AI Action";
}

function buildActionTemplate(actionId, label, description) {
  const slug = toSlug(actionId);
  const typeName = slug.replace(/(?:^|-)([a-z0-9])/g, (_, char) => char.toUpperCase());
  const safeId = escapeForTs(actionId);
  const safeLabel = escapeForTs(label);
  const safeDescription = escapeForTs(description);
  return `import type {
  AiAction,
  AiActionDefinition,
  AiActionHandler,
  JsonSchema,
} from "@takos/platform/server";

export type ${typeName}Input = Record<string, never>;

export type ${typeName}Output = {
  status: "not_implemented";
};

const inputSchema: JsonSchema = {
  type: "object",
  properties: {
    // TODO: describe expected input fields
  },
  required: [],
};

const outputSchema: JsonSchema = {
  type: "object",
  properties: {
    status: { type: "string", const: "not_implemented" },
    // TODO: describe fields returned to callers
  },
  required: ["status"],
};

const definition: AiActionDefinition = {
  id: "${safeId}",
  label: "${safeLabel}",
  description: "${safeDescription}",
  inputSchema,
  outputSchema,
  providerCapabilities: ["chat"],
  dataPolicy: {
    // TODO: mark true for every data type this action may send to the AI provider.
    sendPublicPosts: false,
    sendCommunityPosts: false,
    sendDm: false,
    sendProfile: false,
    notes: "TODO: describe why this action needs each data slice and any redaction applied.",
  },
};

const handler: AiActionHandler<${typeName}Input, ${typeName}Output> = async (
  _ctx,
  _input,
) => {
  return {
    status: "not_implemented",
  };
};

export const aiAction: AiAction<${typeName}Input, ${typeName}Output> = {
  definition,
  handler,
};

export default aiAction;
`;
}

function buildTestTemplate(actionId) {
  const safeId = escapeForTs(actionId);
  return `import { describe, expect, it } from "vitest";
import { aiAction } from "./action";

describe("${safeId} scaffold", () => {
  it("carries the requested action id", () => {
    expect(aiAction.definition.id).toBe("${safeId}");
  });

  it("returns placeholder output for now", async () => {
    const result = await aiAction.handler(
      { nodeConfig: { ai: { enabled: true, enabled_actions: ["${safeId}"] } } } as any,
      {} as any,
    );
    expect(result.status).toBe("not_implemented");
  });
});
`;
}

async function ensureDir(targetDir) {
  await mkdir(targetDir, { recursive: true });
}

async function writeFileSafe(targetPath, contents, force) {
  if (!force && existsSync(targetPath)) {
    throw new Error(`Refusing to overwrite existing file: ${targetPath}`);
  }
  await writeFile(targetPath, contents, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.id) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const actionId = args.id.trim();
  if (!actionId) {
    console.error("Error: --id is required.");
    process.exit(1);
  }

  const slug = toSlug(actionId);
  if (!slug) {
    console.error("Error: could not derive a file-safe slug from the action id.");
    process.exit(1);
  }

  const projectRoot = path.resolve(__dirname, "..");
  const baseDir = args.dir
    ? path.resolve(process.cwd(), args.dir)
    : path.join(projectRoot, "src", "ai", "actions");
  const targetDir = path.join(baseDir, slug);
  const actionPath = path.join(targetDir, "action.ts");
  const testPath = path.join(targetDir, "action.test.ts");

  const label = args.label || deriveLabel(actionId);
  const description = args.description || "TODO: describe what this action does for admins.";

  await ensureDir(targetDir);
  await writeFileSafe(actionPath, buildActionTemplate(actionId, label, description), args.force);
  await writeFileSafe(testPath, buildTestTemplate(actionId), args.force);

  const relativeActionPath = path.relative(process.cwd(), actionPath);
  const relativeTestPath = path.relative(process.cwd(), testPath);
  console.log(`Created ${relativeActionPath}`);
  console.log(`Created ${relativeTestPath}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
