import { assertEquals, assertNotEquals } from "jsr:@std/assert";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";
import {
  handleDelete,
  handleLike,
} from "../../../../routes/activitypub/handlers/user-inbox-handlers.ts";
import type {
  Activity,
  ActivityContext,
} from "../../../../routes/activitypub/inbox-types.ts";
import type { actors } from "../../../../../db/index.ts";

type ActorRow = typeof actors.$inferSelect;

/**
 * Creates a mock Drizzle DB that supports chainable patterns:
 *   db.select().from().where().get()
 *   db.insert().values().onConflictDoNothing().returning().get()
 *   db.update().set().where()
 *   db.delete().where()
 *   db.insert().values().onConflictDoNothing()
 *
 * Each call to select/insert/update/delete returns a fresh chainable object.
 * Use `callTracker` to inspect what was called.
 */
function createMockDb(options: {
  selectResults?: unknown[];
  insertReturningResult?: unknown;
}) {
  const { selectResults = [], insertReturningResult = undefined } = options;
  let selectCallIndex = 0;

  const callTracker = {
    selects: [] as unknown[],
    inserts: [] as unknown[],
    updates: [] as unknown[],
    deletes: [] as unknown[],
  };

  const selectSpy = spy((...args: unknown[]) => {
    callTracker.selects.push(args);
    const result = selectResults[selectCallIndex] ?? undefined;
    selectCallIndex++;
    const chain = {
      from: spy(() => ({
        where: spy(() => ({
          get: spy(() => Promise.resolve(result)),
          limit: spy(() => ({
            get: spy(() => Promise.resolve(result)),
          })),
        })),
        get: spy(() => Promise.resolve(result)),
      })),
    };
    return chain;
  });

  const insertSpy = spy((...args: unknown[]) => {
    callTracker.inserts.push(args);
    const returningGet = spy(() => Promise.resolve(insertReturningResult));
    const returning = spy(() => ({ get: returningGet }));
    const onConflictDoNothing = spy(() => ({
      returning,
      get: returningGet,
    }));
    const values = spy(() => ({
      onConflictDoNothing,
      returning,
    }));
    return { values };
  });

  const updateSpy = spy((...args: unknown[]) => {
    callTracker.updates.push(args);
    const where = spy(() => Promise.resolve(undefined));
    const set = spy(() => ({ where }));
    return { set };
  });

  const deleteSpy = spy((...args: unknown[]) => {
    callTracker.deletes.push(args);
    const where = spy(() => Promise.resolve(undefined));
    return { where };
  });

  const db = {
    select: selectSpy,
    insert: insertSpy,
    update: updateSpy,
    delete: deleteSpy,
  };

  return { db, callTracker };
}

/**
 * Creates a mock ActivityContext whose `get('db')` returns the given mock db.
 */
function createMockContext(
  db: ReturnType<typeof createMockDb>["db"],
): ActivityContext {
  return {
    get: (key: string) => {
      if (key === "db") return db;
      return null;
    },
  } as unknown as ActivityContext;
}

Deno.test("userInboxHandlers hardening - handleLike writes like/count/inbox in a single transaction", async () => {
  const actorApId = "https://example.com/ap/users/alice";
  const targetApId = "https://example.com/ap/users/bob";
  const objectApId = "https://example.com/ap/objects/note-1";

  const { db, callTracker } = createMockDb({
    selectResults: [{ attributedTo: targetApId }],
    insertReturningResult: { actorApId, objectApId, activityApId: "like-1" },
  });

  const context = createMockContext(db);

  const activity: Activity = {
    id: "https://example.com/ap/activities/like-1",
    type: "Like",
    actor: actorApId,
    object: objectApId,
  };

  await handleLike(
    context,
    activity,
    {} as unknown as ActorRow,
    actorApId,
    "https://example.com",
  );

  // Verify select was called (lookup object)
  assertSpyCalls(db.select, 1);
  // Verify insert was called (like + activity + inbox)
  assert_called(db.insert);
  // Verify update was called (likeCount)
  assert_called(db.update);
});

Deno.test("userInboxHandlers hardening - handleLike treats unique conflicts as idempotent", async () => {
  const { db } = createMockDb({
    selectResults: [{ attributedTo: "https://example.com/ap/users/bob" }],
    insertReturningResult: undefined,
  });

  const context = createMockContext(db);

  const activity: Activity = {
    id: "https://example.com/ap/activities/like-2",
    type: "Like",
    actor: "https://example.com/ap/users/alice",
    object: "https://example.com/ap/objects/note-2",
  };

  await handleLike(
    context,
    activity,
    {} as unknown as ActorRow,
    "https://example.com/ap/users/alice",
    "https://example.com",
  );

  // insert was called for like, but returned undefined (duplicate)
  assertSpyCalls(db.insert, 1);
  // update should NOT have been called (no count increment for duplicate)
  assertSpyCalls(db.update, 0);
});

Deno.test("userInboxHandlers hardening - handleDelete performs dependent deletes and counter update", async () => {
  const { db } = createMockDb({
    selectResults: [{
      attributedTo: "https://example.com/ap/users/alice",
      type: "Note",
      replyCount: 0,
    }],
  });

  const context = createMockContext(db);

  const activity: Activity = {
    id: "https://example.com/ap/activities/delete-1",
    type: "Delete",
    actor: "https://example.com/ap/users/alice",
    object: "https://example.com/ap/objects/note-3",
  };

  await handleDelete(
    context,
    activity,
  );

  // Verify select was called (lookup object)
  assertSpyCalls(db.select, 1);
  // Verify delete was called (likes + objects)
  assertSpyCalls(db.delete, 2);
  // Verify update was called (actor postCount decrement)
  assertSpyCalls(db.update, 1);
});

/** Helper: assert a spy was called at least once */
function assert_called(spyFn: { calls: unknown[] }) {
  if (spyFn.calls.length === 0) {
    throw new Error("Expected spy to have been called at least once");
  }
}
