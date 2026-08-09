import { expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import {
  actors,
  D1BatchTooLargeError,
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
