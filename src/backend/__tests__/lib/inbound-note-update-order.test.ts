import { expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import {
  activities,
  inboundNoteUpdateEvents,
  inboundNoteUpdateHeads,
  inboundObjectDeletions,
  objects,
  runBatch,
} from "../../../db/index.ts";
import {
  admitInboundNoteUpdate,
  guardInboundNoteUpdateWindow,
  inboundNoteUpdateCommitStatements,
  loadInboundNoteUpdateWindow,
  MAX_PENDING_NOTE_UPDATES,
} from "../../lib/inbound-note-update-order.ts";
import { createTestDb, readMigration } from "../helpers/d1-semantics.ts";

const ACTOR = "https://remote.example/users/alice";
const OTHER = "https://remote.example/users/mallory";
const OBJECT = "https://remote.example/objects/ordered";
const absent = sql`NOT EXISTS (SELECT 1 FROM ${objects} WHERE ${objects.apId} = ${OBJECT})`;

test("admitted event retry preserves its first patch and order across actor aliases", async () => {
  const { db, client } = await createTestDb();
  try {
    const first = await admitInboundNoteUpdate(
      db,
      ACTOR,
      OBJECT,
      ACTOR + "/events/first",
      { content: "First" },
    );
    const retry = await admitInboundNoteUpdate(
      db,
      "https://REMOTE.example:443/users/alice/",
      OBJECT,
      ACTOR + "/events/first",
      { content: "Changed retry" },
    );
    const second = await admitInboundNoteUpdate(
      db,
      ACTOR,
      OBJECT,
      ACTOR + "/events/second",
      { summary: "Second" },
    );
    expect(retry).toEqual(first);
    expect(JSON.parse(retry!.patchJson!)).toEqual({ content: "First" });
    expect(second!.sequence).toBeGreaterThan(first!.sequence);
    const window = await loadInboundNoteUpdateWindow(db, ACTOR, OBJECT);
    expect(window.events.map((e) => e.activityApId)).toEqual([
      first!.activityApId,
      second!.activityApId,
    ]);
    expect(window.applied).toBe(0);
    expect(await db.select().from(objects)).toHaveLength(0);
  } finally {
    client.close();
  }
});

test("one admitted event cannot be rebound to another actor or exact object id", async () => {
  const { db, client } = await createTestDb();
  try {
    await admitInboundNoteUpdate(db, ACTOR, OBJECT, "event-id", {
      content: "Owner",
    });
    await expect(
      admitInboundNoteUpdate(db, OTHER, OBJECT, "event-id", {
        content: "Other",
      }),
    ).rejects.toThrow();
    await expect(
      admitInboundNoteUpdate(db, ACTOR, OBJECT + "?other=1", "event-id", {
        content: "Other",
      }),
    ).rejects.toThrow();
    expect(await db.select().from(inboundNoteUpdateEvents)).toHaveLength(1);
    expect(await db.select().from(inboundNoteUpdateHeads)).toHaveLength(1);
    expect(
      (await loadInboundNoteUpdateWindow(db, OTHER, OBJECT)).events,
    ).toHaveLength(0);
    expect(
      (await loadInboundNoteUpdateWindow(db, ACTOR, OBJECT + "?other=1"))
        .events,
    ).toHaveLength(0);
  } finally {
    client.close();
  }
});

test("object projection and applied head commit together and do not make an old retry new", async () => {
  const { db, client } = await createTestDb();
  try {
    await admitInboundNoteUpdate(db, ACTOR, OBJECT, "first", {
      content: "First",
    });
    await admitInboundNoteUpdate(db, ACTOR, OBJECT, "second", {
      content: "Second",
    });
    const window = await loadInboundNoteUpdateWindow(db, ACTOR, OBJECT);
    const guarded = guardInboundNoteUpdateWindow(db, window, absent);
    await runBatch(guarded, [
      guarded.insert(objects).values({
        apId: OBJECT,
        attributedTo: ACTOR,
        isLocal: 0,
        content: "Second",
      }),
      ...inboundNoteUpdateCommitStatements(guarded, window),
    ]);
    const applied = await loadInboundNoteUpdateWindow(db, ACTOR, OBJECT);
    expect(applied.applied).toBe(window.latest);
    expect(applied.events).toHaveLength(0);
    expect(
      (await db.select().from(inboundNoteUpdateEvents)).every(
        (e) => e.patchJson === null,
      ),
    ).toBe(true);
    await admitInboundNoteUpdate(db, ACTOR, OBJECT, "first", {
      content: "Stale retry",
    });
    expect(
      (await loadInboundNoteUpdateWindow(db, ACTOR, OBJECT)).events,
    ).toHaveLength(0);
    expect((await db.select().from(objects).get())?.content).toBe("Second");
  } finally {
    client.close();
  }
});

test("a newer admitted event atomically rejects stale first exposure without advancing head", async () => {
  const { db, client } = await createTestDb();
  try {
    await admitInboundNoteUpdate(db, ACTOR, OBJECT, "first", {
      content: "Old",
    });
    const old = await loadInboundNoteUpdateWindow(db, ACTOR, OBJECT);
    await admitInboundNoteUpdate(db, ACTOR, OBJECT, "second", {
      content: "New",
    });
    const stale = guardInboundNoteUpdateWindow(db, old, absent);
    await expect(
      runBatch(stale, [
        stale.insert(objects).values({
          apId: OBJECT,
          attributedTo: ACTOR,
          isLocal: 0,
          content: "Old",
        }),
        ...inboundNoteUpdateCommitStatements(stale, old),
      ]),
    ).rejects.toThrow();
    expect(await db.select().from(objects)).toHaveLength(0);
    expect(
      (await db.select().from(inboundNoteUpdateHeads).get())?.appliedSequence,
    ).toBe(0);
    expect(
      (await db.select().from(inboundNoteUpdateEvents).get())?.patchJson,
    ).not.toBeNull();
    const current = await loadInboundNoteUpdateWindow(db, ACTOR, OBJECT);
    expect(current.events).toHaveLength(2);
    const guarded = guardInboundNoteUpdateWindow(db, current, absent);
    await runBatch(guarded, [
      guarded.insert(objects).values({
        apId: OBJECT,
        attributedTo: ACTOR,
        isLocal: 0,
        content: "New",
      }),
      ...inboundNoteUpdateCommitStatements(guarded, current),
    ]);
    expect((await db.select().from(objects).get())?.content).toBe("New");
  } finally {
    client.close();
  }
});

test("real projection SQL failure leaves the complete pending window retryable", async () => {
  const { db, client } = await createTestDb();
  try {
    await admitInboundNoteUpdate(db, ACTOR, OBJECT, "edit", {
      content: "Edited",
    });
    const window = await loadInboundNoteUpdateWindow(db, ACTOR, OBJECT);
    await client.execute(
      "CREATE TRIGGER reject_ordered_materialization BEFORE INSERT ON objects BEGIN SELECT RAISE(ABORT, 'real ordered SQL failure'); END",
    );
    const guarded = guardInboundNoteUpdateWindow(db, window, absent);
    await expect(
      runBatch(guarded, [
        guarded.insert(objects).values({
          apId: OBJECT,
          attributedTo: ACTOR,
          isLocal: 0,
          content: "Edited",
        }),
        ...inboundNoteUpdateCommitStatements(guarded, window),
      ]),
    ).rejects.toThrow("real ordered SQL failure");
    expect(await db.select().from(objects)).toHaveLength(0);
    expect(
      (await loadInboundNoteUpdateWindow(db, ACTOR, OBJECT)).events,
    ).toHaveLength(1);
    expect(
      (await db.select().from(inboundNoteUpdateHeads).get())?.appliedSequence,
    ).toBe(0);
    await client.execute("DROP TRIGGER reject_ordered_materialization");
    await runBatch(guarded, [
      guarded.insert(objects).values({
        apId: OBJECT,
        attributedTo: ACTOR,
        isLocal: 0,
        content: "Edited",
      }),
      ...inboundNoteUpdateCommitStatements(guarded, window),
    ]);
    expect(
      (await loadInboundNoteUpdateWindow(db, ACTOR, OBJECT)).events,
    ).toHaveLength(0);
  } finally {
    client.close();
  }
});

test("pending capacity rejects only new input and becomes available after a real projection commit", async () => {
  const { db, client } = await createTestDb();
  try {
    for (let n = 0; n < MAX_PENDING_NOTE_UPDATES; n++)
      await admitInboundNoteUpdate(db, ACTOR, OBJECT, "edit-" + n, {
        content: "Edit " + n,
      });
    await expect(
      admitInboundNoteUpdate(db, ACTOR, OBJECT, "overflow", {
        content: "Overflow",
      }),
    ).rejects.toThrow();
    expect(await db.select().from(inboundNoteUpdateEvents)).toHaveLength(
      MAX_PENDING_NOTE_UPDATES,
    );
    expect(
      await admitInboundNoteUpdate(db, ACTOR, OBJECT, "edit-0", {
        content: "Retry",
      }),
    ).not.toBeNull();
    const window = await loadInboundNoteUpdateWindow(db, ACTOR, OBJECT);
    const guarded = guardInboundNoteUpdateWindow(db, window, absent);
    await runBatch(guarded, [
      guarded.insert(objects).values({
        apId: OBJECT,
        attributedTo: ACTOR,
        isLocal: 0,
        content: "Last bounded edit",
      }),
      ...inboundNoteUpdateCommitStatements(guarded, window),
    ]);
    expect(
      await admitInboundNoteUpdate(db, ACTOR, OBJECT, "overflow", {
        content: "Overflow",
      }),
    ).not.toBeNull();
    expect(
      (await loadInboundNoteUpdateWindow(db, ACTOR, OBJECT)).events,
    ).toHaveLength(1);
  } finally {
    client.close();
  }
});

test("terminal Delete blocks both further admission and an already planned projection", async () => {
  const { db, client } = await createTestDb();
  try {
    await admitInboundNoteUpdate(db, ACTOR, OBJECT, "first", {
      content: "Pending",
    });
    const window = await loadInboundNoteUpdateWindow(db, ACTOR, OBJECT);
    await db
      .insert(inboundObjectDeletions)
      .values({ actorApId: ACTOR, objectApId: OBJECT });
    expect(
      await admitInboundNoteUpdate(db, ACTOR, OBJECT, "second", {
        content: "Late",
      }),
    ).toBeNull();
    const guarded = guardInboundNoteUpdateWindow(db, window, absent);
    await expect(
      runBatch(guarded, [
        guarded.insert(objects).values({
          apId: OBJECT,
          attributedTo: ACTOR,
          isLocal: 0,
          content: "Pending",
        }),
        ...inboundNoteUpdateCommitStatements(guarded, window),
      ]),
    ).rejects.toThrow();
    expect(await db.select().from(objects)).toHaveLength(0);
    expect(await db.select().from(inboundNoteUpdateEvents)).toHaveLength(1);
  } finally {
    client.close();
  }
});

test("ordering migration is additive and infers no patches from existing processed Activities", async () => {
  const { db, client } = await createTestDb({
    through: "0038_inbound_object_deletions.sql",
  });
  try {
    await db.insert(objects).values({
      apId: OBJECT,
      attributedTo: ACTOR,
      content: "Retained",
      isLocal: 0,
    });
    await db.insert(activities).values({
      apId: "historical-unqualified-update",
      type: "Update",
      actorApId: ACTOR,
      objectApId: OBJECT,
      rawJson: JSON.stringify({
        type: "Update",
        actor: ACTOR,
        object: { id: OBJECT, type: "Note", content: "Unqualified history" },
      }),
      direction: "inbound",
      processed: 1,
    });
    const before = await db.select().from(objects);
    const history = await db.select().from(activities);
    const schema = (
      await client.execute(
        "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name",
      )
    ).rows;
    await client.executeMultiple(
      await readMigration("0039_inbound_note_update_order.sql"),
    );
    expect(await db.select().from(objects)).toEqual(before);
    expect(await db.select().from(activities)).toEqual(history);
    expect(
      (
        await client.execute(
          "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE 'inbound_note_update_%' ORDER BY type,name",
        )
      ).rows,
    ).toEqual(schema);
    expect(await db.select().from(inboundNoteUpdateEvents)).toHaveLength(0);
    expect(await db.select().from(inboundNoteUpdateHeads)).toHaveLength(0);
    await admitInboundNoteUpdate(db, ACTOR, OBJECT, "new-edit", {
      content: "New evidence",
    });
    const receipt = await db.select().from(inboundNoteUpdateEvents);
    await db.delete(objects).where(eq(objects.apId, OBJECT));
    await client.executeMultiple(
      await readMigration("0039_inbound_note_update_order.sql"),
    );
    expect(await db.select().from(inboundNoteUpdateEvents)).toEqual(receipt);
    expect(
      (await client.execute("PRAGMA foreign_key_check")).rows,
    ).toHaveLength(0);
  } finally {
    client.close();
  }
});
