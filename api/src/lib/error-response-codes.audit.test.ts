import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isErrorCode } from "./error-codes";

const SRC_ROOT = path.join(__dirname, "..");

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

describe("ErrorResponse code literals", () => {
  it("uses known ErrorCodes in api code paths", () => {
    const files = [
      path.join(SRC_ROOT, "index.ts"),
      path.join(SRC_ROOT, "routes"),
      path.join(SRC_ROOT, "lib"),
    ].flatMap((target) => {
      if (!fs.existsSync(target)) return [];
      const stat = fs.statSync(target);
      if (stat.isFile()) return [target];
      return walkFiles(target);
    });

    const violations: string[] = [];
    for (const file of files) {
      if (file.endsWith(path.join("lib", "error-codes.ts"))) continue;
      const source = fs.readFileSync(file, "utf8");
      for (const hit of extractCodeLiterals(source)) {
        if (!isErrorCode(hit.value)) {
          violations.push(`${path.relative(SRC_ROOT, file)}:${getLineNumber(source, hit.index)} unknown code "${hit.value}"`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

