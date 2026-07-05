import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { Hono } from "hono";

import * as schema from "../../../db/schema.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import type { Database } from "../../../db/index.ts";
import { actors, mobilePushRegistrations } from "../../../db/index.ts";
import mobileRoutes from "../../routes/mobile.ts";

const APP_URL = "https://yuru.test";
const ACTOR_AP_ID = `${APP_URL}/ap/users/alice`;

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  await client.execute("PRAGMA foreign_keys = OFF");
  const root = new URL("../../../../migrations/", import.meta.url);
  const files = (await readdir(root)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    await client.executeMultiple(await readFile(new URL(f, root), "utf8"));
  }
  return drizzle(client, { schema }) as unknown as Database;
}

function fakeActor(): Actor {
  return {
    ap_id: ACTOR_AP_ID,
    type: "Person",
    preferred_username: "alice",
    name: "Alice",
    summary: null,
    icon_url: null,
    header_url: null,
    inbox: `${ACTOR_AP_ID}/inbox`,
    outbox: `${ACTOR_AP_ID}/outbox`,
    followers_url: `${ACTOR_AP_ID}/followers`,
    following_url: `${ACTOR_AP_ID}/following`,
    public_key_pem: "public",
    private_key_pem: "private",
    takos_user_id: "takos:alice",
    follower_count: 0,
    following_count: 0,
    post_count: 0,
    is_private: 0,
    role: "owner",
    created_at: "2026-06-30T00:00:00.000Z",
  };
}

async function seedActor(db: Database, actor: Actor): Promise<void> {
  await db.insert(actors).values({
    apId: actor.ap_id,
    type: actor.type,
    preferredUsername: actor.preferred_username,
    name: actor.name,
    summary: actor.summary,
    iconUrl: actor.icon_url,
    headerUrl: actor.header_url,
    inbox: actor.inbox,
    outbox: actor.outbox,
    followersUrl: actor.followers_url,
    followingUrl: actor.following_url,
    publicKeyPem: actor.public_key_pem,
    privateKeyPem: actor.private_key_pem,
    takosUserId: actor.takos_user_id,
    followerCount: actor.follower_count,
    followingCount: actor.following_count,
    postCount: actor.post_count,
    isPrivate: actor.is_private,
    role: actor.role,
    createdAt: actor.created_at,
  });
}

function appFor(db: Database, actor: Actor | null) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", actor);
    await next();
  });
  app.route("/api/mobile", mobileRoutes);
  return app;
}

test("POST /api/mobile/push-registrations stores a Yurucommu mobile push token without echoing it", async () => {
  const db = await freshDb();
  const actor = fakeActor();
  await seedActor(db, actor);
  const app = appFor(db, actor);

  const response = await app.fetch(
    new Request(`${APP_URL}/api/mobile/push-registrations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product: "yurucommu",
        token: "push-token",
        environment: "development",
        host_url: APP_URL,
      }),
    }),
    { APP_URL } as unknown as Env,
  );

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(JSON.stringify(body)).not.toContain("push-token");
  expect(body).toMatchObject({
    registration: {
      product: "yurucommu",
      environment: "development",
      host_url: APP_URL,
    },
  });

  const rows = await db
    .select({
      actorApId: mobilePushRegistrations.actorApId,
      product: mobilePushRegistrations.product,
      token: mobilePushRegistrations.token,
    })
    .from(mobilePushRegistrations);
  expect(rows).toEqual([
    {
      actorApId: ACTOR_AP_ID,
      product: "yurucommu",
      token: "push-token",
    },
  ]);
});

test("POST /api/mobile/push-registrations stores Yurumeet separately on the same server", async () => {
  const db = await freshDb();
  const actor = fakeActor();
  await seedActor(db, actor);
  const app = appFor(db, actor);

  for (const product of ["yurucommu", "yurume"]) {
    const response = await app.fetch(
      new Request(`${APP_URL}/api/mobile/push-registrations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product,
          token: "shared-device-token",
          environment: "production",
          host_url: APP_URL,
        }),
      }),
      { APP_URL } as unknown as Env,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      registration: {
        product,
        environment: "production",
        host_url: APP_URL,
      },
    });
  }

  const rows = await db
    .select({
      actorApId: mobilePushRegistrations.actorApId,
      product: mobilePushRegistrations.product,
      token: mobilePushRegistrations.token,
    })
    .from(mobilePushRegistrations)
    .orderBy(mobilePushRegistrations.product);
  expect(rows).toEqual([
    {
      actorApId: ACTOR_AP_ID,
      product: "yurucommu",
      token: "shared-device-token",
    },
    {
      actorApId: ACTOR_AP_ID,
      product: "yurume",
      token: "shared-device-token",
    },
  ]);
});

test("POST /api/mobile/push-registrations rejects unknown clients", async () => {
  const db = await freshDb();
  const actor = fakeActor();
  await seedActor(db, actor);
  const app = appFor(db, actor);

  const response = await app.fetch(
    new Request(`${APP_URL}/api/mobile/push-registrations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product: "official-chat",
        token: "push-token",
      }),
    }),
    { APP_URL } as unknown as Env,
  );

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    code: "BAD_REQUEST",
    error: "product must be yurucommu or yurume",
    field: "product",
  });
});

test("POST /api/mobile/push-registrations requires a resolved actor", async () => {
  const db = await freshDb();
  const app = appFor(db, null);

  const response = await app.fetch(
    new Request(`${APP_URL}/api/mobile/push-registrations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product: "yurucommu",
        token: "push-token",
      }),
    }),
    { APP_URL } as unknown as Env,
  );

  expect(response.status).toBe(401);
});

test("DELETE /api/mobile/push-registrations removes the matching Yurucommu mobile push token", async () => {
  const db = await freshDb();
  const actor = fakeActor();
  await seedActor(db, actor);
  const app = appFor(db, actor);
  const payload = {
    product: "yurucommu",
    token: "push-token",
    environment: "development",
    host_url: APP_URL,
  };

  const createResponse = await app.fetch(
    new Request(`${APP_URL}/api/mobile/push-registrations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
    { APP_URL } as unknown as Env,
  );
  expect(createResponse.status).toBe(200);

  const deleteResponse = await app.fetch(
    new Request(`${APP_URL}/api/mobile/push-registrations`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
    { APP_URL } as unknown as Env,
  );

  expect(deleteResponse.status).toBe(200);
  expect(await deleteResponse.json()).toEqual({ unregistered: true });
  const rows = await db.select().from(mobilePushRegistrations);
  expect(rows).toHaveLength(0);
});
