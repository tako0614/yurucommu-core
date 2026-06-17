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
 * exercise:
 *   db.insert().values().onConflictDoNothing().returning().get()
 *   db.insert().values()                                      (Flag, no returning)
 *   db.delete().where().returning()
 *   db.update().set().where()
 *
 * Tracking:
 *   insertedValues  — the value objects passed to insert().values()
 *   updateCount     — number of update().set().where() chains executed
 */
function createMockDb(options: {
  // Row returned by insert(...).returning().get() (undefined = conflict/no-op).
  insertReturningResult?: unknown;
  // Rows returned by delete(...).returning().
  deleteReturningRows?: unknown[];
}) {
  const { insertReturningResult = undefined, deleteReturningRows = [] } =
    options;

  const tracker = {
    insertedValues: [] as unknown[],
    updateCount: 0,
  };

  const db = {
    insert: () => ({
      values: (vals: unknown) => {
        tracker.insertedValues.push(vals);
        const returningGet = () => Promise.resolve(insertReturningResult);
        const returning = () => ({ get: returningGet });
        return {
          onConflictDoNothing: () => ({ returning, get: returningGet }),
          returning,
        };
      },
    }),
    delete: () => ({
      where: () => ({
        returning: () => Promise.resolve(deleteReturningRows),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => {
          tracker.updateCount++;
          return Promise.resolve(undefined);
        },
      }),
    }),
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
  const { db, tracker } = createMockDb({ deleteReturningRows: [] });
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
