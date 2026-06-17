import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
/**
 * Regression test for #27 (DM Mention tag): a DM sent to a remote recipient
 * must include a `tag: [{ type: 'Mention', href, name: '@user@domain' }]` on
 * both the Create activity and the embedded Note so Mastodon-class servers
 * surface the DM as a notification. The recipient stays addressed in `to`.
 *
 * Exercises the real route handler against an in-memory libsql database with
 * production migrations applied, then inspects the stored outbound activity.
 */

import { Hono } from "hono";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actorCache, activities, actors } from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import dmRoutes from "../../routes/dm/messages.ts";

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
    const sql = await readFile(new URL(file, root), "utf8");
    await client.executeMultiple(sql);
  }
  return drizzle(client, { schema }) as unknown as Database;
}

function localApId(username: string): string {
  return `${APP_URL}/ap/users/${username}`;
}

async function insertLocalActor(
  db: Database,
  username: string,
): Promise<string> {
  const apId = localApId(username);
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

async function insertCachedRemoteActor(
  db: Database,
  apId: string,
  preferredUsername: string | null,
): Promise<void> {
  await db.insert(actorCache).values({
    apId,
    type: "Person",
    preferredUsername,
    inbox: `${apId}/inbox`,
    rawJson: JSON.stringify({ id: apId, type: "Person" }),
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

function appWith(
  db: Database,
  actor: Actor | null,
): Hono<{ Bindings: Env; Variables: Variables }> {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", actor);
    await next();
  });
  app.route("/", dmRoutes);
  return app;
}

function envFor(db: Database): Env {
  // No DELIVERY_QUEUE binding: enqueueDeliveryToActor degrades gracefully.
  return { APP_URL, DB_INSTANCE: db } as unknown as Env;
}

async function sendDmTo(
  db: Database,
  senderApId: string,
  recipientApId: string,
): Promise<Response> {
  const app = appWith(db, fakeActor(senderApId, "sender"));
  return app.fetch(
    new Request(
      `${APP_URL}/user/${encodeURIComponent(recipientApId)}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "hi there" }),
      },
    ),
    envFor(db),
  );
}

async function outboundCreate(db: Database): Promise<{
  to: string[];
  tag: Array<{ type: string; href: string; name: string }>;
  object: {
    to: string[];
    tag: Array<{ type: string; href: string; name: string }>;
  };
}> {
  const row = await db
    .select({ rawJson: activities.rawJson })
    .from(activities)
    .where(eq(activities.direction, "outbound"))
    .get();
  expect(row).toBeTruthy();
  return JSON.parse(row!.rawJson);
}

test("remote DM Create carries a Mention tag using preferredUsername@host", async () => {
  const db = await freshDb();
  const senderApId = await insertLocalActor(db, "sender");
  const recipientApId = "https://remote.example/users/bob";
  await insertCachedRemoteActor(db, recipientApId, "bob");

  const res = await sendDmTo(db, senderApId, recipientApId);
  expect(res.status).toEqual(201);

  const create = await outboundCreate(db);

  // Recipient stays addressed in `to` on both Create and Note.
  expect(create.to).toEqual([recipientApId]);
  expect(create.object.to).toEqual([recipientApId]);

  // Mention tag present on both with href = recipient and name = @user@domain.
  const expectedTag = {
    type: "Mention",
    href: recipientApId,
    name: "@bob@remote.example",
  };
  expect(create.tag).toEqual([expectedTag]);
  expect(create.object.tag).toEqual([expectedTag]);
});

test("remote DM Mention falls back to apId-derived handle when no preferredUsername", async () => {
  const db = await freshDb();
  const senderApId = await insertLocalActor(db, "sender");
  const recipientApId = "https://remote.example/users/carol";
  await insertCachedRemoteActor(db, recipientApId, null);

  const res = await sendDmTo(db, senderApId, recipientApId);
  expect(res.status).toEqual(201);

  const create = await outboundCreate(db);
  expect(create.tag).toEqual([
    {
      type: "Mention",
      href: recipientApId,
      name: "@carol@remote.example",
    },
  ]);
});
