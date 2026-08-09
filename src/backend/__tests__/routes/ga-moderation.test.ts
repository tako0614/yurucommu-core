import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * GA #10 / #22 — operator moderation surface.
 *
 *  (i)   the instance owner can block + unblock a domain,
 *  (ii)  the owner can list a persisted inbound Flag report,
 *  (iii) a non-owner (member) is rejected with 403 from every route.
 */

import { Hono } from "hono";

import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import {
  actors,
  blockedActors,
  blockedDomains,
  objects,
  reports,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import { moderationRoutes } from "../../routes/moderation.ts";

const APP_URL = "https://yuru.test";
const MIGRATIONS = [
  "0001_init.sql",
  "0002_social_remote_actor_edges.sql",
  "0003_activity_remote_object_edges.sql",
  "0004_blocklist.sql",
  "0005_story_community_scope.sql",
  "0006_dm_community_read_status.sql",
  "0007_moderation_reports.sql",
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
  await client.execute("PRAGMA foreign_keys = ON");
  return drizzle(client, { schema }) as unknown as Database;
}

function fakeActor(role: "owner" | "member"): Actor {
  const apId = `${APP_URL}/ap/users/${role}`;
  return {
    ap_id: apId,
    type: "Person",
    preferred_username: role,
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
    role,
    created_at: new Date().toISOString(),
  };
}

function appWith(db: Database, actor: Actor | null): Hono {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", actor);
    await next();
  });
  app.route("/", moderationRoutes);
  return app as unknown as Hono;
}

const env = { APP_URL } as unknown as Env;

test("owner can block, list, and unblock a domain", async () => {
  const db = await freshDb();
  const app = appWith(db, fakeActor("owner"));

  const blockRes = await app.request(
    "/domains",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: "spam.example", reason: "abuse" }),
    },
    env,
  );
  expect(blockRes.status).toBe(200);

  const listRes = await app.request("/domains", {}, env);
  expect(listRes.status).toBe(200);
  const listBody = (await listRes.json()) as {
    domains: Array<{ domain: string; reason: string | null }>;
  };
  expect(listBody.domains).toHaveLength(1);
  expect(listBody.domains[0]?.domain).toBe("spam.example");
  expect(listBody.domains[0]?.reason).toBe("abuse");

  const unblockRes = await app.request(
    "/domains",
    {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: "spam.example" }),
    },
    env,
  );
  expect(unblockRes.status).toBe(200);

  const remaining = await db.select().from(blockedDomains);
  expect(remaining).toHaveLength(0);
});

test("domain block reports incomplete retained-content cleanup and converges on retry", async () => {
  const db = await freshDb();
  const domain = "partial-purge.example";
  const remoteActor = `https://${domain}/users/alice`;
  const remoteObject = `https://${domain}/objects/1`;
  await db.insert(actors).values({
    apId: remoteActor,
    type: "Person",
    preferredUsername: "alice",
    inbox: `${remoteActor}/inbox`,
    outbox: `${remoteActor}/outbox`,
    followersUrl: `${remoteActor}/followers`,
    followingUrl: `${remoteActor}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
  });
  await db.insert(objects).values({
    apId: remoteObject,
    type: "Note",
    attributedTo: remoteActor,
    content: "must be purged",
    visibility: "public",
    isLocal: 0,
  });
  await db.run(
    sql.raw(`
    CREATE TRIGGER reject_domain_purge_object_delete
    BEFORE DELETE ON objects
    WHEN OLD.ap_id = 'https://partial-purge.example/objects/1'
    BEGIN
      SELECT RAISE(ABORT, 'simulated retained-content purge failure');
    END
  `),
  );

  const app = appWith(db, fakeActor("owner"));
  const first = await app.request(
    "/domains",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain, reason: "abuse" }),
    },
    env,
  );

  expect(first.status).toBe(503);
  expect(first.headers.get("Retry-After")).toBe("1");
  expect(await first.json()).toEqual({
    error:
      "Domain block is active, but retained content cleanup did not finish. Retry this block to complete cleanup.",
    block_applied: true,
    cleanup_complete: false,
  });
  expect(
    await db
      .select({ domain: blockedDomains.domain })
      .from(blockedDomains)
      .where(eq(blockedDomains.domain, domain))
      .get(),
  ).toEqual({ domain });
  expect(
    await db
      .select({ apId: objects.apId })
      .from(objects)
      .where(eq(objects.apId, remoteObject))
      .get(),
  ).toEqual({ apId: remoteObject });

  await db.run(sql`DROP TRIGGER reject_domain_purge_object_delete`);
  const retry = await app.request(
    "/domains",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain, reason: "abuse" }),
    },
    env,
  );
  expect(retry.status).toBe(200);
  expect(
    await db
      .select({ apId: objects.apId })
      .from(objects)
      .where(eq(objects.apId, remoteObject))
      .get(),
  ).toBeUndefined();
});

test("actor block reports incomplete retained-content cleanup and converges on retry", async () => {
  const db = await freshDb();
  const remoteActor = "https://actor-purge.example/users/alice";
  const remoteObject = "https://actor-purge.example/objects/1";
  await db.insert(actors).values({
    apId: remoteActor,
    type: "Person",
    preferredUsername: "alice",
    inbox: `${remoteActor}/inbox`,
    outbox: `${remoteActor}/outbox`,
    followersUrl: `${remoteActor}/followers`,
    followingUrl: `${remoteActor}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
  });
  await db.insert(objects).values({
    apId: remoteObject,
    type: "Note",
    attributedTo: remoteActor,
    content: "must be purged",
    visibility: "public",
    isLocal: 0,
  });
  await db.run(
    sql.raw(`
    CREATE TRIGGER reject_actor_purge_object_delete
    BEFORE DELETE ON objects
    WHEN OLD.ap_id = 'https://actor-purge.example/objects/1'
    BEGIN
      SELECT RAISE(ABORT, 'simulated retained-content purge failure');
    END
  `),
  );

  const app = appWith(db, fakeActor("owner"));
  const first = await app.request(
    "/actors",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ap_id: remoteActor, reason: "abuse" }),
    },
    env,
  );

  expect(first.status).toBe(503);
  expect(first.headers.get("Retry-After")).toBe("1");
  expect(await first.json()).toEqual({
    error:
      "Actor block is active, but retained content cleanup did not finish. Retry this block to complete cleanup.",
    block_applied: true,
    cleanup_complete: false,
  });
  expect(
    await db
      .select({ actorApId: blockedActors.actorApId })
      .from(blockedActors)
      .where(eq(blockedActors.actorApId, remoteActor))
      .get(),
  ).toEqual({ actorApId: remoteActor });

  await db.run(sql`DROP TRIGGER reject_actor_purge_object_delete`);
  const retry = await app.request(
    "/actors",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ap_id: remoteActor, reason: "abuse" }),
    },
    env,
  );
  expect(retry.status).toBe(200);
  expect(
    await db
      .select({ apId: objects.apId })
      .from(objects)
      .where(eq(objects.apId, remoteObject))
      .get(),
  ).toBeUndefined();
});

test("owner can list a persisted report", async () => {
  const db = await freshDb();
  await db.insert(reports).values({
    id: "rep_1",
    reporterApId: "https://remote.test/ap/users/mod",
    targetApId: `${APP_URL}/ap/users/bob`,
    content: "spam",
    instance: "remote.test",
  });

  const app = appWith(db, fakeActor("owner"));
  const res = await app.request("/reports", {}, env);
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    reports: Array<{ id: string; content: string | null; instance: string }>;
  };
  expect(body.reports).toHaveLength(1);
  expect(body.reports[0]?.id).toBe("rep_1");
  expect(body.reports[0]?.content).toBe("spam");
  expect(body.reports[0]?.instance).toBe("remote.test");
});

test("non-owner member is rejected with 403", async () => {
  const db = await freshDb();
  const app = appWith(db, fakeActor("member"));

  const listDomains = await app.request("/domains", {}, env);
  expect(listDomains.status).toBe(403);

  const addDomain = await app.request(
    "/domains",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: "x.example" }),
    },
    env,
  );
  expect(addDomain.status).toBe(403);

  const listReports = await app.request("/reports", {}, env);
  expect(listReports.status).toBe(403);

  // The member must not have mutated the blocklist.
  const rows = await db.select().from(blockedDomains);
  expect(rows).toHaveLength(0);
});

test("unauthenticated request is rejected with 401", async () => {
  const db = await freshDb();
  const app = appWith(db, null);
  const res = await app.request("/domains", {}, env);
  expect(res.status).toBe(401);
});
