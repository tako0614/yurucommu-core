import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { activities, actors, communities, objects } from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import activityPubRoutes from "../../routes/activitypub.ts";
import {
  blockActor,
  blockDomain,
  unblockActor,
  unblockDomain,
} from "../../lib/blocklist.ts";

const APP_URL = "https://yuru.test";
const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";
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

function localApId(username: string): string {
  return `${APP_URL}/ap/users/${username}`;
}

async function insertActor(db: Database, apId: string, username: string) {
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
}

async function insertLocalActor(db: Database, username: string) {
  const apId = localApId(username);
  await insertActor(db, apId, username);
  return apId;
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
): Promise<{ status: number; body: Record<string, unknown>; text: string }> {
  const response = await appWith(db).fetch(
    new Request(`${APP_URL}${path}`),
    envFor(db),
  );
  const text = await response.text();
  return {
    status: response.status,
    body: JSON.parse(text) as Record<string, unknown>,
    text,
  };
}

async function insertNote(
  db: Database,
  input: {
    authorApId: string;
    objectId: string;
    activityId: string;
    content: string;
    createdAt: string;
    visibility?: string;
    audience?: string[];
    communityApId?: string;
  },
) {
  await db.insert(objects).values({
    apId: input.objectId,
    type: "Note",
    attributedTo: input.authorApId,
    content: input.content,
    visibility: input.visibility ?? "public",
    toJson: JSON.stringify([PUBLIC]),
    audienceJson: JSON.stringify(input.audience ?? []),
    communityApId: input.communityApId ?? null,
    published: input.createdAt,
    isLocal: 0,
  });
  await db.insert(activities).values({
    apId: input.activityId,
    type: "Create",
    actorApId: input.authorApId,
    objectApId: input.objectId,
    direction: "outbound",
    rawJson: JSON.stringify({
      "@context": "https://www.w3.org/ns/activitystreams",
      id: input.activityId,
      type: "Create",
      actor: input.authorApId,
      object: {
        id: input.objectId,
        type: "Note",
        content: input.content,
      },
      to: [PUBLIC],
    }),
    createdAt: input.createdAt,
  });
}

async function insertActivity(
  db: Database,
  input: {
    id: string;
    actorApId: string;
    objectApId: string;
    type?: string;
    rawJson: string;
    createdAt: string;
  },
) {
  await db.insert(activities).values({
    apId: input.id,
    type: input.type ?? "Announce",
    actorApId: input.actorApId,
    objectApId: input.objectApId,
    direction: "outbound",
    rawJson: input.rawJson,
    createdAt: input.createdAt,
  });
}

function collectionItems(body: Record<string, unknown>) {
  return (body.orderedItems ?? []) as Array<Record<string, unknown>>;
}

test("personal Create from a cosmetically blocked author is absent from the outbox and count", async () => {
  const db = await freshDb();
  const owner = await insertLocalActor(db, "alice");
  const blockedCreate = `${APP_URL}/ap/activities/blocked-author-create`;
  await insertNote(db, {
    authorApId: owner,
    objectId: `${APP_URL}/ap/objects/blocked-create`,
    activityId: blockedCreate,
    content: "retained blocked Create",
    createdAt: "2026-01-01T00:00:04.000Z",
  });

  await blockActor(
    db,
    `${APP_URL.toUpperCase()}:443/ap/users/alice/`,
    "operator block",
  );
  expect((await fetchJson(db, "/ap/objects/blocked-create")).status).toEqual(
    404,
  );
  const page = await fetchJson(db, "/ap/users/alice/outbox?page=1");
  expect(page.status).toEqual(200);
  expect(collectionItems(page.body).map((item) => item.id)).not.toContain(
    blockedCreate,
  );
  expect(page.text).not.toContain("retained blocked Create");
  const collection = await fetchJson(db, "/ap/users/alice/outbox");
  expect(collection.body.totalItems).toEqual(0);

  await unblockActor(db, owner);
  const restored = await fetchJson(db, "/ap/users/alice/outbox");
  expect(restored.body.totalItems).toEqual(1);
});

test("personal outbox hides an Announce of blocked retained Note before count and paging", async () => {
  const db = await freshDb();
  const owner = await insertLocalActor(db, "alice");
  const blockedAuthor = "https://remote.example/users/blocked";
  const blockedAnnounce = `${APP_URL}/ap/activities/blocked-announce`;
  const allowedNewest = `${APP_URL}/ap/activities/allowed-newest`;
  const allowedOldest = `${APP_URL}/ap/activities/allowed-oldest`;

  await db.insert(objects).values({
    apId: "https://remote.example/notes/retained",
    type: "Note",
    attributedTo: blockedAuthor,
    content: "retained remote authored Note",
    visibility: "public",
    toJson: JSON.stringify([PUBLIC]),
    audienceJson: "[]",
    published: "2026-01-01T00:00:03.000Z",
    isLocal: 0,
  });
  await insertActivity(db, {
    id: blockedAnnounce,
    actorApId: owner,
    objectApId: "https://remote.example/notes/retained",
    rawJson: JSON.stringify({
      id: blockedAnnounce,
      type: "Announce",
      actor: owner,
      object: "https://remote.example/notes/retained",
      to: [PUBLIC],
    }),
    createdAt: "2026-01-01T00:00:03.000Z",
  });
  await insertNote(db, {
    authorApId: owner,
    objectId: `${APP_URL}/ap/objects/allowed-newest`,
    activityId: allowedNewest,
    content: "allowed newest",
    createdAt: "2026-01-01T00:00:02.000Z",
  });
  await insertNote(db, {
    authorApId: owner,
    objectId: `${APP_URL}/ap/objects/allowed-oldest`,
    activityId: allowedOldest,
    content: "allowed oldest",
    createdAt: "2026-01-01T00:00:01.000Z",
  });

  // The Announce target's remote Note author is represented by
  // objects.attributed_to; no actor cache row exists for this author.
  await blockActor(
    db,
    "https://REMOTE.example:443/users/blocked/",
    "operator block",
  );

  const first = await fetchJson(db, "/ap/users/alice/outbox?page=1&limit=1");
  expect(first.status).toEqual(200);
  expect(collectionItems(first.body).map((item) => item.id)).toEqual([
    allowedNewest,
  ]);
  expect(first.body.next).toEqual(expect.any(String));
  expect(first.text).not.toContain("retained remote authored Note");

  const nextPageUrl = new URL(first.body.next as string);
  const secondPath = nextPageUrl.pathname + nextPageUrl.search;
  const second = await fetchJson(db, secondPath);
  expect(collectionItems(second.body).map((item) => item.id)).toEqual([
    allowedOldest,
  ]);
  expect(second.body.next).toBeUndefined();

  const collection = await fetchJson(db, "/ap/users/alice/outbox");
  expect(collection.body.totalItems).toEqual(2);
  await unblockActor(db, blockedAuthor);
  const restoredCollection = await fetchJson(db, "/ap/users/alice/outbox");
  expect(restoredCollection.body.totalItems).toEqual(3);
  const restoredPage = await fetchJson(
    db,
    "/ap/users/alice/outbox?page=1&limit=1",
  );
  expect(collectionItems(restoredPage.body).map((item) => item.id)).toEqual([
    blockedAnnounce,
  ]);
});

test("public Group outbox suppresses an Announce whose retained Note author is domain-blocked", async () => {
  const db = await freshDb();
  const communityApId = `${APP_URL}/ap/groups/public-club`;
  const authorApId = "https://node.defederated.example/users/member";
  const objectId = `${APP_URL}/ap/objects/community-note`;
  const announceId = `${APP_URL}/ap/activities/group-announce`;
  await db.insert(communities).values({
    apId: communityApId,
    preferredUsername: "public-club",
    name: "Public Club",
    inbox: `${communityApId}/inbox`,
    outbox: `${communityApId}/outbox`,
    followersUrl: `${communityApId}/followers`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: localApId("moderator"),
    visibility: "public",
  });
  await db.insert(objects).values({
    apId: objectId,
    type: "Note",
    attributedTo: authorApId,
    content: "retained community Note",
    visibility: "public",
    toJson: JSON.stringify([PUBLIC]),
    audienceJson: "[]",
    communityApId,
    published: "2026-01-01T00:00:01.000Z",
    isLocal: 0,
  });
  await insertActivity(db, {
    id: announceId,
    actorApId: communityApId,
    objectApId: objectId,
    rawJson: JSON.stringify({
      id: announceId,
      type: "Announce",
      actor: communityApId,
      object: objectId,
      to: [PUBLIC],
    }),
    createdAt: "2026-01-01T00:00:02.000Z",
  });

  const canonicalObject = await fetchJson(db, "/ap/objects/community-note");
  expect(canonicalObject.status).toEqual(200);

  await blockDomain(db, "defederated.example", "operator block");
  expect((await fetchJson(db, "/ap/objects/community-note")).status).toEqual(
    404,
  );
  const page = await fetchJson(db, "/ap/groups/public-club/outbox?page=1");
  expect(page.status).toEqual(200);
  expect(collectionItems(page.body).map((item) => item.id)).not.toContain(
    announceId,
  );
  expect(page.text).not.toContain("retained community Note");
  const collection = await fetchJson(db, "/ap/groups/public-club/outbox");
  expect(collection.body.totalItems).toEqual(0);

  await unblockDomain(db, "defederated.example");
  const restored = await fetchJson(db, "/ap/groups/public-club/outbox");
  expect(restored.body.totalItems).toEqual(1);
});

test("remote Announce gate accepts Public only in top-level to/cc addresses", async () => {
  const db = await freshDb();
  const owner = await insertLocalActor(db, "announcer");
  const valid: Array<{
    name: string;
    fields?: Record<string, unknown>;
    raw?: (id: string) => string;
  }> = [
    { name: "to array", fields: { to: [PUBLIC] } },
    { name: "cc array", fields: { cc: [PUBLIC] } },
    { name: "to scalar IRI", fields: { to: PUBLIC } },
    { name: "cc scalar IRI", fields: { cc: PUBLIC } },
    {
      name: "escaped canonical Public string",
      raw: (id) =>
        String.raw`{"id":"${id}","type":"Announce","actor":"${owner}","object":"https://remote.example/n/escaped","to":"https:\/\/www.w3.org\/ns/activitystreams#Public"}`,
    },
  ];
  const invalid: Array<{
    name: string;
    fields?: Record<string, unknown>;
    raw?: (id: string) => string;
  }> = [
    {
      name: "sentinel in content",
      fields: { content: `body mentions ${PUBLIC}` },
    },
    { name: "sentinel in extension", fields: { extension: PUBLIC } },
    { name: "sentinel in JSON key", fields: { [PUBLIC]: "not an address" } },
    { name: "sentinel in object id", fields: { object: PUBLIC } },
    {
      name: "sentinel in nested object addressing",
      fields: { object: { id: "https://remote.example/n/1", to: [PUBLIC] } },
    },
    { name: "Public is not an address", fields: { bto: [PUBLIC] } },
    { name: "addressing field has wrong type", fields: { to: { id: PUBLIC } } },
    { name: "nested array is not an address", fields: { to: [[PUBLIC]] } },
    {
      name: "array object is not an address",
      fields: { cc: [{ id: PUBLIC }] },
    },
    {
      name: "address substring is not Public",
      fields: { to: [`${PUBLIC}/extra`] },
    },
    { name: "null addresses", fields: { to: null, cc: null } },
    { name: "missing addressing", fields: { content: "no audience field" } },
    {
      name: "root is not an activity object",
      raw: () => `"${PUBLIC}"`,
    },
    {
      name: "malformed raw JSON",
      raw: () => `{"type":"Announce","to":["${PUBLIC}"],`,
    },
    {
      name: "duplicate to with Public then private",
      raw: (id) =>
        `{"id":"${id}","to":["${PUBLIC}"],"to":["${owner}/followers"]}`,
    },
    {
      name: "duplicate cc with private then Public",
      raw: (id) => `{"id":"${id}","cc":[],"cc":"${PUBLIC}"}`,
    },
    {
      name: "escaped duplicate key is ambiguous",
      raw: (id) => String.raw`{"id":"${id}","to":["${PUBLIC}"],"\u0074o":[]}`,
    },
  ];

  for (const [index, candidate] of [...valid, ...invalid].entries()) {
    const id = `${APP_URL}/ap/activities/address-${index}`;
    const rawJson =
      candidate.raw?.(id) ??
      JSON.stringify({
        id,
        type: "Announce",
        actor: owner,
        object: `https://remote.example/notes/${index}`,
        ...candidate.fields,
      });
    await insertActivity(db, {
      id,
      actorApId: owner,
      objectApId: `https://remote.example/notes/${index}`,
      rawJson,
      createdAt: `2026-01-01T00:00:${String(index + 1).padStart(2, "0")}.000Z`,
    });
  }

  const page = await fetchJson(
    db,
    "/ap/users/announcer/outbox?page=1&limit=100",
  );
  expect(page.status).toEqual(200);
  const itemIds = collectionItems(page.body).map((item) => item.id);
  expect(itemIds).toHaveLength(valid.length);
  for (let index = 0; index < valid.length; index++) {
    expect(itemIds).toContain(`${APP_URL}/ap/activities/address-${index}`);
  }
  for (
    let index = valid.length;
    index < valid.length + invalid.length;
    index++
  ) {
    expect(itemIds).not.toContain(`${APP_URL}/ap/activities/address-${index}`);
  }

  const collection = await fetchJson(db, "/ap/users/announcer/outbox");
  expect(collection.body.totalItems).toEqual(valid.length);
});

test("invalid retained Story row is excluded by community-Note-only gate hardening", async () => {
  const db = await freshDb();
  const owner = await insertLocalActor(db, "story-owner");
  const objectId = `${APP_URL}/ap/objects/retained-story`;
  const activityId = `${APP_URL}/ap/activities/retained-story`;
  const groupId = `${APP_URL}/ap/groups/story-club`;
  await db.insert(communities).values({
    apId: groupId,
    preferredUsername: "story-club",
    name: "Story Club",
    inbox: `${groupId}/inbox`,
    outbox: `${groupId}/outbox`,
    followersUrl: `${groupId}/followers`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: owner,
    visibility: "public",
  });
  await db.insert(objects).values({
    apId: objectId,
    type: "Story",
    attributedTo: owner,
    content: "invalid retained Story row",
    visibility: "public",
    toJson: JSON.stringify([PUBLIC]),
    audienceJson: "[]",
    published: "2026-01-01T00:00:01.000Z",
    isLocal: 1,
  });
  await insertActivity(db, {
    id: activityId,
    actorApId: groupId,
    objectApId: objectId,
    rawJson: JSON.stringify({
      id: activityId,
      type: "Announce",
      actor: groupId,
    }),
    createdAt: "2026-01-01T00:00:02.000Z",
  });

  const response = await fetchJson(db, "/ap/groups/story-club/outbox?page=1");
  expect(response.status).toEqual(200);
  expect(collectionItems(response.body)).toHaveLength(0);
  const collection = await fetchJson(db, "/ap/groups/story-club/outbox");
  expect(collection.body.totalItems).toEqual(0);
});
