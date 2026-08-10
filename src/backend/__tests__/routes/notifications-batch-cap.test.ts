import { expect, test } from "bun:test";
import { Hono } from "hono";

import {
  activities,
  inbox,
  insertMany,
  notificationArchived,
  runBatch,
  type D1Statement,
  type Database,
} from "../../../db/index.ts";
import notificationRoutes from "../../routes/notifications.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

// Matches MAX_READ_BATCH_SIZE / MAX_ARCHIVE_BATCH_SIZE in the route — capped at
// 90 so the per-id `inArray(..., body.ids)` re-query stays under D1's 100-bound-
// parameter limit.
const MAX_BATCH = 90;

/**
 * Minimal DB stub. The batch-size cap is enforced before any DB access, so the
 * update/delete builders only need to record whether they were reached. If a
 * cap check fails to short-circuit, the test asserts these were never invoked.
 */
function createTrackingDb() {
  const tracker = { updateCalls: 0, deleteCalls: 0 };
  const updateChain = {
    set: () => ({
      where: () => Promise.resolve({ meta: { changes: 0 } }),
    }),
  };
  const deleteChain = {
    where: () => Promise.resolve(undefined),
  };
  return {
    db: {
      update: () => {
        tracker.updateCalls++;
        return updateChain;
      },
      delete: () => {
        tracker.deleteCalls++;
        return deleteChain;
      },
    },
    tracker,
  };
}

function createApp(db: unknown, actor: { ap_id: string } | null) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    const setter = c as unknown as {
      set: (key: string, value: unknown) => void;
    };
    setter.set("db", db);
    setter.set("actor", actor);
    await next();
  });
  app.route("/api/notifications", notificationRoutes);
  return app;
}

async function requestJson(app: Hono, path: string, init: RequestInit) {
  const res = await app.fetch(
    new Request(`https://test.local${path}`, init),
    {},
  );
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { res, body };
}

const actor = { ap_id: "https://example.com/ap/users/alice" };

async function seedInbox(
  db: Database,
  rows: Array<{ actorApId: string; activityApId: string }>,
): Promise<void> {
  const createdAt = new Date().toISOString();
  const activityStatements = insertMany(
    db,
    activities,
    rows.map(({ actorApId, activityApId }) => ({
      apId: activityApId,
      type: "Create",
      actorApId,
      rawJson: "{}",
      direction: "inbound",
      createdAt,
    })),
  );
  const inboxStatements = insertMany(
    db,
    inbox,
    rows.map(({ actorApId, activityApId }) => ({
      actorApId,
      activityApId,
      read: 0,
      createdAt,
    })),
  );
  await runBatch(db, [...activityStatements, ...inboxStatements] as [
    D1Statement,
    ...D1Statement[],
  ]);
}

async function seedLargeInbox(
  db: Database,
  rows: Array<{ actorApId: string; activityApId: string }>,
): Promise<void> {
  // A production-sized archive-all regression crosses the D1 batch statement
  // cap during setup. Page only that fixture source set; each page retains the
  // shipped atomic activity+inbox write and foreign-key ordering.
  for (let offset = 0; offset < rows.length; offset += 300) {
    await seedInbox(db, rows.slice(offset, offset + 300));
  }
}

function oversizedIds(): string[] {
  return Array.from(
    { length: MAX_BATCH + 1 },
    (_, i) => `https://example.com/activities/${i}`,
  );
}

test("POST /read rejects oversized ids array with 400 array_too_long", async () => {
  const { db, tracker } = createTrackingDb();
  const app = createApp(db, actor);

  const { res, body } = await requestJson(app, "/api/notifications/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: oversizedIds() }),
  });

  expect(res.status).toEqual(400);
  expect(body).toEqual(expect.any(Object));
  // Must short-circuit before touching the DB.
  expect(tracker.updateCalls).toEqual(0);
});

test("POST /read accepts ids array at the cap", async () => {
  const { db, tracker } = createTrackingDb();
  const app = createApp(db, actor);
  const ids = Array.from(
    { length: MAX_BATCH },
    (_, i) => `https://example.com/activities/${i}`,
  );

  const { res, body } = await requestJson(app, "/api/notifications/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });

  expect(res.status).toEqual(200);
  expect(body).toEqual(expect.any(Object));
  expect(tracker.updateCalls).toEqual(1);
});

test("POST /archive reports the libsql rows inserted across D1-sized chunks", async () => {
  const { db } = await createTestDb();
  const app = createApp(db, actor);
  const ids = Array.from(
    { length: 35 },
    (_, i) => `https://example.com/activities/archive-${i}`,
  );
  await seedInbox(
    db,
    ids.map((activityApId) => ({
      actorApId: actor.ap_id,
      activityApId,
    })),
  );

  const first = await requestJson(app, "/api/notifications/archive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });

  expect(first.res.status).toEqual(200);
  expect(first.body).toEqual({ success: true, archived_count: ids.length });
  expect(await db.select().from(notificationArchived)).toHaveLength(ids.length);

  const duplicate = await requestJson(app, "/api/notifications/archive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });

  expect(duplicate.res.status).toEqual(200);
  expect(duplicate.body).toEqual({ success: true, archived_count: 0 });
  expect(await db.select().from(notificationArchived)).toHaveLength(ids.length);
});

test("POST /archive creates markers only for the authenticated actor's retained inbox", async () => {
  const { db } = await createTestDb();
  const app = createApp(db, actor);
  const ownId = "https://example.com/activities/own";
  const foreignId = "https://example.com/activities/foreign";
  const missingId = "https://example.com/activities/missing";
  await seedInbox(db, [
    {
      actorApId: actor.ap_id,
      activityApId: ownId,
    },
    {
      actorApId: "https://example.com/ap/users/bob",
      activityApId: foreignId,
    },
  ]);

  const result = await requestJson(app, "/api/notifications/archive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: [ownId, foreignId, missingId] }),
  });

  expect(result.res.status).toEqual(200);
  expect(result.body).toEqual({ success: true, archived_count: 1 });
  expect(await db.select().from(notificationArchived)).toEqual([
    expect.objectContaining({
      actorApId: actor.ap_id,
      activityApId: ownId,
    }),
  ]);
});

test("POST /archive/all materializes only the authenticated actor's inbox and is idempotent", async () => {
  const { db } = await createTestDb();
  const app = createApp(db, actor);
  const ownIds = [
    "https://example.com/activities/own-all-1",
    "https://example.com/activities/own-all-2",
  ];
  await seedInbox(db, [
    ...ownIds.map((activityApId) => ({
      actorApId: actor.ap_id,
      activityApId,
    })),
    {
      actorApId: "https://example.com/ap/users/bob",
      activityApId: "https://example.com/activities/foreign-all",
    },
  ]);

  const first = await requestJson(app, "/api/notifications/archive/all", {
    method: "POST",
  });
  expect(first.res.status).toEqual(200);
  expect(first.body).toEqual({ success: true, archived_count: ownIds.length });
  expect(
    (await db.select().from(notificationArchived)).map(
      (row) => row.activityApId,
    ),
  ).toEqual(expect.arrayContaining(ownIds));
  expect(await db.select().from(notificationArchived)).toHaveLength(
    ownIds.length,
  );

  const duplicate = await requestJson(app, "/api/notifications/archive/all", {
    method: "POST",
  });
  expect(duplicate.res.status).toEqual(200);
  expect(duplicate.body).toEqual({ success: true, archived_count: 0 });
});

test("POST /archive/all does not report success while notifications remain past its internal batch", async () => {
  const { db } = await createTestDb();
  const app = createApp(db, actor);
  const ownIds = Array.from(
    { length: 1001 },
    (_, i) => `https://example.com/activities/archive-all-over-cap-${i}`,
  );
  await seedLargeInbox(
    db,
    ownIds.map((activityApId) => ({
      actorApId: actor.ap_id,
      activityApId,
    })),
  );

  const first = await requestJson(app, "/api/notifications/archive/all", {
    method: "POST",
  });

  expect(first.res.status).toEqual(200);
  expect(first.body).toEqual({
    success: true,
    archived_count: ownIds.length,
  });
  expect(await db.select().from(notificationArchived)).toHaveLength(
    ownIds.length,
  );

  const duplicate = await requestJson(app, "/api/notifications/archive/all", {
    method: "POST",
  });
  expect(duplicate.res.status).toEqual(200);
  expect(duplicate.body).toEqual({ success: true, archived_count: 0 });
});

test("DELETE /archive rejects oversized ids array with 400 array_too_long", async () => {
  const { db, tracker } = createTrackingDb();
  const app = createApp(db, actor);

  const { res, body } = await requestJson(app, "/api/notifications/archive", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: oversizedIds() }),
  });

  expect(res.status).toEqual(400);
  expect(body).toEqual(expect.any(Object));
  expect(tracker.deleteCalls).toEqual(0);
});

test("POST /read returns 401 Unauthorized when no actor is present", async () => {
  const { db, tracker } = createTrackingDb();
  // No authenticated actor: the canonical requireActor must short-circuit to 401
  // before any DB access.
  const app = createApp(db, null);

  const { res, body } = await requestJson(app, "/api/notifications/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ read_all: true }),
  });

  expect(res.status).toEqual(401);
  expect(body).toEqual({ error: "Unauthorized" });
  expect(tracker.updateCalls).toEqual(0);
});

// Audit #11 finding #6: a literal `null` (or primitive) JSON body parses without
// throwing, then `body.read_all` threw a TypeError that became a 500. The body
// guard now returns a clean 400 (no app crash; no DB access).
test("POST /read with a literal `null` JSON body returns 400, not 500", async () => {
  const { db, tracker } = createTrackingDb();
  const app = createApp(db, actor);

  for (const malformed of ["null", "123", '"a string"']) {
    const { res } = await requestJson(app, "/api/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: malformed,
    });
    expect(res.status).toEqual(400);
  }
  expect(tracker.updateCalls).toEqual(0);
});
