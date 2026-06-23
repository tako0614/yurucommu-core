import { test } from "bun:test";

import { assertSpyCalls, spy } from "#test/mock";
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
    batches: [] as unknown[],
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

  // handleInteraction now groups the edge insert and the COUNT(*)-derived
  // counter update into one atomic `db.batch([...])` (Wave 9 #7: edge + counter
  // must commit together, recompute is idempotent). The batch statements are
  // built by invoking the insert/update spies BEFORE batch() runs, so the
  // call-tracking still observes them; batch itself just resolves.
  const batchSpy = spy((statements: unknown) => {
    callTracker.batches.push(statements);
    return Promise.resolve(undefined);
  });

  const db = {
    select: selectSpy,
    insert: insertSpy,
    update: updateSpy,
    delete: deleteSpy,
    batch: batchSpy,
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
    // handleDelete reads `c.env.MEDIA` to pass an object-store binding into
    // deleteObjectCascade. No R2 in this unit test, so MEDIA is absent; the
    // cascade skips the blob purge. `env` must exist or `c.env.MEDIA` throws.
    env: {},
  } as unknown as ActivityContext;
}

test("userInboxHandlers hardening - handleLike writes like/count/inbox in a single transaction", async () => {
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

  // Verify select was called once (pre-dispatch existing-edge lookup that gates
  // the one-shot owner notification).
  assertSpyCalls(db.select, 1);
  // Verify the edge insert statement was built.
  assert_called(db.insert);
  // Verify the COUNT(*)-derived counter update statement was built.
  assert_called(db.update);
  // The edge insert and counter update commit together in ONE atomic batch
  // (Wave 9 #7), not as two independent statements.
  assertSpyCalls(db.batch, 1);
});

test("userInboxHandlers hardening - handleLike treats unique conflicts as idempotent", async () => {
  // An existing edge is returned by the pre-dispatch lookup, modelling a
  // re-delivered/duplicate Like.
  const { db } = createMockDb({
    selectResults: [
      {
        actorApId: "https://example.com/ap/users/alice",
      },
    ],
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

  // Idempotency is now structural, not gated on a `.returning()` row: the edge
  // insert uses onConflictDoNothing and the counter is RECOMPUTED from
  // COUNT(*) of the edge table inside the same atomic batch (Wave 9 #7), so a
  // duplicate can never double-count. The batch (insert + count recompute)
  // still runs exactly once on a duplicate.
  assertSpyCalls(db.insert, 1);
  assertSpyCalls(db.update, 1);
  assertSpyCalls(db.batch, 1);
  // A duplicate (existing edge) must NOT re-notify the owner; handleInteraction
  // returns before the notify path, so no further selects happen.
  assertSpyCalls(db.select, 1);
});

test("userInboxHandlers hardening - handleDelete performs dependent deletes and counter update", async () => {
  const { db } = createMockDb({
    selectResults: [
      {
        attributedTo: "https://example.com/ap/users/alice",
        type: "Note",
        replyCount: 0,
      },
    ],
  });

  const context = createMockContext(db);

  const activity: Activity = {
    id: "https://example.com/ap/activities/delete-1",
    type: "Delete",
    actor: "https://example.com/ap/users/alice",
    object: "https://example.com/ap/objects/note-3",
  };

  await handleDelete(context, activity);

  // Verify select was called 3 times: once in handleDelete (lookup object
  // owner/type), once inside deleteObjectCascade's media reaper (the object's
  // attachments_json — returns undefined here so it short-circuits before any
  // media delete), and once for the notification-reap subquery (the activities
  // referencing this object whose inbox rows are deleted).
  assertSpyCalls(db.select, 3);
  // Verify delete was called for the full object cascade (likes, announces,
  // bookmarks, object_recipients, story_views, story_votes, story_shares) + the
  // notification inbox-row reap + the objects row itself = 9. The cascade now
  // runs for every object type via the shared deleteObjectCascade helper so no
  // child rows (or dangling notifications) are orphaned.
  assertSpyCalls(db.delete, 9);
  // Verify update was called (actor postCount decrement)
  assertSpyCalls(db.update, 1);
});

/** Helper: assert a spy was called at least once */
function assert_called(spyFn: { calls: unknown[] }) {
  if (spyFn.calls.length === 0) {
    throw new Error("Expected spy to have been called at least once");
  }
}
