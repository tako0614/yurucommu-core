import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, communities, communityMembers } from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import dmRoutes from "../../routes/dm/messages.ts";
import readArchiveRoutes from "../../routes/dm/read-archive.ts";
import communityMessageRoutes from "../../routes/communities/messages.ts";

// Chat media + local-only read receipts:
// - DM / community chat messages may carry media `attachments` (same shape and
//   bounds as post attachments); an attachment-only message has no text.
// - The DM thread returns the PARTNER's last-read position
//   (`partner_last_read_at`) and the community chat returns per-member
//   `read_states`. Read state is written only by the local read endpoints and
//   is never federated, so a remote participant stays absent/null ("unknown").

const APP_URL = "https://yuru.test";

const MIGRATIONS = [
  "0001_init.sql",
  "0002_social_remote_actor_edges.sql",
  "0004_blocklist.sql",
  "0006_dm_community_read_status.sql",
  "0008_actor_fields_aka.sql",
  "0009_object_tags.sql",
  // 0010 drops the (wrong) object_recipients FK to actors so a community apId
  // is a valid audience recipient — the community chat send relies on it.
  "0010_object_recipients_drop_actor_fk.sql",
  "0019_notification_push_delivery.sql",
];

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  for (const file of MIGRATIONS) {
    await client.executeMultiple(await readFile(new URL(file, root), "utf8"));
  }
  return drizzle(client, { schema }) as unknown as Database;
}

function localApId(username: string): string {
  return `${APP_URL}/ap/users/${username}`;
}

async function seedActor(db: Database, username: string): Promise<string> {
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

function envFor(db: Database): Env {
  return { APP_URL, DB_INSTANCE: db } as unknown as Env;
}

function dmAppFor(db: Database, actor: Actor) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db as unknown as never);
    c.set("actor", actor);
    await next();
  });
  app.route("/", dmRoutes);
  app.route("/", readArchiveRoutes);
  return app;
}

function communityAppFor(db: Database, actor: Actor) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db as unknown as never);
    c.set("actor", actor);
    await next();
  });
  app.route("/", communityMessageRoutes);
  app.route("/dm", readArchiveRoutes);
  return app;
}

const IMAGE_ATTACHMENT = {
  url: "/media/abc123.png",
  r2_key: "uploads/abc123.png",
  content_type: "image/png",
};

type DmMessagesResponse = {
  messages: Array<{
    id: string;
    content: string | null;
    attachments?: Array<Record<string, unknown>>;
  }>;
  has_more: boolean;
  partner_last_read_at: string | null;
};

test("DM send stores attachments and both sides read them back", async () => {
  const db = await freshDb();
  const alice = await seedActor(db, "alice");
  const bob = await seedActor(db, "bob");
  const env = envFor(db);

  const aliceApp = dmAppFor(db, fakeActor(alice, "alice"));
  const sendRes = await aliceApp.fetch(
    new Request(`${APP_URL}/user/${encodeURIComponent(bob)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "photo!",
        attachments: [IMAGE_ATTACHMENT],
      }),
    }),
    env,
  );
  expect(sendRes.status).toBe(201);
  const sent = (await sendRes.json()) as {
    message: { attachments?: Array<Record<string, unknown>> };
  };
  expect(sent.message.attachments).toEqual([IMAGE_ATTACHMENT]);

  // The RECIPIENT's thread returns the attachment.
  const bobApp = dmAppFor(db, fakeActor(bob, "bob"));
  const readRes = await bobApp.fetch(
    new Request(`${APP_URL}/user/${encodeURIComponent(alice)}/messages`),
    env,
  );
  expect(readRes.status).toBe(200);
  const thread = (await readRes.json()) as DmMessagesResponse;
  expect(thread.messages).toHaveLength(1);
  expect(thread.messages[0].attachments).toEqual([IMAGE_ATTACHMENT]);
});

test("attachment-only DM is accepted; an empty message is still rejected", async () => {
  const db = await freshDb();
  const alice = await seedActor(db, "alice");
  const bob = await seedActor(db, "bob");
  const env = envFor(db);
  const aliceApp = dmAppFor(db, fakeActor(alice, "alice"));

  const imageOnly = await aliceApp.fetch(
    new Request(`${APP_URL}/user/${encodeURIComponent(bob)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attachments: [IMAGE_ATTACHMENT] }),
    }),
    env,
  );
  expect(imageOnly.status).toBe(201);
  const sent = (await imageOnly.json()) as { message: { content: string } };
  expect(sent.message.content).toBe("");

  const empty = await aliceApp.fetch(
    new Request(`${APP_URL}/user/${encodeURIComponent(bob)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "   " }),
    }),
    env,
  );
  expect(empty.status).toBe(400);
});

test("DM attachments are bounded: non-records and oversized arrays are rejected", async () => {
  const db = await freshDb();
  const alice = await seedActor(db, "alice");
  const bob = await seedActor(db, "bob");
  const env = envFor(db);
  const aliceApp = dmAppFor(db, fakeActor(alice, "alice"));
  const post = (body: unknown) =>
    aliceApp.fetch(
      new Request(`${APP_URL}/user/${encodeURIComponent(bob)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      env,
    );

  expect((await post({ content: "x", attachments: "nope" })).status).toBe(400);
  expect((await post({ content: "x", attachments: [1] })).status).toBe(400);
  expect(
    (
      await post({
        content: "x",
        attachments: Array.from({ length: 9 }, () => IMAGE_ATTACHMENT),
      })
    ).status,
  ).toBe(400);
});

test("partner_last_read_at surfaces the partner's local read position (null until read)", async () => {
  const db = await freshDb();
  const alice = await seedActor(db, "alice");
  const bob = await seedActor(db, "bob");
  const env = envFor(db);
  const aliceApp = dmAppFor(db, fakeActor(alice, "alice"));
  const bobApp = dmAppFor(db, fakeActor(bob, "bob"));

  await aliceApp.fetch(
    new Request(`${APP_URL}/user/${encodeURIComponent(bob)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hello" }),
    }),
    env,
  );

  // Bob has not opened the thread: no receipt.
  const before = (await (
    await aliceApp.fetch(
      new Request(`${APP_URL}/user/${encodeURIComponent(bob)}/messages`),
      env,
    )
  ).json()) as DmMessagesResponse;
  expect(before.partner_last_read_at).toBeNull();

  // Bob marks the conversation read.
  const readRes = await bobApp.fetch(
    new Request(`${APP_URL}/user/${encodeURIComponent(alice)}/read`, {
      method: "POST",
    }),
    env,
  );
  expect(readRes.status).toBe(200);
  const marked = (await readRes.json()) as { last_read_at: string };

  // Alice's thread now carries Bob's read position; Bob's own thread still has
  // no receipt from Alice (read state is per-participant).
  const after = (await (
    await aliceApp.fetch(
      new Request(`${APP_URL}/user/${encodeURIComponent(bob)}/messages`),
      env,
    )
  ).json()) as DmMessagesResponse;
  expect(after.partner_last_read_at).toBe(marked.last_read_at);

  const bobView = (await (
    await bobApp.fetch(
      new Request(`${APP_URL}/user/${encodeURIComponent(alice)}/messages`),
      env,
    )
  ).json()) as DmMessagesResponse;
  expect(bobView.partner_last_read_at).toBeNull();
});

test("community chat stores attachments and returns member read_states", async () => {
  const db = await freshDb();
  const alice = await seedActor(db, "alice");
  const bob = await seedActor(db, "bob");
  const env = envFor(db);

  const communityApId = `${APP_URL}/ap/groups/town`;
  await db.insert(communities).values({
    apId: communityApId,
    preferredUsername: "town",
    name: "town",
    inbox: `${communityApId}/inbox`,
    outbox: `${communityApId}/outbox`,
    followersUrl: `${communityApId}/followers`,
    visibility: "public",
    postPolicy: "members",
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: alice,
  });
  await db.insert(communityMembers).values([
    { communityApId, actorApId: alice, role: "owner" },
    { communityApId, actorApId: bob, role: "member" },
  ]);

  const aliceApp = communityAppFor(db, fakeActor(alice, "alice"));
  const bobApp = communityAppFor(db, fakeActor(bob, "bob"));

  const sendRes = await aliceApp.fetch(
    new Request(`${APP_URL}/town/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attachments: [IMAGE_ATTACHMENT] }),
    }),
    env,
  );
  expect(sendRes.status).toBe(201);

  // Bob marks the group chat read.
  const readRes = await bobApp.fetch(
    new Request(
      `${APP_URL}/dm/community/${encodeURIComponent(communityApId)}/read`,
      { method: "POST" },
    ),
    env,
  );
  expect(readRes.status).toBe(200);
  const marked = (await readRes.json()) as { last_read_at: string };

  const listRes = await aliceApp.fetch(
    new Request(`${APP_URL}/town/messages`),
    env,
  );
  expect(listRes.status).toBe(200);
  const list = (await listRes.json()) as {
    messages: Array<{
      content: string | null;
      attachments?: Array<Record<string, unknown>>;
    }>;
    read_states: Array<{ actor_ap_id: string; last_read_at: string }>;
  };
  expect(list.messages).toHaveLength(1);
  expect(list.messages[0].attachments).toEqual([IMAGE_ATTACHMENT]);
  expect(list.read_states).toEqual([
    { actor_ap_id: bob, last_read_at: marked.last_read_at },
  ]);
});
