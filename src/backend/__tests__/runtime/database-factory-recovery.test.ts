import { afterEach, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { deliveryFanouts, getDb } from "../../../db/index.ts";
import { createGuardedDatabase } from "../../../db/guarded-writes.ts";
import { createYurucommuBackendApp } from "../../index.ts";
import { admissionGuard } from "../../lib/account-deletion-admission.ts";
import { createEdgeSqlDatabase } from "../../runtime/edge-sql.ts";
import { MemoryKV } from "../../runtime/memory-kv.ts";
import {
  decodeEdgeBytes,
  encodeEdgeBytes,
  isEdgeEncodedBytes,
  type EdgeSqlBinding,
  type EdgeSqlResult,
  type EdgeSqlValue,
} from "../../runtime/edge-facades.ts";
import type { Env } from "../../types.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const clients: Awaited<ReturnType<typeof createTestDb>>["client"][] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.close();
});

async function fixture() {
  const { client } = await createTestDb();
  clients.push(client);
  let calls = 0;
  function value(raw: unknown): EdgeSqlValue {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === "string" || typeof raw === "number") return raw;
    if (typeof raw === "bigint") return Number(raw);
    if (raw instanceof Uint8Array) return encodeEdgeBytes(raw);
    throw new TypeError("Unexpected isolated SQL value");
  }
  const args = (params: readonly EdgeSqlValue[] = []) =>
    params.map((p) => (isEdgeEncodedBytes(p) ? decodeEdgeBytes(p) : p));
  function result(
    r: Awaited<ReturnType<typeof client.execute>>,
  ): EdgeSqlResult {
    return {
      rows: r.rows.map((row) =>
        Object.fromEntries(r.columns.map((name, i) => [name, value(row[i])])),
      ),
      rowsWritten: r.rowsAffected,
    };
  }
  // Only the fixture port is local. Every statement/result is the actual
  // D1-semantics guarded SQLite client, not a modeled row or Host proof.
  const binding: EdgeSqlBinding = {
    async execute(query, params) {
      calls++;
      return result(await client.execute({ sql: query, args: args(params) }));
    },
    async query(query, params) {
      calls++;
      const r = result(
        await client.execute({ sql: query, args: args(params) }),
      );
      expect(r.rowsWritten).toBe(0);
      return r;
    },
    async transaction(statements) {
      calls += statements.length;
      return {
        results: (
          await client.batch(
            statements.map((s) => ({ sql: s.sql, args: args(s.params) })),
            "write",
          )
        ).map(result),
      };
    },
  };
  return {
    binding,
    database: () => createEdgeSqlDatabase(binding),
    get calls() {
      return calls;
    },
    reset() {
      calls = 0;
    },
  };
}

function app() {
  return createYurucommuBackendApp({
    plugins: [
      {
        apiVersion: 1,
        name: "factory-recovery-regression",
        setup({ app }) {
          app.get("/__factory/warm", (c) => c.text("ok"));
          app.post("/__factory/ok", () => new Response(null, { status: 204 }));
        },
      },
    ],
  });
}

test("D1 factory construction preserves one client per exact binding without I/O", () => {
  let calls = 0;
  const binding = () =>
    ({
      prepare() {
        calls++;
        throw new Error("Constructor must not query the fixture");
      },
    }) as unknown as Parameters<typeof getDb>[0];
  const a = binding();
  const b = binding();
  expect(getDb(a) === getDb(a)).toBe(true);
  expect(getDb(a) !== getDb(b)).toBe(true);
  expect(calls).toBe(0);
  // Real D1 execution is qualified separately with the isolated native fixture.
});

test("recreated request environments coalesce recovery through the same binding", async () => {
  const f = await fixture();
  const backend = app();
  const kv = new MemoryKV();
  const env = (): Env => ({
    APP_URL: "https://factory.test",
    DB_INSTANCE: f.database(),
    KV: kv,
  });
  await backend.fetch(
    new Request("https://factory.test/__factory/warm"),
    env(),
  );
  f.reset();
  const responses = await Promise.all(
    [env(), env(), env()].map((e) =>
      backend.fetch(
        new Request("https://factory.test/__factory/ok", { method: "POST" }),
        e,
      ),
    ),
  );
  expect(responses.every((r) => r.status === 204)).toBe(true);
  expect(f.calls).toBeGreaterThan(0);
  expect(f.calls).toBeLessThanOrEqual(10);
});

test("different SQL bindings retain separate recovery lifetimes", async () => {
  const a = await fixture();
  const b = await fixture();
  const backend = app();
  const kv = new MemoryKV();
  const env = (f: typeof a): Env => ({
    APP_URL: "https://factory.test",
    DB_INSTANCE: f.database(),
    KV: kv,
  });
  for (const f of [a, b]) {
    await backend.fetch(
      new Request("https://factory.test/__factory/warm"),
      env(f),
    );
    f.reset();
  }
  const responses = await Promise.all(
    [a, b].map((f) =>
      backend.fetch(
        new Request("https://factory.test/__factory/ok", { method: "POST" }),
        env(f),
      ),
    ),
  );
  expect(responses.every((r) => r.status === 204)).toBe(true);
  expect(a.calls).toBe(5);
  expect(b.calls).toBe(5);
});

test("shared factory client retains separate write guards and fresh SQL results", async () => {
  const f = await fixture();
  const other = await fixture();
  const rejected = createGuardedDatabase(f.database(), () =>
    admissionGuard(f.database(), sql`0`, () => new Error("fixture rejected")),
  );
  const accepted = createGuardedDatabase(f.database(), () =>
    admissionGuard(f.database(), sql`1`),
  );
  const intent = (id: string) => ({
    id,
    kind: "followers",
    activityApId: `https://factory.test/ap/activities/${id}`,
    targetApId: "https://factory.test/ap/users/local",
  });
  expect(await f.database().select().from(deliveryFanouts)).toEqual([]);
  await expect(
    Promise.resolve(
      rejected.insert(deliveryFanouts).values(intent("rejected-before")),
    ),
  ).rejects.toThrow("fixture rejected");
  await accepted.insert(deliveryFanouts).values(intent("accepted"));
  await expect(
    Promise.resolve(
      rejected.insert(deliveryFanouts).values(intent("rejected-after")),
    ),
  ).rejects.toThrow("fixture rejected");
  expect(
    await f.database().select({ id: deliveryFanouts.id }).from(deliveryFanouts),
  ).toEqual([{ id: "accepted" }]);
  expect(await other.database().select().from(deliveryFanouts)).toEqual([]);
});
