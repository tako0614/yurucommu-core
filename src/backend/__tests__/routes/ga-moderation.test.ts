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

import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { blockedDomains, reports } from "../../../db/index.ts";
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
