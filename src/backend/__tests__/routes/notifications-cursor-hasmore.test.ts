import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import {
  actors,
  activities,
  inbox,
  notificationArchived,
  objects,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import notificationRoutes from "../../routes/notifications.ts";

/**
 * Notification pagination correctness:
 *   #6 — the cursor is a composite of (created_at, activity ap_id), so multiple
 *        notifications sharing a millisecond at a page boundary are NOT skipped
 *        (a bare created_at `lt` cursor would drop the same-ms rows). The server
 *        returns `next_cursor`; following it must page through every row.
 *   #5 — the archive partition and the reply/mention split are applied in SQL,
 *        not as a post-query filter, so `has_more` is honest: a page whose
 *        limit+1 probe would otherwise be eaten by filtered-out rows no longer
 *        under-reports that older pages exist.
 */

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
  next_cursor: string | null;
};

const tako = `${APP_URL}/ap/users/tako`;
const other = `${APP_URL}/ap/users/other`;

async function seedFollow(
  db: Database,
  id: string,
  createdAt: string,
  opts: { archived?: boolean } = {},
) {
  const actId = `${APP_URL}/ap/activities/${id}`;
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
    createdAt,
  });
  if (opts.archived) {
    await db.insert(notificationArchived).values({
      actorApId: tako,
      activityApId: actId,
      archivedAt: createdAt,
    });
  }
  return actId;
}

async function seedCreate(
  db: Database,
  id: string,
  createdAt: string,
  opts: { reply?: boolean } = {},
) {
  const actId = `${APP_URL}/ap/activities/${id}`;
  const objId = `${APP_URL}/ap/objects/${id}`;
  await db.insert(objects).values({
    apId: objId,
    type: "Note",
    attributedTo: other,
    content: `note ${id}`,
    visibility: "public",
    published: createdAt,
    inReplyTo: opts.reply ? `${APP_URL}/ap/objects/parent` : null,
  });
  await db.insert(activities).values({
    apId: actId,
    type: "Create",
    actorApId: other,
    objectApId: objId,
    rawJson: "{}",
    direction: "inbound",
  });
  await db.insert(inbox).values({
    actorApId: tako,
    activityApId: actId,
    read: 0,
    createdAt,
  });
  return actId;
}

async function getPage(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
  env: Env,
  query: string,
): Promise<NotifResponse> {
  const res = await app.fetch(new Request(`${APP_URL}/?${query}`), env);
  expect(res.status).toBe(200);
  return (await res.json()) as NotifResponse;
}

test("#6 composite cursor: same-millisecond notifications are NOT skipped across pages", async () => {
  const db = await freshDb();
  await seedActor(db, tako, "tako");
  await seedActor(db, other, "other");

  // Four Follow notifications ALL sharing one created_at — only the composite
  // (created_at, activity ap_id) cursor can page through them without skipping.
  const ms = "2026-06-21T09:00:00.000Z";
  const ids: string[] = [];
  for (const n of ["a", "b", "c", "d"]) {
    ids.push(await seedFollow(db, `f-${n}`, ms));
  }

  const app = appWith(db, fakeActor(tako, "tako"));
  const env = { APP_URL, DB_INSTANCE: db } as unknown as Env;

  const seen: string[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 10; guard++) {
    const page: NotifResponse = await getPage(
      app,
      env,
      `limit=2${cursor ? `&before=${encodeURIComponent(cursor)}` : ""}`,
    );
    seen.push(...page.notifications.map((n) => n.id));
    if (!page.has_more) break;
    expect(page.next_cursor).toBeTruthy();
    cursor = page.next_cursor;
  }

  expect(seen.length).toBe(4);
  expect(new Set(seen).size).toBe(4); // no duplicates, none skipped
  expect(new Set(seen)).toEqual(new Set(ids));
});

test("#5 archive split in SQL: a non-archived page reports has_more honestly", async () => {
  const db = await freshDb();
  await seedActor(db, tako, "tako");
  await seedActor(db, other, "other");

  // Newest two are ARCHIVED; three older are not. With the old post-query filter,
  // a limit=2 fetch of the 3 newest (2 archived + 1 live) returned a single live
  // row and computed has_more = 1 > 2 = FALSE, hiding the two older live rows.
  await seedFollow(db, "arch-1", "2026-06-21T09:00:05.000Z", {
    archived: true,
  });
  await seedFollow(db, "arch-2", "2026-06-21T09:00:04.000Z", {
    archived: true,
  });
  const live3 = await seedFollow(db, "live-3", "2026-06-21T09:00:03.000Z");
  const live2 = await seedFollow(db, "live-2", "2026-06-21T09:00:02.000Z");
  const live1 = await seedFollow(db, "live-1", "2026-06-21T09:00:01.000Z");

  const app = appWith(db, fakeActor(tako, "tako"));
  const env = { APP_URL, DB_INSTANCE: db } as unknown as Env;

  const page1 = await getPage(app, env, "limit=2");
  expect(page1.notifications.map((n) => n.id)).toEqual([live3, live2]);
  expect(page1.has_more).toBe(true); // would have been FALSE under the old code

  const page2 = await getPage(
    app,
    env,
    `limit=2&before=${encodeURIComponent(page1.next_cursor ?? "")}`,
  );
  expect(page2.notifications.map((n) => n.id)).toEqual([live1]);
  expect(page2.has_more).toBe(false);

  // The archived view is the disjoint complement.
  const archived = await getPage(app, env, "limit=20&archived=true");
  expect(archived.notifications.length).toBe(2);
});

test("#5 reply/mention split in SQL: type=mention page reports has_more honestly", async () => {
  const db = await freshDb();
  await seedActor(db, tako, "tako");
  await seedActor(db, other, "other");

  // Newest two are REPLIES; three older are mentions. Old post-query filter would
  // fetch the 3 newest (2 replies + 1 mention), keep 1 mention, and report
  // has_more = false despite two older mentions remaining.
  await seedCreate(db, "rep-1", "2026-06-21T10:00:05.000Z", { reply: true });
  await seedCreate(db, "rep-2", "2026-06-21T10:00:04.000Z", { reply: true });
  const men3 = await seedCreate(db, "men-3", "2026-06-21T10:00:03.000Z");
  const men2 = await seedCreate(db, "men-2", "2026-06-21T10:00:02.000Z");
  const men1 = await seedCreate(db, "men-1", "2026-06-21T10:00:01.000Z");

  const app = appWith(db, fakeActor(tako, "tako"));
  const env = { APP_URL, DB_INSTANCE: db } as unknown as Env;

  const page1 = await getPage(app, env, "limit=2&type=mention");
  expect(page1.notifications.map((n) => n.id)).toEqual([men3, men2]);
  expect(page1.has_more).toBe(true);

  const page2 = await getPage(
    app,
    env,
    `limit=2&type=mention&before=${encodeURIComponent(page1.next_cursor ?? "")}`,
  );
  expect(page2.notifications.map((n) => n.id)).toEqual([men1]);
  expect(page2.has_more).toBe(false);
});
