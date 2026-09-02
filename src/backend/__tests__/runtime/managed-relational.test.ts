import { beforeEach, describe, expect, test } from "bun:test";
import { Database as BunSqlite } from "bun:sqlite";
import { eq, sql } from "drizzle-orm";

import type { Database } from "../../../db/index.ts";
import { actors, blocks, mutes } from "../../../db/schema.ts";
import {
  personalActorIsBlockedBy,
  resolveRetainedPersonalBlockTarget,
} from "../../lib/personal-actor-moderation.ts";
import { createManagedRelationalDatabase } from "../../runtime/managed-relational.ts";
import { ProxyColumnMismatchError } from "../../runtime/sqlite-proxy-rows.ts";

const materialization = {
  contract: "takosumi.managed-runtime-connection/v1",
  gateway: { binding: "TAKOSUMI_MANAGED_RUNTIME", transport: "fetch" },
  connections: [
    {
      alias: "database",
      authority: {
        workspaceId: "space_yuru",
        subject: "principal_yuru",
        resourceId: "tkrn:space_yuru:RelationalDatabase:database",
        resourceKind: "RelationalDatabase",
        resourceGeneration: 3,
        permissions: ["takosumi.managed-runtime.invoke"],
        interfaceId: "interface_database",
        interfaceBindingId: "binding_database",
        interfaceResolvedRevision: 5,
        audience: "https://app.takosumi.com/v1/cloud/resources",
        capabilityRef: "secret:runtime/database",
      },
    },
  ],
};

test("managed relational adapter feeds Drizzle arrays and exact authority", async () => {
  const requests: unknown[] = [];
  const database = createManagedRelationalDatabase({
    materialization,
    alias: "database",
    idempotencyKey: () => "relational:adapter-1",
    gateway: {
      async fetch(request) {
        requests.push(await request.clone().json());
        return Response.json({
          contract: "takosumi.managed-relational-runtime/v1",
          results: [
            {
              success: true,
              columns: ["ap_id", "preferred_username"],
              rows: [["https://example.com/ap/users/one", "one"]],
              meta: meta({ rows_read: 1 }),
            },
          ],
        });
      },
    },
  });

  const rows = await database
    .select({
      apId: actors.apId,
      username: actors.preferredUsername,
    })
    .from(actors)
    .where(eq(actors.apId, "https://example.com/ap/users/one"));

  expect(rows).toEqual([
    {
      apId: "https://example.com/ap/users/one",
      username: "one",
    },
  ]);
  expect(requests[0]).toMatchObject({
    contract: "takosumi.managed-relational-runtime/v1",
    authority: {
      resourceGeneration: 3,
      interfaceId: "interface_database",
      interfaceBindingId: "binding_database",
      interfaceResolvedRevision: 5,
    },
    mode: "ordered_atomic",
  });
  expect(JSON.stringify(requests)).not.toContain("cloudflare");
  expect(JSON.stringify(requests)).not.toContain("Bearer ");
});

test("Drizzle batch becomes one ordered atomic gateway call", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const database = createManagedRelationalDatabase({
    materialization,
    alias: "database",
    idempotencyKey: () => "relational:adapter-batch",
    gateway: {
      async fetch(request) {
        requests.push(
          (await request.clone().json()) as Record<string, unknown>,
        );
        return Response.json({
          contract: "takosumi.managed-relational-runtime/v1",
          results: [
            {
              success: true,
              columns: [],
              rows: [],
              meta: meta({ changed_db: true, changes: 1, rows_written: 1 }),
            },
            {
              success: true,
              columns: [["count"]].flat(),
              rows: [[1]],
              meta: meta({ rows_read: 1 }),
            },
          ],
        });
      },
    },
  });

  await database.batch([
    database
      .update(actors)
      .set({ preferredUsername: "new" })
      .where(eq(actors.apId, "actor-1")),
    database.select({ count: sql<number>`count(*)` }).from(actors),
  ]);

  expect(requests).toHaveLength(1);
  expect(requests[0]?.mode).toBe("ordered_atomic");
  expect(requests[0]?.statements).toHaveLength(2);
});

test("managed relational adapter fails closed on DDL before gateway dispatch", async () => {
  let called = false;
  const database = createManagedRelationalDatabase({
    materialization,
    alias: "database",
    idempotencyKey: () => "relational:adapter-ddl",
    gateway: {
      async fetch() {
        called = true;
        return new Response(null, { status: 500 });
      },
    },
  });

  const error = await Promise.resolve(
    database.run(sql.raw("CREATE TABLE nope(id TEXT)")),
  ).catch((error: unknown) => error);
  expect(error).toBeInstanceOf(Error);
  expect(String((error as Error & { cause?: unknown }).cause)).toContain(
    "relational_ddl_requires_resource_migration",
  );
  expect(called).toBe(false);
});

function meta(overrides: Record<string, unknown> = {}) {
  return {
    changed_db: false,
    changes: 0,
    duration: 0,
    last_row_id: 0,
    size_after: 4096,
    rows_read: 0,
    rows_written: 0,
    ...overrides,
  };
}

// Two moderation tables that COLLIDE on column names once they are joined:
// `created_at` and `updated_at` are projected twice. That is the shape the
// lane's row mapping has to survive, and the shape the tests below are about.
const MODERATION_SCHEMA_SQL = [
  `create table blocks (
     blocker_ap_id text not null,
     blocked_ap_id text not null,
     created_at text not null,
     updated_at text,
     primary key (blocker_ap_id, blocked_ap_id)
   )`,
  `create table mutes (
     muter_ap_id text not null,
     muted_ap_id text not null,
     created_at text not null,
     updated_at text,
     primary key (muter_ap_id, muted_ap_id)
   )`,
];

const OWNER = "https://local.example/ap/users/owner";
const SPAM_RETAINED = "https://Remote.example/ap/users/spam/";
const SPAM_CANONICAL = "https://remote.example/ap/users/spam";
const STRANGER = "https://remote.example/ap/users/stranger";

/**
 * A stand-in for the managed relational Host, answering out of in-memory
 * SQLite.
 *
 * The fidelity that matters is how it builds one result: the driver's own
 * column-name list beside the driver's positional cells, which is exactly the
 * `{columns, rows}` the runtime contract carries. `bun:sqlite` reports the
 * column names of a join with duplicates COLLAPSED — six names for eight cells
 * — because it derives them from a record, which is what every record-shaped
 * materialization anywhere in a Host's path does. So a join that has not had
 * its projection list rewritten cannot come back through this seam at all,
 * and that is not an artifact of the fake: it is the hazard the runtime
 * contract's own "duplicate labels are valid for joins" comment warns about.
 */
function createFakeRelationalHost(store: BunSqlite) {
  const statements: { sql: string; params: readonly unknown[] }[] = [];

  const run = (sqlText: string, params: readonly unknown[]) => {
    statements.push({ sql: sqlText, params });
    const query = store.query(sqlText);
    // `values()` answers null, not [], for a statement that returns no rows.
    const rows = (query.values(...(params as never[])) ?? []) as unknown[][];
    const writes = /^\s*(insert|update|delete|replace)\b/i.test(sqlText);
    const changes = writes
      ? Number((store.query("select changes() as c").get() as { c: number }).c)
      : 0;
    return {
      success: true,
      columns: query.columnNames,
      rows,
      meta: {
        changed_db: writes && changes > 0,
        changes,
        duration: 0,
        last_row_id: 0,
        size_after: 4096,
        rows_read: rows.length,
        rows_written: changes,
      },
    };
  };

  return {
    statements,
    gateway: {
      async fetch(request: Request): Promise<Response> {
        const body = (await request.json()) as {
          statements: { sql: string; params: unknown[] }[];
        };
        try {
          // Ordered-atomic, exactly like the Host: one throw discards the set.
          const results = store.transaction(() =>
            body.statements.map((entry) => run(entry.sql, entry.params)),
          )();
          return Response.json({
            contract: "takosumi.managed-relational-runtime/v1",
            results,
          });
        } catch (error) {
          return Response.json(
            { error: "relational_statement_failed", detail: String(error) },
            { status: 400 },
          );
        }
      },
    },
  };
}

describe("managed relational row shape", () => {
  let store: BunSqlite;
  let host: ReturnType<typeof createFakeRelationalHost>;
  let db: Database;

  beforeEach(() => {
    store = new BunSqlite(":memory:");
    for (const statement of MODERATION_SCHEMA_SQL) store.run(statement);
    host = createFakeRelationalHost(store);
    db = createManagedRelationalDatabase({
      materialization,
      alias: "database",
      idempotencyKey: () => "relational:row-shape",
      gateway: host.gateway,
    });
  });

  const block = async (blockedApId: string) =>
    await db.insert(blocks).values({
      blockerApId: OWNER,
      blockedApId,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

  test("inserts and reads back through the Host", async () => {
    await block(SPAM_CANONICAL);
    expect(await db.select().from(blocks)).toEqual([
      {
        blockerApId: OWNER,
        blockedApId: SPAM_CANONICAL,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  test("maps a join whose result columns collide on both sides", async () => {
    // Without the projection rewrite `created_at` and `updated_at` are each
    // projected twice, the Host's column list collapses to six names for eight
    // cells, and every field after the first collision reads one place over —
    // a silent mis-read wherever a Host tolerates the shorter list.
    await block(SPAM_CANONICAL);
    await db.insert(mutes).values({
      muterApId: OWNER,
      mutedApId: SPAM_CANONICAL,
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    const joined = await db
      .select()
      .from(blocks)
      .innerJoin(mutes, eq(blocks.blockedApId, mutes.mutedApId));

    expect(joined).toEqual([
      {
        blocks: {
          blockerApId: OWNER,
          blockedApId: SPAM_CANONICAL,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        mutes: {
          muterApId: OWNER,
          mutedApId: SPAM_CANONICAL,
          createdAt: "2026-01-02T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      },
    ]);

    // Prove the rewrite really happened rather than the driver having been
    // lucky: the statement that went out carries the generated names.
    const select = host.statements.at(-1)!.sql;
    expect(select).toContain(`as "__c0"`);
    expect(select).toContain(`as "__c7"`);
  });

  test("keeps column names reachable for a raw statement with no fields", async () => {
    // `db.get(sql`...`)` is handed the Host's row untouched, and the block and
    // mute gates in src/backend/lib read it BY NAME. A bare positional array
    // answers `undefined` to `row.matched`, which those gates read as
    // "not blocked".
    const row = (await db.get(
      sql`SELECT CASE WHEN EXISTS (SELECT 1 FROM ${blocks}) THEN 1 ELSE 0 END AS matched`,
    )) as { matched: number } | undefined;
    expect(row?.matched).toBe(0);

    await block(SPAM_CANONICAL);
    const present = (await db.get(
      sql`SELECT CASE WHEN EXISTS (SELECT 1 FROM ${blocks}) THEN 1 ELSE 0 END AS matched`,
    )) as { matched: number } | undefined;
    expect(present?.matched).toBe(1);
  });

  test("get() on an empty result is undefined, not a row of undefineds", async () => {
    // Drizzle's `mapGetResult` short-circuits on a FALSY row, and `[]` is
    // truthy: an empty array becomes an object whose every field is undefined,
    // which `if (exact) return true` in the block gate reads as a hit.
    const missing = await db
      .select()
      .from(blocks)
      .where(eq(blocks.blockedApId, STRANGER))
      .get();
    expect(missing).toBeUndefined();
  });

  test("a personal block gate decides correctly through the lane", async () => {
    // The production gate: an exact miss must fall through to the identity-set
    // statement, and that statement's `AS matched` column must be readable by
    // name. Both halves are row shape, and both fail open or closed silently.
    await block(SPAM_RETAINED);
    expect(await personalActorIsBlockedBy(db, OWNER, SPAM_CANONICAL)).toBe(
      true,
    );
    expect(await personalActorIsBlockedBy(db, OWNER, STRANGER)).toBe(false);
    expect(
      await resolveRetainedPersonalBlockTarget(db, OWNER, SPAM_CANONICAL),
    ).toBe(SPAM_RETAINED);
    expect(
      await resolveRetainedPersonalBlockTarget(db, OWNER, STRANGER),
    ).toBeNull();
  });
});

test("managed relational refuses a row that does not match the projection", async () => {
  // A Host that answered from a record-shaped driver returns one column fewer
  // than the four `select ... from blocks` projects. Mapping it positionally
  // would shift every field after the collision; refuse instead.
  const database = createManagedRelationalDatabase({
    materialization,
    alias: "database",
    idempotencyKey: () => "relational:column-guard",
    gateway: {
      async fetch() {
        return Response.json({
          contract: "takosumi.managed-relational-runtime/v1",
          results: [
            {
              success: true,
              columns: ["blocker_ap_id", "blocked_ap_id", "created_at"],
              rows: [[OWNER, SPAM_CANONICAL, "2026-01-01T00:00:00.000Z"]],
              meta: meta({ rows_read: 1 }),
            },
          ],
        });
      },
    },
  });

  const error = await Promise.resolve(database.select().from(blocks)).catch(
    (error: unknown) => error,
  );
  const cause = (error as Error & { cause?: unknown }).cause;
  expect(cause).toBeInstanceOf(ProxyColumnMismatchError);
  expect((cause as Error).message).toContain("returned 3 columns");
});
