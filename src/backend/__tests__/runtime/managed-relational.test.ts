import { expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import { actors } from "../../../db/schema.ts";
import { createManagedRelationalDatabase } from "../../runtime/managed-relational.ts";

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
