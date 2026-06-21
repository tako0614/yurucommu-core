import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, activities, inbox } from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import notificationRoutes from "../../routes/notifications.ts";

// The notifications list paginates older history: the endpoint returns the
// newest page + `has_more`, and `before=<oldest shown>.created_at` fetches the
// prior page, so the client can offer a "load older" affordance.

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
  for (const f of MIGRATIONS) {
    await client.executeMultiple(await readFile(new URL(f, root), "utf8"));
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
  app.route("/", notificationRoutes);
  return app;
}

type NotifResponse = {
  notifications: Array<{ id: string; created_at: string }>;
  has_more: boolean;
};

test("notifications paginate: has_more + before fetches the older page", async () => {
  const db = await freshDb();
  const tako = `${APP_URL}/ap/users/tako`;
  const other = `${APP_URL}/ap/users/other`;
  await seedActor(db, tako, "tako");
  await seedActor(db, other, "other");

  // Three inbound Follow notifications for tako (object = an actor, so no
  // objects row / objectApId is null — the list LEFT JOINs objects).
  const stamps = [
    "2026-06-21T09:00:00.000Z",
    "2026-06-21T09:00:01.000Z",
    "2026-06-21T09:00:02.000Z",
  ];
  for (let i = 0; i < stamps.length; i++) {
    const actId = `${APP_URL}/ap/activities/follow-${i}`;
    await db.insert(activities).values({
      apId: actId,
      type: "Follow",
      actorApId: other,
      rawJson: "{}",
      direction: "inbound",
    });
    await db.insert(inbox).values({
      actorApId: tako,
      activityApId: actId,
      read: 0,
      createdAt: stamps[i],
    });
  }

  const app = appWith(db, fakeActor(tako, "tako"));
  const env = { APP_URL, DB_INSTANCE: db } as unknown as Env;

  // Page 1: newest 2 (desc created_at), more older exists.
  const res1 = await app.fetch(new Request(`${APP_URL}/?limit=2`), env);
  expect(res1.status).toBe(200);
  const page1 = (await res1.json()) as NotifResponse;
  expect(page1.has_more).toBe(true);
  expect(page1.notifications.map((n) => n.created_at)).toEqual([
    stamps[2],
    stamps[1],
  ]);

  // Page 2: older than the oldest shown (stamps[1]) -> [stamps[0]], no more.
  const before = page1.notifications[page1.notifications.length - 1].created_at;
  const res2 = await app.fetch(
    new Request(`${APP_URL}/?limit=2&before=${encodeURIComponent(before)}`),
    env,
  );
  expect(res2.status).toBe(200);
  const page2 = (await res2.json()) as NotifResponse;
  expect(page2.has_more).toBe(false);
  expect(page2.notifications.map((n) => n.created_at)).toEqual([stamps[0]]);
});
