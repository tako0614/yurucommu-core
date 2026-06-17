import { expect, test } from "bun:test";

import {
  handleAdd,
  handleBlock,
  handleFlag,
  handleRemove,
} from "../../routes/activitypub/handlers/inbox-interaction-handlers.ts";
import type {
  Activity,
  ActivityContext,
} from "../../routes/activitypub/inbox-types.ts";
import type { actors } from "../../../db/index.ts";

type ActorRow = typeof actors.$inferSelect;

/**
 * Minimal chainable Drizzle mock covering the shapes the interaction handlers
 * exercise. The follow-graph counter handlers (handleAdd / handleRemove /
 * handleBlock) co-commit their edge insert/delete and the two counter updates
 * in a single atomic `db.batch([...])` (the #COUNTER-SYM crash-retry
 * convergence work), so the chained statement builders no longer execute
 * eagerly — they return inert statement descriptors that `db.batch()` runs.
 *
 * Shapes:
 *   db.insert().values().onConflictDoNothing()  -> batch statement descriptor
 *   db.insert().values()                         (Flag, executes eagerly)
 *   db.delete().where()                          -> batch statement descriptor
 *   db.update().set().where()                    -> batch statement descriptor
 *   db.batch([...])                              -> executes the descriptors
 *
 * The real counter updates are SQL-guarded inside the batch (Add: an
 * `edgeAbsent` NOT EXISTS guard; Remove/Block: an `acceptedEdgeExists` EXISTS
 * guard + `count > 0` underflow guard), so a guarded `update` row fires only
 * when its guard holds. The mock reproduces that guard outcome from the
 * scenario the test declares (`edgeFiresUpdates`): when the relevant accepted
 * edge transition does NOT occur, the two counter updates in that batch are
 * no-ops, exactly as the SQL guards make them.
 *
 * Tracking:
 *   insertedValues  — the value objects passed to insert().values()
 *   updateCount     — number of guarded counter `update` statements that fired
 */
type StatementDescriptor =
  | { kind: "insert"; values: unknown }
  | { kind: "delete" }
  | { kind: "update" };

function createMockDb(options: {
  // Row returned by insert(...).returning().get() (undefined = conflict/no-op).
  insertReturningResult?: unknown;
  // Rows returned by delete(...).returning().
  deleteReturningRows?: unknown[];
  // Per-batch verdict: for each batch the handler submits, does the guarded
  // counter transition fire? `true` => the two `update` rows in that batch
  // count; `false` => the SQL guard makes them no-ops. Consumed in order.
  // Defaults to firing every batch when omitted.
  batchUpdatesFire?: boolean[];
}) {
  const {
    insertReturningResult = undefined,
    deleteReturningRows = [],
    batchUpdatesFire,
  } = options;

  const tracker = {
    insertedValues: [] as unknown[],
    updateCount: 0,
  };

  let batchIndex = 0;

  const db = {
    insert: () => ({
      values: (vals: unknown) => {
        tracker.insertedValues.push(vals);
        const returningGet = () => Promise.resolve(insertReturningResult);
        const returning = () => ({ get: returningGet });
        // Used both as a batch statement (Add edge insert) and as an
        // eagerly-awaited insert (Flag report persist).
        const descriptor: StatementDescriptor = {
          kind: "insert",
          values: vals,
        };
        return {
          ...descriptor,
          onConflictDoNothing: () => ({
            ...descriptor,
            returning,
            get: returningGet,
          }),
          returning,
          // Make the eager Flag insert (`await db.insert().values()`) resolve.
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve(undefined).then(resolve),
        };
      },
    }),
    delete: () => ({
      where: (): StatementDescriptor & {
        returning: () => Promise<unknown[]>;
      } => ({
        kind: "delete",
        returning: () => Promise.resolve(deleteReturningRows),
      }),
    }),
    update: () => ({
      set: () => ({
        where: (): StatementDescriptor => ({ kind: "update" }),
      }),
    }),
    batch: (statements: StatementDescriptor[]) => {
      const fires = batchUpdatesFire
        ? (batchUpdatesFire[batchIndex] ?? true)
        : true;
      batchIndex++;
      if (fires) {
        for (const stmt of statements) {
          if (stmt.kind === "update") tracker.updateCount++;
        }
      }
      return Promise.resolve(undefined);
    },
  };

  return { db, tracker };
}

function createMockContext(
  db: ReturnType<typeof createMockDb>["db"],
): ActivityContext {
  return {
    get: (key: string) => (key === "db" ? db : null),
  } as unknown as ActivityContext;
}

const RECIPIENT = "https://local.example/ap/users/alice";
const REMOTE_ACTOR = "https://remote.example/ap/users/bob";
const REMOTE_FOLLOWING = "https://remote.example/ap/users/bob"; // same domain as actor

function recipientRow(): ActorRow {
  return { apId: RECIPIENT } as unknown as ActorRow;
}

// ---------------------------------------------------------------------------
// #10 Flag content cap
// ---------------------------------------------------------------------------

test("handleFlag caps inbound content at 2000 chars at ingest", async () => {
  const { db, tracker } = createMockDb({});
  const ctx = createMockContext(db);

  const longReason = "x".repeat(5000);
  const activity = {
    id: "https://remote.example/ap/activities/flag-1",
    type: "Flag",
    actor: REMOTE_ACTOR,
    object: "https://local.example/ap/objects/note-1",
    content: longReason,
  } as unknown as Activity;

  await handleFlag(ctx, activity, REMOTE_ACTOR);

  expect(tracker.insertedValues.length).toBe(1);
  const persisted = tracker.insertedValues[0] as { content?: unknown };
  expect(typeof persisted.content).toBe("string");
  expect((persisted.content as string).length).toBe(2000);
});

test("handleFlag persists null content when no reason is present", async () => {
  const { db, tracker } = createMockDb({});
  const ctx = createMockContext(db);

  const activity = {
    id: "https://remote.example/ap/activities/flag-2",
    type: "Flag",
    actor: REMOTE_ACTOR,
    object: "https://local.example/ap/objects/note-2",
  } as unknown as Activity;

  await handleFlag(ctx, activity, REMOTE_ACTOR);

  expect(tracker.insertedValues.length).toBe(1);
  const persisted = tracker.insertedValues[0] as { content?: unknown };
  expect(persisted.content).toBeNull();
});

// ---------------------------------------------------------------------------
// #20 Follow-graph counter maintenance
// ---------------------------------------------------------------------------

test("handleAdd increments counters when a new accepted edge is created", async () => {
  const { db, tracker } = createMockDb({
    insertReturningResult: {
      followerApId: RECIPIENT,
      followingApId: REMOTE_FOLLOWING,
      status: "accepted",
    },
    // New edge created => the `edgeAbsent` guard holds, both +1s fire.
    batchUpdatesFire: [true],
  });
  const ctx = createMockContext(db);

  const activity = {
    id: "https://remote.example/ap/activities/add-1",
    type: "Add",
    actor: REMOTE_ACTOR,
    object: RECIPIENT,
    target: REMOTE_FOLLOWING,
  } as unknown as Activity;

  await handleAdd(ctx, activity, recipientRow(), REMOTE_ACTOR);

  // following++ on recipient (follower) and follower++ on the followed actor.
  expect(tracker.updateCount).toBe(2);
});

test("handleAdd is a no-op (no counter drift) when the edge already exists", async () => {
  const { db, tracker } = createMockDb({
    insertReturningResult: undefined, // conflict: edge already existed
    // Edge already present => the `edgeAbsent` guard is false, no +1s.
    batchUpdatesFire: [false],
  });
  const ctx = createMockContext(db);

  const activity = {
    id: "https://remote.example/ap/activities/add-2",
    type: "Add",
    actor: REMOTE_ACTOR,
    object: RECIPIENT,
    target: REMOTE_FOLLOWING,
  } as unknown as Activity;

  await handleAdd(ctx, activity, recipientRow(), REMOTE_ACTOR);

  expect(tracker.updateCount).toBe(0);
});

test("handleRemove decrements counters when an accepted edge is removed", async () => {
  const { db, tracker } = createMockDb({
    deleteReturningRows: [{ status: "accepted" }],
    // Accepted edge => the `acceptedEdgeExists` guard holds, both -1s fire.
    batchUpdatesFire: [true],
  });
  const ctx = createMockContext(db);

  const activity = {
    id: "https://remote.example/ap/activities/remove-1",
    type: "Remove",
    actor: REMOTE_ACTOR,
    object: RECIPIENT,
    target: REMOTE_FOLLOWING,
  } as unknown as Activity;

  await handleRemove(ctx, activity, recipientRow(), REMOTE_ACTOR);

  expect(tracker.updateCount).toBe(2);
});

test("handleRemove does not drift counters for a pending edge", async () => {
  const { db, tracker } = createMockDb({
    deleteReturningRows: [{ status: "pending" }],
    // Pending edge was never counted => the `acceptedEdgeExists` guard is
    // false, no -1s.
    batchUpdatesFire: [false],
  });
  const ctx = createMockContext(db);

  const activity = {
    id: "https://remote.example/ap/activities/remove-2",
    type: "Remove",
    actor: REMOTE_ACTOR,
    object: RECIPIENT,
    target: REMOTE_FOLLOWING,
  } as unknown as Activity;

  await handleRemove(ctx, activity, recipientRow(), REMOTE_ACTOR);

  expect(tracker.updateCount).toBe(0);
});

test("handleRemove does not drift counters when no edge was removed", async () => {
  const { db, tracker } = createMockDb({
    deleteReturningRows: [],
    // No edge existed => the `acceptedEdgeExists` guard is false, no -1s.
    batchUpdatesFire: [false],
  });
  const ctx = createMockContext(db);

  const activity = {
    id: "https://remote.example/ap/activities/remove-3",
    type: "Remove",
    actor: REMOTE_ACTOR,
    object: RECIPIENT,
    target: REMOTE_FOLLOWING,
  } as unknown as Activity;

  await handleRemove(ctx, activity, recipientRow(), REMOTE_ACTOR);

  expect(tracker.updateCount).toBe(0);
});

test("handleBlock decrements counters per removed accepted edge", async () => {
  // Both directions existed and were accepted: 2 edges removed => 4 updates
  // (each removed accepted edge adjusts a following count and a follower count).
  const { db, tracker } = createMockDb({
    deleteReturningRows: [
      {
        followerApId: RECIPIENT,
        followingApId: REMOTE_ACTOR,
        status: "accepted",
      },
      {
        followerApId: REMOTE_ACTOR,
        followingApId: RECIPIENT,
        status: "accepted",
      },
    ],
    // Block runs two severFollowEdge batches (recipient->actor, actor->recipient);
    // both directions were accepted => each batch's two -1s fire => 4 updates.
    batchUpdatesFire: [true, true],
  });
  const ctx = createMockContext(db);

  const activity = {
    id: "https://remote.example/ap/activities/block-1",
    type: "Block",
    actor: REMOTE_ACTOR,
    object: RECIPIENT, // recipient is being blocked
  } as unknown as Activity;

  await handleBlock(ctx, activity, recipientRow(), REMOTE_ACTOR);

  expect(tracker.updateCount).toBe(4);
});

test("handleBlock skips counter updates for pending edges", async () => {
  const { db, tracker } = createMockDb({
    deleteReturningRows: [
      {
        followerApId: RECIPIENT,
        followingApId: REMOTE_ACTOR,
        status: "pending",
      },
    ],
    // Both severFollowEdge batches see only pending/absent accepted edges =>
    // the `acceptedEdgeExists` guard is false in each => no -1s.
    batchUpdatesFire: [false, false],
  });
  const ctx = createMockContext(db);

  const activity = {
    id: "https://remote.example/ap/activities/block-2",
    type: "Block",
    actor: REMOTE_ACTOR,
    object: RECIPIENT,
  } as unknown as Activity;

  await handleBlock(ctx, activity, recipientRow(), REMOTE_ACTOR);

  expect(tracker.updateCount).toBe(0);
});
