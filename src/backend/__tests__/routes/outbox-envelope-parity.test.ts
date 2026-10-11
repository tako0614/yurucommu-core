import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import {
  activities,
  actors,
  communities,
  instanceActor,
  objects,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import activityPubRoutes from "../../routes/activitypub.ts";
import { __outboxCursorInternals } from "../../routes/activitypub/outbox.ts";

const APP_URL = "https://yuru.test";
const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";
const CREATED_AT = "2026-01-01T00:00:01.000Z";
const MIGRATIONS_ROOT = new URL("../../../../migrations/", import.meta.url);

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const migrationFiles = (await readdir(MIGRATIONS_ROOT))
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort();
  for (const file of migrationFiles) {
    await client.executeMultiple(
      await readFile(new URL(file, MIGRATIONS_ROOT), "utf8"),
    );
  }
  return drizzle(client, { schema }) as unknown as Database;
}

function localActorApId(username: string): string {
  return `${APP_URL}/ap/users/${username}`;
}

type OutboxTarget = {
  db: Database;
  path: string;
  actorApId: string;
  authorApId: string;
  groupOutbox: boolean;
};

async function insertLocalActor(
  db: Database,
  username: string,
): Promise<string> {
  const apId = localActorApId(username);
  await db.insert(actors).values({
    apId,
    type: "Person",
    preferredUsername: username,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    followingUrl: `${apId}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
  });
  return apId;
}

async function prepareOutboxTarget(
  kind: "personal" | "instance" | "group",
): Promise<OutboxTarget> {
  const db = await freshDb();
  if (kind === "personal") {
    const actorApId = await insertLocalActor(db, "alice");
    return {
      db,
      path: "/ap/users/alice/outbox",
      actorApId,
      authorApId: actorApId,
      groupOutbox: false,
    };
  }

  if (kind === "instance") {
    const actorApId = `${APP_URL}/ap/actor`;
    await db.insert(instanceActor).values({
      apId: actorApId,
      preferredUsername: "instance",
      publicKeyPem: "pub",
      privateKeyPem: "priv",
    });
    return {
      db,
      path: "/ap/actor/outbox",
      actorApId,
      authorApId: actorApId,
      groupOutbox: false,
    };
  }

  const authorApId = await insertLocalActor(db, "group-owner");
  const actorApId = `${APP_URL}/ap/groups/public-club`;
  await db.insert(communities).values({
    apId: actorApId,
    preferredUsername: "public-club",
    name: "Public Club",
    inbox: `${actorApId}/inbox`,
    outbox: `${actorApId}/outbox`,
    followersUrl: `${actorApId}/followers`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: authorApId,
    visibility: "public",
  });
  return {
    db,
    path: "/ap/groups/public-club/outbox",
    actorApId,
    authorApId,
    groupOutbox: true,
  };
}

function envFor(db: Database): Env {
  return { APP_URL, DB_INSTANCE: db } as unknown as Env;
}

function appWith(db: Database): Hono<{
  Bindings: Env;
  Variables: Variables;
}> {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", null as Actor | null);
    await next();
  });
  app.route("/", activityPubRoutes);
  return app;
}

async function fetchJson(
  db: Database,
  path: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await appWith(db).fetch(
    new Request(`${APP_URL}${path}`),
    envFor(db),
  );
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

async function insertPublicNote(
  db: Database,
  input: { id: string; authorApId: string },
): Promise<void> {
  await db.insert(objects).values({
    apId: input.id,
    type: "Note",
    attributedTo: input.authorApId,
    content: `fixture for ${input.id}`,
    visibility: "public",
    toJson: JSON.stringify([PUBLIC]),
    audienceJson: "[]",
    published: CREATED_AT,
    isLocal: 1,
  });
}

async function insertOutboundActivity(input: {
  db: Database;
  id: string;
  actorApId: string;
  objectApId: string;
  type: string;
  rawJson: string;
}): Promise<void> {
  await input.db.insert(activities).values({
    apId: input.id,
    type: input.type,
    actorApId: input.actorApId,
    objectApId: input.objectApId,
    direction: "outbound",
    rawJson: input.rawJson,
    createdAt: CREATED_AT,
  });
}

function activityId(suffix: string): string {
  return `${APP_URL}/ap/activities/${suffix}`;
}

async function seedJoinedActivity(
  db: Database,
  input: {
    actorApId: string;
    authorApId: string;
    suffix: string;
    type: "Create" | "Announce";
    rawJson: string;
  },
): Promise<string> {
  const id = activityId(input.suffix);
  const objectId = `${APP_URL}/ap/objects/${input.suffix}`;
  await insertPublicNote(db, { id: objectId, authorApId: input.authorApId });
  await insertOutboundActivity({
    db,
    id,
    actorApId: input.actorApId,
    objectApId: objectId,
    type: input.type,
    rawJson: input.rawJson,
  });
  return id;
}

async function seedInvalidEnvelopeCases(input: {
  db: Database;
  outboxActorApId: string;
  authorApId: string;
  groupOutbox: boolean;
}): Promise<void> {
  const invalidRows = [
    { suffix: "zz-invalid-json", rawJson: `{"type":"Announce",` },
    { suffix: "zy-json-null", rawJson: "null" },
    { suffix: "zx-array", rawJson: "[]" },
    { suffix: "zw-string", rawJson: JSON.stringify("activity") },
    { suffix: "zv-number", rawJson: "17" },
    { suffix: "zu-boolean", rawJson: "true" },
  ];
  for (const row of invalidRows) {
    await seedJoinedActivity(input.db, {
      actorApId: input.outboxActorApId,
      authorApId: input.authorApId,
      suffix: row.suffix,
      type: input.groupOutbox ? "Announce" : "Create",
      rawJson: row.rawJson,
    });
  }
}

async function seedEnvelopeCases(input: {
  db: Database;
  outboxActorApId: string;
  authorApId: string;
  groupOutbox: boolean;
}): Promise<string[]> {
  await seedInvalidEnvelopeCases(input);

  if (input.groupOutbox) {
    const announceIds = [];
    for (const suffix of ["b-good-announce", "a-good-announce"]) {
      const id = activityId(suffix);
      const objectId = `${APP_URL}/ap/objects/${suffix}`;
      await insertPublicNote(input.db, {
        id: objectId,
        authorApId: input.authorApId,
      });
      await insertOutboundActivity({
        db: input.db,
        id,
        actorApId: input.outboxActorApId,
        objectApId: objectId,
        type: "Announce",
        rawJson: JSON.stringify({
          id,
          type: "Announce",
          actor: input.outboxActorApId,
          object: objectId,
        }),
      });
      announceIds.push(id);
    }
    return announceIds.sort().reverse();
  }

  const createId = await seedJoinedActivity(input.db, {
    actorApId: input.outboxActorApId,
    authorApId: input.authorApId,
    suffix: "b-good-create",
    type: "Create",
    rawJson: JSON.stringify({
      id: activityId("b-good-create"),
      type: "Create",
      actor: input.outboxActorApId,
      object: { id: `${APP_URL}/ap/objects/b-good-create`, type: "Note" },
      to: [PUBLIC],
    }),
  });
  const announceId = await seedJoinedActivity(input.db, {
    actorApId: input.outboxActorApId,
    authorApId: input.authorApId,
    suffix: "a-good-announce",
    type: "Announce",
    rawJson: JSON.stringify({
      id: activityId("a-good-announce"),
      type: "Announce",
      actor: input.outboxActorApId,
      object: `${APP_URL}/ap/objects/a-good-announce`,
      to: [PUBLIC],
    }),
  });

  // This is the ordinary public boost branch: its target is remote and has no
  // local objects row, so visibility comes from the Announce's Public address.
  const remoteAnnounceId = activityId("c-unknown-public-announce");
  await insertOutboundActivity({
    db: input.db,
    id: remoteAnnounceId,
    actorApId: input.outboxActorApId,
    objectApId: "https://remote.example/notes/unknown-public",
    type: "Announce",
    rawJson: JSON.stringify({
      id: remoteAnnounceId,
      type: "Announce",
      actor: input.outboxActorApId,
      object: "https://remote.example/notes/unknown-public",
      to: [PUBLIC],
    }),
  });
  return [remoteAnnounceId, createId, announceId].sort().reverse();
}

async function expectOutboxParity(
  db: Database,
  path: string,
  expectedIds: string[],
): Promise<void> {
  const collection = await fetchJson(db, path);
  expect(collection.status).toEqual(200);
  expect(collection.body.totalItems).toEqual(expectedIds.length);

  const orderedExpected = [...expectedIds].sort().reverse();
  let cursor: string | null = null;
  for (let index = 0; index < orderedExpected.length; index++) {
    const query = new URLSearchParams({ page: "1", limit: "1" });
    if (cursor) query.set("cursor", cursor);
    const page = await fetchJson(db, `${path}?${query.toString()}`);
    expect(page.status).toEqual(200);
    const items = (page.body.orderedItems ?? []) as Array<
      Record<string, unknown>
    >;
    expect(items.map((item) => item.id)).toEqual([orderedExpected[index]]);

    if (index < orderedExpected.length - 1) {
      cursor = __outboxCursorInternals.encodeCursor({
        createdAt: CREATED_AT,
        id: orderedExpected[index]!,
      });
      const expectedNext = new URL(`${APP_URL}${path}`);
      expectedNext.searchParams.set("page", "1");
      expectedNext.searchParams.set("cursor", cursor);
      expect(page.body.next).toEqual(expectedNext.toString());
      const nextUrl = new URL(page.body.next as string);
      expect(nextUrl.pathname + nextUrl.search).toEqual(
        `${path}?page=1&cursor=${encodeURIComponent(cursor)}`,
      );
      const actualNextParams = nextUrl.searchParams;
      expect(actualNextParams.get("page")).toEqual("1");
      cursor = actualNextParams.get("cursor");
      expect(cursor).not.toBeNull();
    } else {
      expect(page.body.next).toBeUndefined();
    }
  }
}

async function expectEmptyOutbox(db: Database, path: string): Promise<void> {
  const collection = await fetchJson(db, path);
  expect(collection.status).toEqual(200);
  expect(collection.body.totalItems).toEqual(0);

  const page = await fetchJson(db, `${path}?page=1&limit=1`);
  expect(page.status).toEqual(200);
  expect(page.body.orderedItems).toEqual([]);
  expect(page.body.next).toBeUndefined();
}

async function ledgerSnapshot(db: Database) {
  return await db.select().from(activities).orderBy(activities.apId);
}

test("personal outbox counts and pages root activity objects only", async () => {
  const target = await prepareOutboxTarget("personal");
  const ids = await seedEnvelopeCases({
    db: target.db,
    outboxActorApId: target.actorApId,
    authorApId: target.authorApId,
    groupOutbox: target.groupOutbox,
  });
  const before = await ledgerSnapshot(target.db);
  await expectOutboxParity(target.db, target.path, ids);
  expect(await ledgerSnapshot(target.db)).toEqual(before);
});

test("instance outbox counts and pages root activity objects only", async () => {
  const target = await prepareOutboxTarget("instance");
  const ids = await seedEnvelopeCases({
    db: target.db,
    outboxActorApId: target.actorApId,
    authorApId: target.authorApId,
    groupOutbox: target.groupOutbox,
  });
  const before = await ledgerSnapshot(target.db);
  await expectOutboxParity(target.db, target.path, ids);
  expect(await ledgerSnapshot(target.db)).toEqual(before);
});

test("public Group outbox counts and pages root activity objects only", async () => {
  const target = await prepareOutboxTarget("group");
  const ids = await seedEnvelopeCases({
    db: target.db,
    outboxActorApId: target.actorApId,
    authorApId: target.authorApId,
    groupOutbox: target.groupOutbox,
  });
  const before = await ledgerSnapshot(target.db);
  await expectOutboxParity(target.db, target.path, ids);
  expect(await ledgerSnapshot(target.db)).toEqual(before);
});

test("personal outbox excludes invalid-only activity history from count and pages", async () => {
  const target = await prepareOutboxTarget("personal");
  await seedInvalidEnvelopeCases({
    db: target.db,
    outboxActorApId: target.actorApId,
    authorApId: target.authorApId,
    groupOutbox: target.groupOutbox,
  });
  const before = await ledgerSnapshot(target.db);
  await expectEmptyOutbox(target.db, target.path);
  expect(await ledgerSnapshot(target.db)).toEqual(before);
});

test("instance outbox excludes invalid-only activity history from count and pages", async () => {
  const target = await prepareOutboxTarget("instance");
  await seedInvalidEnvelopeCases({
    db: target.db,
    outboxActorApId: target.actorApId,
    authorApId: target.authorApId,
    groupOutbox: target.groupOutbox,
  });
  const before = await ledgerSnapshot(target.db);
  await expectEmptyOutbox(target.db, target.path);
  expect(await ledgerSnapshot(target.db)).toEqual(before);
});

test("public Group outbox excludes invalid-only activity history from count and pages", async () => {
  const target = await prepareOutboxTarget("group");
  await seedInvalidEnvelopeCases({
    db: target.db,
    outboxActorApId: target.actorApId,
    authorApId: target.authorApId,
    groupOutbox: target.groupOutbox,
  });
  const before = await ledgerSnapshot(target.db);
  await expectEmptyOutbox(target.db, target.path);
  expect(await ledgerSnapshot(target.db)).toEqual(before);
});
