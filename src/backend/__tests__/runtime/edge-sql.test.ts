import { beforeEach, describe, expect, test } from "bun:test";
import { Database as BunSqlite } from "bun:sqlite";
import { eq, sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import {
  EdgeSqlShapeError,
  createEdgeSqlDatabase,
} from "../../runtime/edge-sql.ts";
import {
  ProxyColumnMismatchError,
  rewriteProjection,
} from "../../runtime/sqlite-proxy-rows.ts";
import {
  decodeEdgeBytes,
  encodeEdgeBytes,
  isEdgeEncodedBytes,
  type EdgeSqlBinding,
  type EdgeSqlResult,
  type EdgeSqlValue,
} from "../../runtime/edge-facades.ts";

// Two tables that COLLIDE on column names, because that is the shape the
// facade's record-per-row cannot represent and the adapter exists to survive.
const authors = sqliteTable("authors", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
});

const books = sqliteTable("books", {
  id: text("id").primaryKey(),
  authorId: text("author_id").notNull(),
  title: text("title").notNull(),
  pages: integer("pages"),
  cover: text("cover", { mode: "json" }),
  createdAt: text("created_at").notNull(),
});

const blobs = sqliteTable("blobs", {
  id: text("id").primaryKey(),
  payload: text("payload"),
});

const SCHEMA_SQL = [
  `create table authors (id text primary key, name text not null, created_at text not null)`,
  `create table books (id text primary key, author_id text not null, title text not null, pages integer, cover text, created_at text not null)`,
  `create table blobs (id text primary key, payload blob)`,
];

/**
 * A faithful stand-in for the Host's `edge.sql` binding.
 *
 * The important fidelity is that it returns ROWS AS RECORDS built by the
 * SQLite driver itself, so a duplicate result-column name collapses here
 * exactly as it does on a real Host — which is what makes the join test below
 * a real test and not a restatement of the adapter.
 */
function createFakeEdgeSql(store: BunSqlite): EdgeSqlBinding & {
  readonly statements: { sql: string; params: readonly EdgeSqlValue[] }[];
} {
  const statements: { sql: string; params: readonly EdgeSqlValue[] }[] = [];

  const toNative = (value: EdgeSqlValue): unknown =>
    isEdgeEncodedBytes(value) ? decodeEdgeBytes(value) : value;

  const fromNative = (value: unknown): EdgeSqlValue => {
    if (value === null || value === undefined) return null;
    if (typeof value === "string" || typeof value === "number") return value;
    if (typeof value === "bigint") return Number(value);
    if (value instanceof Uint8Array) return encodeEdgeBytes(value);
    throw new Error(`unsupported native value: ${String(value)}`);
  };

  const run = (sqlText: string, params?: readonly EdgeSqlValue[]) => {
    statements.push({ sql: sqlText, params: params ?? [] });
    const bound = (params ?? []).map(toNative) as never[];
    const rows = store.query(sqlText).all(...bound) as Record<
      string,
      unknown
    >[];
    const writes = /^\s*(insert|update|delete|replace)\b/i.test(sqlText);
    const changes = writes
      ? Number((store.query("select changes() as c").get() as { c: number }).c)
      : 0;
    return {
      rows: rows.map((row) => {
        const projected: Record<string, EdgeSqlValue> = {};
        for (const [key, value] of Object.entries(row)) {
          projected[key] = fromNative(value);
        }
        return projected;
      }),
      rowsWritten: changes,
    } satisfies EdgeSqlResult;
  };

  return {
    statements,
    execute: async (sqlText, params) => run(sqlText, params),
    query: async (sqlText, params) => {
      const result = run(sqlText, params);
      if (result.rowsWritten !== 0) {
        const error = new Error("backend_unavailable");
        error.name = "backend_unavailable";
        throw error;
      }
      return result;
    },
    transaction: async (input) => {
      // All-or-none, exactly like the Host: one throw discards the whole set.
      return store.transaction(() =>
        input.map((entry) => run(entry.sql, entry.params)),
      )();
    },
  };
}

describe("edge.sql projection rewrite", () => {
  test("gives every unaliased column a distinct name and counts them", () => {
    const rewritten = rewriteProjection(
      `select "a"."id", "b"."id" from "a" inner join "b" on "a"."id" = "b"."id"`,
    );
    expect(rewritten.sql).toBe(
      `select "a"."id" as "__c0", "b"."id" as "__c1" from "a" inner join "b" on "a"."id" = "b"."id"`,
    );
    expect(rewritten.columns).toBe(2);
  });

  test("leaves an item that already names itself alone", () => {
    const rewritten = rewriteProjection(
      `select "a" as "kept", "b" from "t" where "c" = ?`,
    );
    expect(rewritten.sql).toBe(
      `select "a" as "kept", "b" as "__c1" from "t" where "c" = ?`,
    );
    expect(rewritten.columns).toBe(2);
  });

  test("rewrites a returning list and ignores a write without one", () => {
    expect(
      rewriteProjection(
        `insert into "t" ("a", "b") values (?, ?) returning "a", "b"`,
      ),
    ).toEqual({
      sql: `insert into "t" ("a", "b") values (?, ?) returning "a" as "__c0", "b" as "__c1"`,
      columns: 2,
    });
    const update = `update "t" set "a" = ?, "b" = ? where "c" = ?`;
    expect(rewriteProjection(update)).toEqual({
      sql: update,
      columns: undefined,
    });
  });

  test("does not reach inside a subquery, a literal, or a cast", () => {
    const source = `select "t"."a", (select count(*) from "b" where "b"."x" = ','), cast("c" as integer) from "t"`;
    const rewritten = rewriteProjection(source);
    expect(rewritten.columns).toBe(3);
    expect(rewritten.sql).toContain(
      `(select count(*) from "b" where "b"."x" = ',') as "__c1"`,
    );
    expect(rewritten.sql).toContain(`cast("c" as integer) as "__c2"`);
  });

  test("declines a shape it cannot rename rather than guessing", () => {
    for (const statement of [
      `select * from "t"`,
      `pragma foreign_keys = off`,
      `create table "t" ("a" text)`,
    ]) {
      expect(rewriteProjection(statement)).toEqual({
        sql: statement,
        columns: undefined,
      });
    }
  });

  test("skips distinct and stops at the first top-level clause keyword", () => {
    expect(
      rewriteProjection(`select distinct "a"."x" from "a" order by "a"."x"`),
    ).toEqual({
      sql: `select distinct "a"."x" as "__c0" from "a" order by "a"."x"`,
      columns: 1,
    });
  });
});

describe("edge.sql drizzle round trip", () => {
  let store: BunSqlite;
  let facade: ReturnType<typeof createFakeEdgeSql>;
  let db: ReturnType<typeof createEdgeSqlDatabase>;

  beforeEach(() => {
    store = new BunSqlite(":memory:");
    for (const statement of SCHEMA_SQL) store.run(statement);
    facade = createFakeEdgeSql(store);
    db = createEdgeSqlDatabase(facade);
  });

  test("inserts and reads back through the facade", async () => {
    await db
      .insert(authors)
      .values({ id: "a1", name: "Ada", createdAt: "2026-01-01" });
    const rows = await db.select().from(authors);
    expect(rows).toEqual([{ id: "a1", name: "Ada", createdAt: "2026-01-01" }]);
  });

  test("returns the RETURNING rows of a write", async () => {
    const returned = await db
      .insert(books)
      .values({
        id: "b1",
        authorId: "a1",
        title: "Notes",
        pages: 12,
        cover: null,
        createdAt: "2026-01-02",
      })
      .returning({ id: books.id, title: books.title });
    expect(returned).toEqual([{ id: "b1", title: "Notes" }]);
  });

  test("reports rows affected for a run so affectedRowCount can read it", async () => {
    await db
      .insert(authors)
      .values({ id: "a1", name: "Ada", createdAt: "2026-01-01" });
    const result = (await db
      .update(authors)
      .set({ name: "Ada L." })
      .where(eq(authors.id, "a1"))) as unknown as {
      meta: { changes: number };
    };
    expect(result.meta.changes).toBe(1);
  });

  test("maps a join whose result columns collide on both sides", async () => {
    // Without the projection rewrite the facade's record keeps ONE `id` and one
    // `created_at`, and every field after the collision shifts by one — the
    // silent mis-read this whole adapter exists to prevent.
    await db
      .insert(authors)
      .values({ id: "a1", name: "Ada", createdAt: "2026-01-01" });
    await db.insert(books).values({
      id: "b1",
      authorId: "a1",
      title: "Notes",
      pages: 12,
      cover: null,
      createdAt: "2026-01-02",
    });

    const joined = await db
      .select()
      .from(books)
      .innerJoin(authors, eq(books.authorId, authors.id));

    expect(joined).toEqual([
      {
        books: {
          id: "b1",
          authorId: "a1",
          title: "Notes",
          pages: 12,
          cover: null,
          createdAt: "2026-01-02",
        },
        authors: { id: "a1", name: "Ada", createdAt: "2026-01-01" },
      },
    ]);

    // Prove the rewrite really happened rather than the driver having been
    // lucky: the statement that went out carries the generated names.
    const select = facade.statements.at(-1)!.sql;
    expect(select).toContain(`as "__c0"`);
    expect(select).toContain(`as "__c6"`);
  });

  test("get() on an empty result is undefined, not a row of undefineds", async () => {
    const missing = await db
      .select()
      .from(authors)
      .where(eq(authors.id, "nobody"))
      .get();
    expect(missing).toBeUndefined();
  });

  test("keeps column names reachable for a raw statement with no fields", async () => {
    // `db.get(sql`...`)` is handed the driver's row untouched, and call sites
    // in this repo read it by NAME (`match.matched`). On D1 that is a record;
    // sqlite-proxy would hand over a bare array.
    await db
      .insert(authors)
      .values({ id: "a1", name: "Ada", createdAt: "2026-01-01" });
    const row = (await db.get(sql`
      SELECT CASE WHEN EXISTS (SELECT 1 FROM ${authors}) THEN 1 ELSE 0 END AS matched
    `)) as { matched: number } | undefined;
    expect(row?.matched).toBe(1);
  });

  test("carries a blob parameter and reads it back as bytes", async () => {
    const payload = new Uint8Array([0, 1, 2, 250, 255]);
    await db.run(
      sql`insert into ${blobs} (${sql.raw('"id"')}, ${sql.raw('"payload"')}) values (${"one"}, ${payload})`,
    );
    const row = (await db.get(
      sql`select "payload" as "payload" from ${blobs} where "id" = ${"one"}`,
    )) as { payload: Uint8Array } | undefined;
    expect(row?.payload).toBeInstanceOf(Uint8Array);
    expect([...(row?.payload ?? [])]).toEqual([...payload]);
  });

  test("batch commits every statement as one Host transaction", async () => {
    await db.batch([
      db.insert(authors).values({
        id: "a1",
        name: "Ada",
        createdAt: "2026-01-01",
      }),
      db.insert(authors).values({
        id: "a2",
        name: "Grace",
        createdAt: "2026-01-01",
      }),
    ]);
    expect(await db.select().from(authors)).toHaveLength(2);
    // One round trip, not two: the whole batch went out as `transaction`.
    expect(facade.statements).toHaveLength(3); // 2 inserts + the select
  });

  test("batch rolls the whole set back when one statement fails", async () => {
    await db
      .insert(authors)
      .values({ id: "a1", name: "Ada", createdAt: "2026-01-01" });

    await expect(
      db.batch([
        db.insert(authors).values({
          id: "a2",
          name: "Grace",
          createdAt: "2026-01-01",
        }),
        // Duplicate primary key: the Host aborts the transaction.
        db.insert(authors).values({
          id: "a1",
          name: "Clash",
          createdAt: "2026-01-01",
        }),
      ]),
    ).rejects.toThrow();

    const remaining = await db.select().from(authors);
    expect(remaining.map((row) => row.id)).toEqual(["a1"]);
    expect(remaining[0]!.name).toBe("Ada");
  });
});

describe("edge.sql fail-closed guards", () => {
  const emptyFacade = (result: EdgeSqlResult): EdgeSqlBinding => ({
    execute: async () => result,
    query: async () => result,
    transaction: async () => [result],
  });

  /**
   * Drizzle wraps a driver throw in `DrizzleQueryError` and keeps the original
   * as `cause`. The adapter's refusal is what these tests are about, so unwrap
   * one layer before asserting.
   */
  async function refusal(run: () => Promise<unknown>): Promise<Error> {
    try {
      await run();
    } catch (error) {
      const cause = (error as { cause?: unknown }).cause;
      return cause instanceof Error ? cause : (error as Error);
    }
    throw new Error("expected the statement to be refused");
  }

  test("refuses a row whose column count does not match the projection", async () => {
    const db = createEdgeSqlDatabase(
      // The statement projects three columns; the Host answered with two,
      // which is exactly what a collapsed duplicate name looks like.
      emptyFacade({ rows: [{ __c0: "a", __c1: "b" }], rowsWritten: 0 }),
    );
    const error = await refusal(async () => await db.select().from(authors));
    expect(error).toBeInstanceOf(ProxyColumnMismatchError);
    expect(error.message).toContain("returned 2 columns");
  });

  test("refuses transaction-control SQL and names the alternative", async () => {
    const db = createEdgeSqlDatabase(emptyFacade({ rows: [], rowsWritten: 0 }));
    const error = await refusal(
      async () => await db.run(sql.raw("begin immediate")),
    );
    expect(error).toBeInstanceOf(EdgeSqlShapeError);
    expect(error.message).toMatch(/db\.batch/);
  });

  test("refuses a parameter with no portable encoding", async () => {
    const db = createEdgeSqlDatabase(emptyFacade({ rows: [], rowsWritten: 0 }));
    const error = await refusal(
      async () =>
        await db.run(sql`select ${{ nested: true } as unknown as string}`),
    );
    expect(error).toBeInstanceOf(EdgeSqlShapeError);
    expect(error.message).toContain("no portable encoding");
  });

  test("refuses more bound parameters than the facade carries", async () => {
    const db = createEdgeSqlDatabase(emptyFacade({ rows: [], rowsWritten: 0 }));
    const many = Array.from({ length: 101 }, (_, index) => sql`${index}`);
    const error = await refusal(
      async () => await db.run(sql`select ${sql.join(many, sql.raw(", "))}`),
    );
    expect(error).toBeInstanceOf(EdgeSqlShapeError);
    expect(error.message).toContain("exceed the facade limit of 100");
  });
});
