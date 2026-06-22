import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, objects } from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import dmRoutes from "../../routes/dm/messages.ts";
import { getConversationId } from "../../routes/dm/query-helpers.ts";

// The DM thread paginates older history: the messages endpoint returns the
// newest page plus `has_more`, and `before=<oldest shown>` fetches the prior
// page — so the client can offer a "load older" affordance.

const APP_URL = "https://yuru.test";

const MIGRATIONS = [
  "0001_init.sql",
  "0002_social_remote_actor_edges.sql",
  "0004_blocklist.sql",
  "0008_actor_fields_aka.sql",
  "0009_object_tags.sql",
];

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  for (const file of MIGRATIONS) {
    await client.executeMultiple(await readFile(new URL(file, root), "utf8"));
  }
  return drizzle(client, { schema }) as unknown as Database;
}

async function seedActor(db: Database, apId: string, username: string) {
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

function fakeActor(apId: string, username: string): Actor {
  return {
    ap_id: apId,
    type: "Person",
    preferred_username: username,
    name: null,
    summary: null,
    icon_url: null,
    header_url: null,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followers_url: `${apId}/followers`,
    following_url: `${apId}/following`,
    public_key_pem: "pub",
    private_key_pem: "priv",
    takos_user_id: null,
    follower_count: 0,
    following_count: 0,
    post_count: 0,
    is_private: 0,
    role: "member",
    created_at: new Date().toISOString(),
  };
}

function appWith(db: Database, actor: Actor) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db as unknown as never);
    c.set("actor", actor);
    await next();
  });
  app.route("/", dmRoutes);
  return app;
}

type MessagesResponse = {
  messages: Array<{ id: string; created_at: string }>;
  has_more: boolean;
};

test("DM messages paginate: has_more + before fetches the older page", async () => {
  const db = await freshDb();
  const alice = `${APP_URL}/ap/users/alice`;
  const bob = `${APP_URL}/ap/users/bob`;
  await seedActor(db, alice, "alice");
  await seedActor(db, bob, "bob");

  const conversation = getConversationId(APP_URL, alice, bob);
  // Three messages, oldest -> newest.
  const stamps = [
    "2026-06-21T10:00:00.000Z",
    "2026-06-21T10:00:01.000Z",
    "2026-06-21T10:00:02.000Z",
  ];
  for (let i = 0; i < stamps.length; i++) {
    await db.insert(objects).values({
      apId: `${APP_URL}/ap/objects/dm-${i}`,
      type: "Note",
      attributedTo: alice,
      content: `msg ${i}`,
      visibility: "direct",
      toJson: JSON.stringify([bob]),
      ccJson: "[]",
      conversation,
      published: stamps[i],
      isLocal: 1,
    });
  }

  const app = appWith(db, fakeActor(alice, "alice"));
  const env = { APP_URL, DB_INSTANCE: db } as unknown as Env;

  // Page 1: newest 2, oldest-first [msg1, msg2], more older exists.
  const res1 = await app.fetch(
    new Request(`${APP_URL}/user/${encodeURIComponent(bob)}/messages?limit=2`),
    env,
  );
  expect(res1.status).toBe(200);
  const page1 = (await res1.json()) as MessagesResponse;
  expect(page1.has_more).toBe(true);
  expect(page1.messages.map((m) => m.created_at)).toEqual([
    stamps[1],
    stamps[2],
  ]);

  // Page 2: messages older than the oldest shown (stamps[1]) -> [msg0], no more.
  const before = page1.messages[0].created_at;
  const res2 = await app.fetch(
    new Request(
      `${APP_URL}/user/${encodeURIComponent(bob)}/messages?limit=2&before=${encodeURIComponent(before)}`,
    ),
    env,
  );
  expect(res2.status).toBe(200);
  const page2 = (await res2.json()) as MessagesResponse;
  expect(page2.has_more).toBe(false);
  expect(page2.messages.map((m) => m.created_at)).toEqual([stamps[0]]);
});

test("DM load-older composite cursor does not skip a same-millisecond message", async () => {
  const db = await freshDb();
  const alice = `${APP_URL}/ap/users/alice`;
  const bob = `${APP_URL}/ap/users/bob`;
  await seedActor(db, alice, "alice");
  await seedActor(db, bob, "bob");

  const conversation = getConversationId(APP_URL, alice, bob);
  // dm-1 and dm-2 share an EXACT published ms; the page boundary (limit 2) falls
  // between them. A bare-published cursor would skip the one that falls onto the
  // next page; the composite (published, apId) cursor must reach all four.
  const stamps = [
    "2026-06-21T10:00:00.000Z", // dm-0 (oldest)
    "2026-06-21T10:00:01.000Z", // dm-1 (tie)
    "2026-06-21T10:00:01.000Z", // dm-2 (tie)
    "2026-06-21T10:00:02.000Z", // dm-3 (newest)
  ];
  const all = new Set<string>();
  for (let i = 0; i < stamps.length; i++) {
    const apId = `${APP_URL}/ap/objects/dm-${i}`;
    all.add(apId);
    await db.insert(objects).values({
      apId,
      type: "Note",
      attributedTo: alice,
      content: `msg ${i}`,
      visibility: "direct",
      toJson: JSON.stringify([bob]),
      ccJson: "[]",
      conversation,
      published: stamps[i],
      isLocal: 1,
    });
  }

  const app = appWith(db, fakeActor(alice, "alice"));
  const env = { APP_URL, DB_INSTANCE: db } as unknown as Env;

  const seen = new Set<string>();
  let before: string | null = null;
  for (let guard = 0; guard < 10; guard++) {
    const qs = before
      ? `?limit=2&before=${encodeURIComponent(before)}`
      : "?limit=2";
    const res = await app.fetch(
      new Request(`${APP_URL}/user/${encodeURIComponent(bob)}/messages${qs}`),
      env,
    );
    expect(res.status).toBe(200);
    const page = (await res.json()) as MessagesResponse;
    for (const m of page.messages) {
      expect(seen.has(m.id)).toBe(false); // no overlap
      seen.add(m.id);
    }
    if (!page.has_more) break;
    // The client builds the composite cursor from the oldest shown message.
    const oldest = page.messages[0];
    before = `${oldest.created_at} ${oldest.id}`;
  }

  expect(seen.size).toEqual(all.size);
  for (const id of all) expect(seen.has(id)).toBe(true);
});
