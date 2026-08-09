import { expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import {
  activities,
  actors,
  D1BatchTooLargeError,
  insertMany,
  runBatch,
  type D1Statement,
} from "../../db/index.ts";
import { createTestDb } from "./helpers/d1-semantics.ts";

test("runBatch rejects an unbounded atomic statement set before execution", async () => {
  const { db } = await createTestDb();
  const statements = Array.from({ length: 51 }, (_, index) =>
    db
      .update(actors)
      .set({ postCount: sql`${actors.postCount} + 1` })
      .where(eq(actors.apId, `https://yuru.test/ap/users/missing-${index}`)),
  );

  await expect(
    runBatch(db, statements as unknown as [D1Statement, ...D1Statement[]]),
  ).rejects.toBeInstanceOf(D1BatchTooLargeError);
});

test("insertMany budgets Drizzle's implicit runtime and primitive defaults", async () => {
  const { db } = await createTestDb();
  const rows = Array.from({ length: 30 }, (_, index) => ({
    apId: `https://remote.example/activities/default-budget-${index}`,
    type: "Create",
    actorApId: "https://remote.example/users/alice",
    objectApId: `https://remote.example/objects/default-budget-${index}`,
    rawJson: "{}",
    createdAt: "2026-08-09T00:00:00.000Z",
  }));

  // `processed` is omitted and Drizzle binds its primitive default (0) once
  // per row. The old key-count budget saw only six caller keys and emitted a
  // 15-row statement (105 actual binds), which D1 rejects. Exact compilation
  // keeps every statement within the shared 90-bind safety budget.
  const statements = insertMany(db, activities, rows);
  await runBatch(db, statements as unknown as [D1Statement, ...D1Statement[]]);

  expect(statements).toHaveLength(3);
  expect(
    await db.select({ apId: activities.apId }).from(activities),
  ).toHaveLength(30);
});
