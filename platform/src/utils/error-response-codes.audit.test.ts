import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

const API_ERROR_CODES_PATH = path.resolve(dirname, "../../../api/src/lib/error-codes.ts");
const PLATFORM_ROOT = path.resolve(dirname, "..");

const extractErrorCodesFromApi = (): Set<string> => {
  const source = fs.readFileSync(API_ERROR_CODES_PATH, "utf8");
  const anchor = "export const ErrorCodes";
  const start = source.indexOf(anchor);
  if (start === -1) {
    throw new Error(`Failed to locate ErrorCodes in ${API_ERROR_CODES_PATH}`);
  }
  const braceStart = source.indexOf("{", start);
  if (braceStart === -1) {
    throw new Error(`Failed to locate ErrorCodes object start in ${API_ERROR_CODES_PATH}`);
  }

  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) {
    throw new Error(`Failed to locate ErrorCodes object end in ${API_ERROR_CODES_PATH}`);
  }

  const body = source.slice(braceStart + 1, end);
  const codes = new Set<string>();
  const keyRe = /^\s*([A-Z0-9_]+)\s*:/gm;
  let match: RegExpExecArray | null;
  while ((match = keyRe.exec(body))) {
    codes.add(match[1]);
  }
  if (codes.size < 20) {
    throw new Error(`Unexpectedly small ErrorCodes set (${codes.size}) from ${API_ERROR_CODES_PATH}`);
  }
  return codes;
};

const walkFiles = (dir: string): string[] => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(fullPath));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!fullPath.endsWith(".ts")) continue;
    if (fullPath.endsWith(".d.ts")) continue;
    if (fullPath.endsWith(".test.ts")) continue;
    out.push(fullPath);
  }
  return out;
};

const extractCodeLiterals = (source: string): Array<{ value: string; index: number }> => {
  const out: Array<{ value: string; index: number }> = [];
  const re = /\bcode\s*:\s*["']([A-Z0-9_]+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    out.push({ value: match[1], index: match.index });
  }
  return out;
};

const getLineNumber = (source: string, index: number): number => source.slice(0, index).split("\n").length;

describe("platform ErrorResponse code literals", () => {
  it("uses codes aligned with api ErrorCodes in response helpers and ActivityPub", () => {
    const allowed = extractErrorCodesFromApi();

    const scopedDirs = [
      path.join(PLATFORM_ROOT, "activitypub"),
      path.join(PLATFORM_ROOT, "utils"),
      path.join(PLATFORM_ROOT, "guards.ts"),
    ];

    const files = scopedDirs.flatMap((target) => {
      if (!fs.existsSync(target)) return [];
      const stat = fs.statSync(target);
      if (stat.isFile()) return [target];
      return walkFiles(target);
    });

    const violations: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      for (const hit of extractCodeLiterals(source)) {
        if (!allowed.has(hit.value)) {
          violations.push(`${path.relative(PLATFORM_ROOT, file)}:${getLineNumber(source, hit.index)} unknown code "${hit.value}"`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

