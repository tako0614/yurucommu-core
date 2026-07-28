/**
 * The ONE sanctioned test-database constructor for yurucommu-core.
 *
 * The suite runs on libsql, whose semantics differ from Cloudflare D1 in ways
 * that silently hide production failures:
 *
 *   1. libsql accepts ~32k bound parameters; D1 rejects anything over 100
 *      ("too many SQL variables"). An unchunked multi-row INSERT or
 *      `inArray(col, ids)` therefore passes CI and destroys data in prod, since
 *      the DELETE that usually precedes such an INSERT has already committed.
 *   2. libsql accepts a LIKE pattern of any complexity; D1 rejects complex ones
 *      ("LIKE or GLOB pattern too complex") — this 500'd every media fetch once
 *      (see routes/media.ts).
 *   3. libsql HONOURS `PRAGMA foreign_keys = OFF`; D1 does not. Migrations that
 *      guard a table rebuild with that PRAGMA are no-ops on D1, so a `DROP
 *      TABLE` there fires every declared `ON DELETE CASCADE` for real.
 *   4. libsql composes `BEGIN`/`COMMIT` across statements; D1 cannot — only
 *      `batch()` is atomic there.
 *
 * `createTestDb()` reproduces all four so a violation fails the test instead of
 * shipping. Tests must not call `createClient(`/`drizzle(` directly; a root
 * gate enforces that this helper is the only constructor.
 */

import { readdir, readFile } from "node:fs/promises";
import { createClient, type Client, type InArgs } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";

/** Hard ceiling enforced by Cloudflare D1 on bound parameters per statement. */
export const D1_MAX_BOUND_PARAMS = 100;

/**
 * LIKE/GLOB pattern ceiling, measured in UTF-8 bytes.
 */
export const D1_MAX_LIKE_COMPLEXITY = 50;

const TRANSACTION_CONTROL_RE = /^\s*(BEGIN|COMMIT|SAVEPOINT|ROLLBACK|END)\b/i;
const FOREIGN_KEYS_OFF_RE = /PRAGMA\s+foreign_keys\s*=\s*(OFF|0|false)/i;
const UTF8_ENCODER = new TextEncoder();

/**
 * Reject a statement that real D1 would reject. Exported so a test can assert
 * the rule itself, and so non-drizzle call paths can opt in.
 *
 * `inBatch` marks statements the driver is issuing as part of an atomic
 * `batch()`; libsql implements that with real transaction control, which is the
 * only legitimate source of BEGIN/COMMIT.
 */
export function assertD1Statement(
  sql: string,
  params: readonly unknown[],
  opts?: { readonly inBatch?: boolean },
): void {
  if (params.length > D1_MAX_BOUND_PARAMS) {
    throw new Error(
      `D1_ERROR: too many SQL variables: statement bound ${params.length} ` +
        `parameters but D1 allows at most ${D1_MAX_BOUND_PARAMS} per query. ` +
        `Chunk the write with insertMany()/replaceSet() or the id list with ` +
        `inChunks() (src/db/d1-write.ts).\n  ${sql.slice(0, 400)}`,
    );
  }

  if (params.some((param) => param === undefined)) {
    throw new TypeError(
      "D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined'",
    );
  }

  if (!opts?.inBatch && TRANSACTION_CONTROL_RE.test(sql)) {
    throw new Error(
      `D1_ERROR: transaction control ("${sql.trim().split(/\s+/)[0]}") cannot ` +
        `be composed across D1's stateless prepared statements. Use ` +
        `db.batch([...]) / replaceSet() for atomicity.`,
    );
  }

  if (FOREIGN_KEYS_OFF_RE.test(sql)) {
    throw new Error(
      `D1_ERROR: "PRAGMA foreign_keys = OFF" is NOT honoured by D1. A table ` +
        `rebuild guarded by it still fires every declared ON DELETE CASCADE. ` +
        `Rebuild the referencing table without the FK instead.`,
    );
  }

  for (const pattern of likeGlobPatterns(sql, params)) {
    const bytes = UTF8_ENCODER.encode(pattern).byteLength;
    if (bytes > D1_MAX_LIKE_COMPLEXITY) {
      throw new Error(
        `D1_ERROR: LIKE or GLOB pattern too complex (${bytes} UTF-8 bytes > ${D1_MAX_LIKE_COMPLEXITY} bytes). ` +
          `Use instr(lower(col), lower(q)) > 0 for literal substring search.`,
      );
    }
  }
}

type SqlToken =
  | { readonly kind: "word"; readonly value: string }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "parameter"; readonly index: number }
  | { readonly kind: "symbol"; readonly value: string };

function likeGlobPatterns(
  sql: string,
  params: readonly unknown[],
): readonly string[] {
  const tokens = sqlTokens(sql);
  const patterns: string[] = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const operator = tokens[index];
    if (
      operator?.kind !== "word" ||
      (operator.value !== "LIKE" && operator.value !== "GLOB")
    ) {
      continue;
    }
    const pattern = patternExpression(tokens, index + 1, params);
    if (pattern !== undefined) patterns.push(pattern);
  }
  return patterns;
}

function patternExpression(
  tokens: readonly SqlToken[],
  start: number,
  params: readonly unknown[],
): string | undefined {
  const first = patternAtom(tokens[start], params);
  if (first === undefined) return undefined;
  let value = first;
  let index = start + 1;
  while (true) {
    const separator = tokens[index];
    if (separator?.kind !== "symbol" || separator.value !== "||") break;
    const next = patternAtom(tokens[index + 1], params);
    if (next === undefined) break;
    value += next;
    index += 2;
  }
  return value;
}

function patternAtom(
  token: SqlToken | undefined,
  params: readonly unknown[],
): string | undefined {
  if (token?.kind === "string") return token.value;
  if (token?.kind !== "parameter") return undefined;
  const value = params[token.index];
  return typeof value === "string" ? value : undefined;
}

function sqlTokens(sql: string): readonly SqlToken[] {
  const tokens: SqlToken[] = [];
  let index = 0;
  let largestParameter = 0;
  while (index < sql.length) {
    const character = sql[index]!;
    const next = sql[index + 1];
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    if (character === "-" && next === "-") {
      index = skipLineComment(sql, index + 2);
      continue;
    }
    if (character === "/" && next === "*") {
      index = skipBlockComment(sql, index + 2);
      continue;
    }
    if (character === "'") {
      const literal = readQuoted(sql, index, "'", true);
      tokens.push({ kind: "string", value: literal.value });
      index = literal.next;
      continue;
    }
    if (character === '"' || character === "`" || character === "[") {
      index = readQuoted(
        sql,
        index,
        character === "[" ? "]" : character,
        character !== "[",
      ).next;
      continue;
    }
    if (character === "?") {
      const match = /^\?([0-9]*)/u.exec(sql.slice(index))!;
      const explicit = match[1] ? Number(match[1]) : undefined;
      const parameter = explicit ?? largestParameter + 1;
      largestParameter = Math.max(largestParameter, parameter);
      tokens.push({ kind: "parameter", index: parameter - 1 });
      index += match[0].length;
      continue;
    }
    if (/[A-Za-z_]/u.test(character)) {
      const match = /^[A-Za-z_][A-Za-z0-9_$]*/u.exec(sql.slice(index))!;
      tokens.push({ kind: "word", value: match[0].toUpperCase() });
      index += match[0].length;
      continue;
    }
    if (character === "|" && next === "|") {
      tokens.push({ kind: "symbol", value: "||" });
      index += 2;
      continue;
    }
    tokens.push({ kind: "symbol", value: character });
    index += 1;
  }
  return tokens;
}

function readQuoted(
  text: string,
  start: number,
  end: string,
  doubledEscape: boolean,
): { readonly value: string; readonly next: number } {
  let value = "";
  let index = start + 1;
  while (index < text.length) {
    const character = text[index]!;
    if (character === end && doubledEscape && text[index + 1] === end) {
      value += end;
      index += 2;
      continue;
    }
    if (character === end) return { value, next: index + 1 };
    value += character;
    index += 1;
  }
  return { value, next: index };
}

function skipLineComment(text: string, start: number): number {
  const newline = text.indexOf("\n", start);
  return newline < 0 ? text.length : newline + 1;
}

function skipBlockComment(text: string, start: number): number {
  const close = text.indexOf("*/", start);
  return close < 0 ? text.length : close + 2;
}

function argsToArray(args: InArgs | undefined): readonly unknown[] {
  if (!args) return [];
  return Array.isArray(args) ? args : Object.values(args);
}

/**
 * Wrap a libsql client so every statement it executes passes
 * {@link assertD1Statement} first. This is the single execution chokepoint:
 * drizzle's libsql driver funnels every query through `execute`/`batch`.
 */
function enforceD1Semantics(client: Client): Client {
  const wrapped: Client = Object.create(client) as Client;

  wrapped.execute = ((stmt: unknown, ...rest: unknown[]) => {
    if (typeof stmt === "string") {
      assertD1Statement(stmt, []);
    } else {
      const s = stmt as { sql: string; args?: InArgs };
      assertD1Statement(s.sql, argsToArray(s.args));
    }
    return (client.execute as unknown as (...a: unknown[]) => Promise<unknown>)(
      stmt,
      ...rest,
    );
  }) as Client["execute"];

  wrapped.batch = ((stmts: unknown, ...rest: unknown[]) => {
    for (const stmt of stmts as unknown[]) {
      if (typeof stmt === "string") {
        assertD1Statement(stmt, [], { inBatch: true });
      } else {
        const s = stmt as { sql: string; args?: InArgs };
        assertD1Statement(s.sql, argsToArray(s.args), { inBatch: true });
      }
    }
    return (client.batch as unknown as (...a: unknown[]) => Promise<unknown>)(
      stmts,
      ...rest,
    );
  }) as Client["batch"];

  // `executeMultiple` runs a whole migration script; bind it explicitly because
  // the prototype-based wrapper otherwise loses `this` for a method that uses
  // private fields. It is intentionally NOT parameter-checked: a migration
  // script binds no parameters.
  wrapped.executeMultiple = client.executeMultiple.bind(client);

  return wrapped;
}

/**
 * Strip statements that D1 would ignore, so the migration is applied under D1
 * semantics rather than libsql's. Only `PRAGMA foreign_keys` /
 * `defer_foreign_keys` lines qualify: D1 keeps FK enforcement ON regardless,
 * and honouring them locally is exactly what hid the surviving
 * `inbox -> activities ON DELETE CASCADE`.
 */
export function stripPragmasNotHonouredByD1(sql: string): string {
  return sql
    .split("\n")
    .filter(
      (line) =>
        !/^\s*PRAGMA\s+(foreign_keys|defer_foreign_keys)\s*=/i.test(line),
    )
    .join("\n");
}

export type TestDb = {
  readonly db: Database;
  readonly client: Client;
  /** Migration file names applied, in order. */
  readonly applied: readonly string[];
};

const MIGRATIONS_DIR = new URL("../../../../migrations/", import.meta.url);

export async function listMigrationFiles(): Promise<string[]> {
  return (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export async function readMigration(name: string): Promise<string> {
  return await readFile(new URL(name, MIGRATIONS_DIR), "utf8");
}

/**
 * Fresh in-memory database with the shipped migrations applied under D1
 * semantics: foreign keys ON (D1 enforces them and ignores any PRAGMA that
 * says otherwise) and every subsequent statement checked against D1's limits.
 */
export async function createTestDb(opts?: {
  /** Apply only up to and including this migration file name. */
  readonly through?: string;
  /** Skip migrations entirely (schema-less fixture). */
  readonly migrate?: boolean;
}): Promise<TestDb> {
  const client = createClient({ url: ":memory:" });
  // D1 enforces declared foreign keys and does not honour a PRAGMA turning
  // them off, so the test engine must match. libsql already defaults ON; this
  // is explicit so a future default change cannot silently diverge.
  await client.execute("PRAGMA foreign_keys = ON");

  const applied: string[] = [];
  if (opts?.migrate !== false) {
    for (const file of await listMigrationFiles()) {
      await client.executeMultiple(
        stripPragmasNotHonouredByD1(await readMigration(file)),
      );
      applied.push(file);
      if (opts?.through && file === opts.through) break;
    }
  }

  const guarded = enforceD1Semantics(client);
  return {
    db: drizzle(guarded, { schema }) as unknown as Database,
    client: guarded,
    applied,
  };
}
