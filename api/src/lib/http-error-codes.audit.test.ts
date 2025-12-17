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
    out.push(fullPath);
  }
  return out;
};

type HttpErrorUse = {
  file: string;
  line: number;
  codeExpr: string;
};

const getLineNumber = (source: string, index: number): number =>
  source.slice(0, index).split("\n").length;

const extractHttpErrorUses = (file: string, source: string): HttpErrorUse[] => {
  const uses: HttpErrorUse[] = [];
  const re = /new\s+HttpError\s*\(\s*([^,]+?)\s*,\s*([^,]+?)\s*,/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const codeExpr = (match[2] || "").trim();
    uses.push({
      file,
      line: getLineNumber(source, match.index),
      codeExpr,
    });
  }
  return uses;
};

const parseStringLiteral = (expr: string): string | null => {
  const trimmed = expr.trim();
  const m = trimmed.match(/^"([A-Z0-9_]+)"$/) ?? trimmed.match(/^'([A-Z0-9_]+)'$/);
  return m ? m[1] : null;
};

describe("HttpError codes", () => {
  it("uses known error codes for HttpError constructors", () => {
    const files = walkFiles(SRC_ROOT).filter((file) => !file.endsWith(".test.ts"));

    const violations: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      for (const use of extractHttpErrorUses(file, source)) {
        const literal = parseStringLiteral(use.codeExpr);
        if (literal) {
          if (!isErrorCode(literal)) {
            violations.push(`${path.relative(SRC_ROOT, use.file)}:${use.line} invalid code "${literal}"`);
          }
          continue;
        }

        if (use.codeExpr.startsWith("ErrorCodes.")) {
          continue;
        }
        if (use.codeExpr.includes("ErrorCodes.")) {
          continue;
        }

        violations.push(
          `${path.relative(SRC_ROOT, use.file)}:${use.line} HttpError code must be string literal or ErrorCodes.* (got: ${use.codeExpr})`,
        );
      }
    }

    expect(violations).toEqual([]);
  });
});
