import { expect, test } from "bun:test";
import { Hono } from "hono";

import {
  activities,
  inbox,
  notificationArchived,
  objects,
  type Database,
} from "../../../db/index.ts";
import notificationRoutes from "../../routes/notifications.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const me = { ap_id: "https://example.com/ap/users/me" };
const remote = "https://remote.example/ap/users/sender";
const createdAt = "2026-08-10T00:00:00.000Z";

function createApp(db: Database) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    const setter = c as unknown as {
      set: (key: string, value: unknown) => void;
    };
    setter.set("db", db);
    setter.set("actor", me);
    await next();
  });
  app.route("/api/notifications", notificationRoutes);
  return app;
}

async function postRead(app: Hono, body: unknown) {
  const response = await app.fetch(
    new Request("https://test.local/api/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    {},
  );
  return {
    status: response.status,
    body: (await response.json()) as unknown,
  };
}

async function insertInboxActivity(
  db: Database,
  input: {
    activityApId: string;
    activityType?: string;
    activityActorApId?: string;
    objectApId?: string;
  },
) {
  await db.insert(activities).values({
    apId: input.activityApId,
    type: input.activityType ?? "Like",
    actorApId: input.activityActorApId ?? remote,
    objectApId: input.objectApId,
    rawJson: "{}",
    direction: "inbound",
    createdAt,
  });
  await db.insert(inbox).values({
    actorApId: me.ap_id,
    activityApId: input.activityApId,
    read: 0,
    createdAt,
  });
}

async function readState(db: Database): Promise<Record<string, number>> {
  const rows = await db
    .select({ activityApId: inbox.activityApId, read: inbox.read })
    .from(inbox);
  return Object.fromEntries(rows.map((row) => [row.activityApId, row.read]));
}

test("POST /read rejects a truthy non-boolean read_all without mutating inbox state", async () => {
  const { db } = await createTestDb();
  const app = createApp(db);
  const activityApId = "https://remote.example/ap/activities/eligible";
  await insertInboxActivity(db, { activityApId });

  const result = await postRead(app, { read_all: "false" });

  expect(result.status).toBe(400);
  expect(await readState(db)).toEqual({ [activityApId]: 0 });
});

test("POST /read rejects a mixed-type ids array atomically", async () => {
  const { db } = await createTestDb();
  const app = createApp(db);
  const first = "https://remote.example/ap/activities/first";
  const second = "https://remote.example/ap/activities/second";
  await insertInboxActivity(db, { activityApId: first });
  await insertInboxActivity(db, { activityApId: second });

  const result = await postRead(app, { ids: [first, 123] });

  expect(result.status).toBe(400);
  expect(await readState(db)).toEqual({ [first]: 0, [second]: 0 });
});

test("POST /read read_all marks only active user-facing social notifications", async () => {
  const { db } = await createTestDb();
  const app = createApp(db);
  const eligible = "https://remote.example/ap/activities/eligible";
  const direct = "https://remote.example/ap/activities/direct";
  const archived = "https://remote.example/ap/activities/archived";
  const self = "https://example.com/ap/activities/self";
  const nonUserFacing = "https://remote.example/ap/activities/update";
  const directObject = "https://remote.example/ap/objects/direct";

  await db.insert(objects).values({
    apId: directObject,
    type: "Note",
    attributedTo: remote,
    content: "private message",
    visibility: "direct",
    toJson: JSON.stringify([me.ap_id]),
    ccJson: "[]",
    audienceJson: "[]",
    published: createdAt,
    isLocal: 0,
  });
  await insertInboxActivity(db, { activityApId: eligible });
  await insertInboxActivity(db, {
    activityApId: direct,
    activityType: "Create",
    objectApId: directObject,
  });
  await insertInboxActivity(db, { activityApId: archived });
  await insertInboxActivity(db, {
    activityApId: self,
    activityActorApId: me.ap_id,
  });
  await insertInboxActivity(db, {
    activityApId: nonUserFacing,
    activityType: "Update",
  });
  await db.insert(notificationArchived).values({
    actorApId: me.ap_id,
    activityApId: archived,
    archivedAt: createdAt,
  });

  const result = await postRead(app, { read_all: true });

  expect(result).toEqual({ status: 200, body: { success: true } });
  expect(await readState(db)).toEqual({
    [eligible]: 1,
    [direct]: 0,
    [archived]: 0,
    [self]: 0,
    [nonUserFacing]: 0,
  });
});
