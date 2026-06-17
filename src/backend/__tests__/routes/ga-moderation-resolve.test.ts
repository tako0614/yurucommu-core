import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * GA #6 / #12 — report resolution closes the moderation queue.
 *
 *  (i)   the owner resolves a persisted report, after which `?status=open`
 *        excludes it (while the unfiltered list still returns it),
 *  (ii)  the owner can reopen a resolved report so it returns to the queue,
 *  (iii) a non-owner (member) is rejected with 403 and cannot mutate the row.
 */

import { Hono } from "hono";

import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { reports } from "../../../db/index.ts";
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

async function seedReport(db: Database, id: string): Promise<void> {
  await db.insert(reports).values({
    id,
    reporterApId: "https://remote.test/ap/users/mod",
    targetApId: `${APP_URL}/ap/users/bob`,
    content: "spam",
    instance: "remote.test",
  });
}

type ReportListBody = {
  reports: Array<{ id: string; resolved_at: string | null }>;
};

test("owner resolves a report and ?status=open then excludes it", async () => {
  const db = await freshDb();
  await seedReport(db, "rep_1");
  const app = appWith(db, fakeActor("owner"));

  // Open queue contains the report before resolution.
  const openBefore = await app.request("/reports?status=open", {}, env);
  expect(openBefore.status).toBe(200);
  const openBeforeBody = (await openBefore.json()) as ReportListBody;
  expect(openBeforeBody.reports.map((r) => r.id)).toContain("rep_1");

  // Resolve it.
  const resolveRes = await app.request(
    "/reports/rep_1/resolve",
    { method: "POST", headers: { "content-type": "application/json" } },
    env,
  );
  expect(resolveRes.status).toBe(200);
  const resolveBody = (await resolveRes.json()) as {
    success: boolean;
    resolved_at: string | null;
  };
  expect(resolveBody.success).toBe(true);
  expect(typeof resolveBody.resolved_at).toBe("string");

  // Open queue now excludes the resolved report.
  const openAfter = await app.request("/reports?status=open", {}, env);
  const openAfterBody = (await openAfter.json()) as ReportListBody;
  expect(openAfterBody.reports.map((r) => r.id)).not.toContain("rep_1");

  // Unfiltered list still returns it, now stamped resolved.
  const allRes = await app.request("/reports", {}, env);
  const allBody = (await allRes.json()) as ReportListBody;
  const row = allBody.reports.find((r) => r.id === "rep_1");
  expect(row).toBeDefined();
  expect(typeof row?.resolved_at).toBe("string");
});

test("owner can reopen a resolved report", async () => {
  const db = await freshDb();
  await seedReport(db, "rep_1");
  const app = appWith(db, fakeActor("owner"));

  await app.request(
    "/reports/rep_1/resolve",
    { method: "POST", headers: { "content-type": "application/json" } },
    env,
  );

  const reopenRes = await app.request(
    "/reports/rep_1/resolve",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reopen: true }),
    },
    env,
  );
  expect(reopenRes.status).toBe(200);
  const reopenBody = (await reopenRes.json()) as { resolved_at: string | null };
  expect(reopenBody.resolved_at).toBeNull();

  // Back on the open queue.
  const openRes = await app.request("/reports?status=open", {}, env);
  const openBody = (await openRes.json()) as ReportListBody;
  expect(openBody.reports.map((r) => r.id)).toContain("rep_1");
});

test("resolving an unknown report is 404", async () => {
  const db = await freshDb();
  const app = appWith(db, fakeActor("owner"));
  const res = await app.request(
    "/reports/nope/resolve",
    { method: "POST", headers: { "content-type": "application/json" } },
    env,
  );
  expect(res.status).toBe(404);
});

test("non-owner member cannot resolve a report (403, no mutation)", async () => {
  const db = await freshDb();
  await seedReport(db, "rep_1");
  const app = appWith(db, fakeActor("member"));

  const res = await app.request(
    "/reports/rep_1/resolve",
    { method: "POST", headers: { "content-type": "application/json" } },
    env,
  );
  expect(res.status).toBe(403);

  // The row must remain unresolved.
  const rows = await db.select().from(reports);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.resolvedAt).toBeNull();
});
