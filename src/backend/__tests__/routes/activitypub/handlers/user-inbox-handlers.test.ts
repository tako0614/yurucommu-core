import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { assertSpyCalls, spy } from "#test/mock";
import {
  handleDelete,
  handleLike,
} from "../../../../routes/activitypub/handlers/user-inbox-handlers.ts";
import type {
  Activity,
  ActivityContext,
} from "../../../../routes/activitypub/inbox-types.ts";
import {
  actors,
  objects,
  likes,
  announces,
  bookmarks,
  objectRecipients,
  storyViews,
  storyVotes,
  storyShares,
  activities,
  inbox,
  inboundActivityClaims,
} from "../../../../../db/index.ts";
import { createTestDb } from "../../../helpers/d1-semantics.ts";

type ActorRow = typeof actors.$inferSelect;

/**
 * Creates a mock Drizzle DB that supports chainable patterns:
 *   db.select().from().where().get()
 *   db.get(sql)
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
    const rows = Array.isArray(result)
      ? result
      : result == null
        ? []
        : [result];
    const limit = spy(() => Promise.resolve(rows));
    const orderBy = spy(() => ({ limit }));
    const where = spy(() =>
      Object.assign(Promise.resolve(rows), {
        get: spy(() => Promise.resolve(result)),
        limit,
        orderBy,
      }),
    );
    const chain = {
      from: spy(() => ({
        where,
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
  // Personal moderation first checks exact block/mute rows through the normal
  // select chain, then asks one raw SQL identity-set query only on a miss.
  const rawGetSpy = spy(() => Promise.resolve({ matched: 0 }));

  const db = {
    select: selectSpy,
    get: rawGetSpy,
    insert: insertSpy,
    update: updateSpy,
    delete: deleteSpy,
    batch: batchSpy,
    query: {
      blockedActors: {
        findFirst: spy((..._args: unknown[]) => Promise.resolve(null)),
      },
      blockedDomains: {
        findFirst: spy((..._args: unknown[]) => Promise.resolve(null)),
      },
    },
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
    // [0] = the audit#17 block/read-gate target lookup (a PUBLIC local post, so
    // the gate passes), [1..2] = exact block/mute lookups, and [3] = the
    // pre-dispatch existing-edge lookup (truthy → no second notify select).
    // The complete cosmetic identity fallback is one db.get(sql) query.
    selectResults: [
      {
        attributedTo: targetApId,
        visibility: "public",
        toJson: "[]",
        ccJson: "[]",
        audienceJson: "[]",
        communityApId: null,
      },
      undefined,
      undefined,
      { actorApId },
    ],
    insertReturningResult: { actorApId, objectApId, activityApId: "like-1" },
  });

  const context = createMockContext(db);

  const activity: Activity = {
    id: "https://example.com/ap/activities/like-1",
    type: "Like",
    actor: actorApId,
    object: objectApId,
  };

  await handleLike(context, activity, actorApId, "https://example.com");

  // Four selects: the audit#17 gate's target lookup + exact block/mute lookups
  // (canViewerReadObjectFull short-circuits on a public, non-community object
  // with no select), then the existing-edge lookup. Cosmetic matching is the
  // separate SQL identity-set query.
  assertSpyCalls(db.select, 4);
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
    // [0] = audit#17 gate target (public local post → gate passes), [1..2] =
    // exact block/mute lookups (not suppressed), and [3] = the existing-edge
    // lookup returning a row (modelling the duplicate/re-delivered Like).
    selectResults: [
      {
        attributedTo: "https://example.com/ap/users/bob",
        visibility: "public",
        toJson: "[]",
        ccJson: "[]",
        audienceJson: "[]",
        communityApId: null,
      },
      undefined,
      undefined,
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
  // returns before the notify path. Four selects: the audit#17 gate (target +
  // exact block/mute checks) then the existing-edge lookup. Cosmetic matching
  // is the separate SQL identity-set query.
  assertSpyCalls(db.select, 4);
});

test("userInboxHandlers hardening - handleDelete performs dependent deletes and counter update", async () => {
  // The atomic owner assertion requires a real batch result, not a mock that
  // merely counts builder calls. Keep the original child/counter contract and
  // observe its actual database effects under the owning runtime semantics.
  const { db, client } = await createTestDb();
  const origin = "https://example.com",
    author = origin + "/ap/users/alice",
    bob = origin + "/ap/users/bob";
  const id = origin + "/ap/objects/note-3",
    other = origin + "/ap/objects/unrelated",
    create = origin + "/ap/activities/create-1";
  try {
    for (const apId of [author, bob])
      await db.insert(actors).values({
        apId,
        preferredUsername: apId.split("/").at(-1)!,
        inbox: apId + "/inbox",
        outbox: apId + "/outbox",
        followersUrl: apId + "/followers",
        followingUrl: apId + "/following",
        publicKeyPem: "unit-unused",
        privateKeyPem: "unit-unused",
        postCount: 1,
      });
    await db.insert(objects).values([
      {
        apId: id,
        attributedTo: author,
        type: "Note",
        content: "Target",
        isLocal: 1,
      },
      {
        apId: other,
        attributedTo: bob,
        type: "Note",
        content: "Unrelated",
        isLocal: 1,
      },
    ]);
    await db.insert(likes).values([
      { actorApId: bob, objectApId: id },
      { actorApId: author, objectApId: other },
    ]);
    await db.insert(announces).values({ actorApId: bob, objectApId: id });
    await db.insert(bookmarks).values({ actorApId: bob, objectApId: id });
    await db
      .insert(objectRecipients)
      .values({ objectApId: id, recipientApId: bob, type: "to" });
    await db.insert(storyViews).values({ actorApId: bob, storyApId: id });
    await db
      .insert(storyVotes)
      .values({ id: "vote", actorApId: bob, storyApId: id, optionIndex: 0 });
    await db
      .insert(storyShares)
      .values({ id: "share", actorApId: bob, storyApId: id });
    await db.insert(activities).values({
      apId: create,
      type: "Create",
      actorApId: author,
      objectApId: id,
      rawJson: "{}",
      direction: "inbound",
      processed: 1,
    });
    await db.insert(inbox).values({ actorApId: bob, activityApId: create });
    await db.insert(inboundActivityClaims).values({ activityApId: create });
    const untouched = await db
      .select()
      .from(objects)
      .where(eq(objects.apId, other));
    const context = {
      get: (key: string) => (key === "db" ? db : null),
      env: { APP_URL: origin },
    } as unknown as ActivityContext;
    await handleDelete(context, {
      id: origin + "/ap/activities/delete-1",
      type: "Delete",
      actor: author,
      object: id,
    } as Activity);
    expect(
      await db.select().from(objects).where(eq(objects.apId, id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(likes).where(eq(likes.objectApId, id)),
    ).toHaveLength(0);
    for (const table of [
      announces,
      bookmarks,
      objectRecipients,
      storyViews,
      storyVotes,
      storyShares,
      inbox,
      inboundActivityClaims,
    ]) {
      expect(await db.select().from(table)).toHaveLength(0);
    }
    expect(
      (await db.select().from(actors).where(eq(actors.apId, author)).get())
        ?.postCount,
    ).toBe(0);
    expect(
      (await db.select().from(actors).where(eq(actors.apId, bob)).get())
        ?.postCount,
    ).toBe(1);
    expect(
      await db.select().from(objects).where(eq(objects.apId, other)),
    ).toEqual(untouched);
    expect(
      await db.select().from(likes).where(eq(likes.objectApId, other)),
    ).toHaveLength(1);
    expect(await db.select().from(activities)).toHaveLength(1);
  } finally {
    client.close();
  }
});

/** Helper: assert a spy was called at least once */
function assert_called(spyFn: { calls: unknown[] }) {
  if (spyFn.calls.length === 0) {
    throw new Error("Expected spy to have been called at least once");
  }
}
