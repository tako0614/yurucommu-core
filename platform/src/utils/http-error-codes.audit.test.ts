import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

const PLATFORM_SRC_ROOT = path.resolve(dirname, "..");
const API_ERROR_CODES_PATH = path.resolve(dirname, "../../../api/src/lib/error-codes.ts");

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

type HttpErrorUse = {
  file: string;
  line: number;
  codeExpr: string;
};

const getLineNumber = (source: string, index: number): number => source.slice(0, index).split("\n").length;

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

describe("platform HttpError codes", () => {
  it("uses known error codes (aligned with api ErrorCodes)", () => {
    const allowed = extractErrorCodesFromApi();
    const files = walkFiles(PLATFORM_SRC_ROOT).filter((file) => !file.endsWith(".test.ts"));

    const violations: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      for (const use of extractHttpErrorUses(file, source)) {
        const literal = parseStringLiteral(use.codeExpr);
        if (!literal) {
          violations.push(
            `${path.relative(PLATFORM_SRC_ROOT, use.file)}:${use.line} HttpError code must be a string literal (got: ${use.codeExpr})`,
          );
          continue;
        }
        if (!allowed.has(literal)) {
          violations.push(`${path.relative(PLATFORM_SRC_ROOT, use.file)}:${use.line} unknown code "${literal}"`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

