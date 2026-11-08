import { expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";

import { notificationArchived, type Database } from "../../../db/index.ts";
import {
  bodyLimit,
  DEFAULT_BODY_LIMIT_BYTES,
} from "../../middleware/body-limit.ts";
import notificationRoutes from "../../routes/notifications.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const me = { ap_id: "https://example.com/ap/users/me" };
const anotherActor = "https://example.com/ap/users/another";
const archivedAt = "2026-08-10T00:00:00.000Z";

function createApp(db: Database, authenticated = true) {
  const app = new Hono();
  app.use("*", bodyLimit({ maxBytes: DEFAULT_BODY_LIMIT_BYTES }));
  app.use("*", async (c, next) => {
    const setter = c as unknown as {
      set: (key: string, value: unknown) => void;
    };
    setter.set("db", db);
    if (authenticated) setter.set("actor", me);
    await next();
  });
  app.route("/api/notifications", notificationRoutes);
  return app;
}

async function deleteArchive(app: Hono, body: unknown) {
  const response = await app.fetch(
    new Request("https://test.local/api/notifications/archive", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    {},
  );
  const text = await response.text();
  let responseBody: unknown = text;
  try {
    responseBody = JSON.parse(text);
  } catch {
    // Keep non-JSON 500 bodies observable to the status assertion below.
  }
  return {
    status: response.status,
    body: responseBody,
  };
}

async function seedMarkers(
  db: Database,
  rows: Array<{ actorApId: string; activityApId: string }>,
) {
  for (const row of rows) {
    await db.insert(notificationArchived).values({ ...row, archivedAt });
  }
}

async function ownMarkerIds(db: Database): Promise<string[]> {
  const rows = await db
    .select({ activityApId: notificationArchived.activityApId })
    .from(notificationArchived)
    .where(eq(notificationArchived.actorApId, me.ap_id));
  return rows.map((row) => row.activityApId).sort();
}

test("DELETE /archive rejects a non-array ids value without deleting a marker", async () => {
  const { db } = await createTestDb();
  const app = createApp(db);
  const activityApId = "https://remote.example/ap/activities/string-ids";
  await seedMarkers(db, [{ actorApId: me.ap_id, activityApId }]);

  const result = await deleteArchive(app, { ids: activityApId });

  expect(result.status).toBe(400);
  expect(await ownMarkerIds(db)).toEqual([activityApId]);
});

test("DELETE /archive rejects mixed-type ids atomically", async () => {
  const { db } = await createTestDb();
  const app = createApp(db);
  const first = "https://remote.example/ap/activities/first";
  const second = "https://remote.example/ap/activities/second";
  await seedMarkers(db, [
    { actorApId: me.ap_id, activityApId: first },
    { actorApId: me.ap_id, activityApId: second },
  ]);

  const result = await deleteArchive(app, { ids: [first, 123] });

  expect(result.status).toBe(400);
  expect(await ownMarkerIds(db)).toEqual([first, second]);
});

test("DELETE /archive normalizes a valid activity id before deletion", async () => {
  const { db } = await createTestDb();
  const app = createApp(db);
  const activityApId = "https://remote.example/ap/activities/trimmed";
  await seedMarkers(db, [{ actorApId: me.ap_id, activityApId }]);

  const result = await deleteArchive(app, { ids: [`  ${activityApId}  `] });

  expect(result).toEqual({ status: 200, body: { success: true } });
  expect(await ownMarkerIds(db)).toEqual([]);
});

test("DELETE /archive accepts the complete D1-safe 90-id boundary", async () => {
  const { db } = await createTestDb();
  const app = createApp(db);
  const ids = Array.from(
    { length: 90 },
    (_, index) => `https://remote.example/ap/activities/cap-${index}`,
  );
  await seedMarkers(
    db,
    ids.map((activityApId) => ({ actorApId: me.ap_id, activityApId })),
  );

  const result = await deleteArchive(app, { ids });

  expect(result).toEqual({ status: 200, body: { success: true } });
  expect(await ownMarkerIds(db)).toEqual([]);
});

test("DELETE /archive removes only the authenticated actor's marker partition", async () => {
  const { db } = await createTestDb();
  const app = createApp(db);
  const sharedActivityApId =
    "https://remote.example/ap/activities/shared-marker";
  await seedMarkers(db, [
    { actorApId: me.ap_id, activityApId: sharedActivityApId },
    { actorApId: anotherActor, activityApId: sharedActivityApId },
  ]);

  const result = await deleteArchive(app, { ids: [sharedActivityApId] });

  expect(result).toEqual({ status: 200, body: { success: true } });
  expect(await ownMarkerIds(db)).toEqual([]);
  expect(
    await db
      .select()
      .from(notificationArchived)
      .where(
        and(
          eq(notificationArchived.actorApId, anotherActor),
          eq(notificationArchived.activityApId, sharedActivityApId),
        ),
      ),
  ).toHaveLength(1);
});

function streamedDelete(body: string, declareLength: boolean) {
  const bytes = new TextEncoder().encode(body);
  const stats = { produced: 0, pulls: 0 };
  let offset = 0;
  let resolveCancelled!: () => void;
  const cancelled = new Promise<void>((resolve) => {
    resolveCancelled = resolve;
  });
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        stats.pulls++;
        if (offset === bytes.length) {
          controller.close();
          return;
        }
        const end = Math.min(offset + 16 * 1024, bytes.length);
        controller.enqueue(bytes.slice(offset, end));
        stats.produced += end - offset;
        offset = end;
      },
      cancel() {
        resolveCancelled();
      },
    },
    { highWaterMark: 0 },
  );
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (declareLength) headers["content-length"] = String(bytes.length);
  const request = new Request("https://test.local/api/notifications/archive", {
    method: "DELETE",
    headers,
    body: stream,
    // @ts-expect-error duplex is required for stream bodies at runtime.
    duplex: "half",
  });
  return { request, stats, cancelled };
}

for (const declared of [true, false]) {
  test(`DELETE /archive rejects an oversized ${declared ? "declared" : "chunked"} body without deleting markers`, async () => {
    const { db } = await createTestDb();
    const app = createApp(db);
    const activityApId = "https://remote.example/ap/activities/retained";
    await seedMarkers(db, [{ actorApId: me.ap_id, activityApId }]);
    const source = streamedDelete(
      JSON.stringify({
        ids: [activityApId],
        padding: "x".repeat(DEFAULT_BODY_LIMIT_BYTES * 2),
      }),
      declared,
    );
    const response = await app.fetch(source.request, {} as never);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: "body_too_large",
      limit: DEFAULT_BODY_LIMIT_BYTES,
    });
    expect(await ownMarkerIds(db)).toEqual([activityApId]);
    if (declared) {
      expect(source.stats.produced).toBe(0);
    } else {
      await source.cancelled;
      expect(source.stats.produced).toBeLessThanOrEqual(
        DEFAULT_BODY_LIMIT_BYTES + 32 * 1024,
      );
    }
  });
}

test("DELETE /archive authenticates before reading an undeclared body", async () => {
  const { db } = await createTestDb();
  const app = createApp(db, false);
  const activityApId = "https://remote.example/ap/activities/retained";
  await seedMarkers(db, [{ actorApId: me.ap_id, activityApId }]);
  const source = streamedDelete(
    JSON.stringify({ ids: [activityApId], padding: "x".repeat(64 * 1024) }),
    false,
  );
  const response = await app.fetch(source.request, {} as never);
  expect(response.status).toBe(401);
  expect(source.stats.pulls).toBeLessThanOrEqual(1);
  expect(await ownMarkerIds(db)).toEqual([activityApId]);
});

test("DELETE /archive preserves malformed-body errors and markers", async () => {
  const { db } = await createTestDb();
  const app = createApp(db);
  const activityApId = "https://remote.example/ap/activities/retained";
  await seedMarkers(db, [{ actorApId: me.ap_id, activityApId }]);
  const response = await app.fetch(
    new Request("https://test.local/api/notifications/archive", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: "{bad",
    }),
    {} as never,
  );
  expect(response.status).toBe(400);
  expect(await ownMarkerIds(db)).toEqual([activityApId]);
});
