import { afterEach, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { Hono } from "hono";
import {
  actors,
  follows,
  mediaUploads,
  objects,
  type Database,
} from "../../../db/index.ts";
import * as schema from "../../../db/schema.ts";
import actorsRoute from "../../routes/actors.ts";
import { buildLocalRuntimeEnvPassthrough } from "../../server.ts";
import type { Actor, Env, Variables } from "../../types.ts";

const APP_URL = "https://export.test";
const clients: ReturnType<typeof createClient>[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.close();
});

async function fixture() {
  const client = createClient({ url: ":memory:" });
  clients.push(client);
  for (const name of [
    "0001_init.sql",
    "0002_social_remote_actor_edges.sql",
    "0003_activity_remote_object_edges.sql",
    "0004_blocklist.sql",
    "0005_story_community_scope.sql",
    "0006_dm_community_read_status.sql",
    "0007_moderation_reports.sql",
    "0008_actor_fields_aka.sql",
    "0009_object_tags.sql",
    "0024_delivery_fanout_outbox.sql",
  ]) {
    await client.executeMultiple(
      await readFile(
        new URL(`../../../../migrations/${name}`, import.meta.url),
        "utf8",
      ),
    );
  }
  const queries: string[] = [];
  const db = drizzle(client, {
    schema,
    logger: {
      logQuery(query) {
        queries.push(query);
      },
    },
  }) as unknown as Database;
  async function insertActor(username: string) {
    const apId = `${APP_URL}/ap/users/${username}`;
    await db.insert(actors).values({
      apId,
      preferredUsername: username,
      inbox: `${apId}/inbox`,
      outbox: `${apId}/outbox`,
      followersUrl: `${apId}/followers`,
      followingUrl: `${apId}/following`,
      publicKeyPem: "fixture-public",
      privateKeyPem: "fixture-private",
    });
    return { ap_id: apId, preferred_username: username } as Actor;
  }
  const actor = await insertActor("owner");
  const other = await insertActor("other");
  async function post(id: string, author = actor, content = "hello") {
    await db.insert(objects).values({
      apId: `${APP_URL}/ap/objects/${id}`,
      attributedTo: author.ap_id,
      content,
      visibility: "private",
      published: "2026-11-01T00:00:00.000Z",
    });
  }
  async function request(maxBytes?: string, identity: Actor | null = actor) {
    queries.length = 0;
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use("*", async (c, next) => {
      c.set("db", db);
      c.set("actor", identity);
      await next();
    });
    app.route("/", actorsRoute);
    return app.fetch(new Request(`${APP_URL}/me/export`), {
      APP_URL,
      YURUCOMMU_EXPORT_MAX_BYTES: maxBytes,
    } as unknown as Env);
  }
  return { db, actor, other, post, request, queries };
}

test("small owner export preserves all collections and excludes another actor's data", async () => {
  const f = await fixture();
  await f.post("mine", f.actor, 'こんにちは 👋\n"quote"');
  await f.post("theirs", f.other, "other-private-content");
  await f.db.insert(follows).values({
    followerApId: f.actor.ap_id,
    followingApId: f.other.ap_id,
    status: "accepted",
  });
  await f.db.insert(follows).values({
    followerApId: f.other.ap_id,
    followingApId: f.actor.ap_id,
    status: "accepted",
  });
  await f.db.insert(mediaUploads).values({
    id: "own-media",
    uploaderApId: f.actor.ap_id,
    r2Key: "media/own.png",
    contentType: "image/png",
    size: 4,
  });
  await f.db.insert(mediaUploads).values({
    id: "other-media",
    uploaderApId: f.other.ap_id,
    r2Key: "media/other.png",
    contentType: "image/png",
    size: 4,
  });
  const response = await f.request("4096");
  expect(response.status).toBe(200);
  expect(response.headers.get("content-disposition")).toContain(
    "owner-export.json",
  );
  expect(response.headers.get("content-type")).toContain("application/json");
  const text = await response.text();
  const body = JSON.parse(text);
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(4096);
  expect(body.actor.ap_id).toBe(f.actor.ap_id);
  expect(body.outbox.total_items).toBe(1);
  expect(body.outbox.ordered_items[0].content).toBe('こんにちは 👋\n"quote"');
  expect(body.following.items).toHaveLength(1);
  expect(body.followers.items).toHaveLength(1);
  expect(body.media.items.map((m: { key: string }) => m.key)).toEqual([
    "media/own.png",
  ]);
  expect(body.outbox.truncated).toBe(false);
  expect(text).not.toContain("other-private-content");
  expect(text).not.toContain("media/other.png");
  expect(text).not.toContain("fixture-private");
});

test("configured byte limit rejects an archive explicitly without a download or partial success", async () => {
  const f = await fixture();
  await f.post("one");
  const response = await f.request("512");
  expect(response.status).toBe(413);
  expect(response.headers.get("content-disposition")).toBeNull();
  expect(await response.json()).toEqual({
    error: "Export exceeds the synchronous byte limit",
    code: "EXPORT_TOO_LARGE",
    max_bytes: 512,
  });
});

test("the encoded UTF-8 archive succeeds at the exact limit and fails one byte below", async () => {
  const f = await fixture();
  await f.post("unicode", f.actor, '🌱日本語\n"quoted"');
  const baseline = await f.request();
  expect(baseline.status).toBe(200);
  const bytes = Buffer.byteLength(await baseline.text());
  const exact = await f.request(String(bytes));
  expect(exact.status).toBe(200);
  expect(Buffer.byteLength(await exact.text())).toBe(bytes);
  const below = await f.request(String(bytes - 1));
  expect(below.status).toBe(413);
});

test("a byte failure while reading posts stops later collection reads", async () => {
  const f = await fixture();
  await f.post("one", f.actor, "small first post");
  await f.post("two", f.actor, "small second post");
  const response = await f.request("850");
  expect(response.status).toBe(413);
  expect(f.queries.some((q) => q.includes('from "objects"'))).toBe(true);
  expect(f.queries.some((q) => q.includes('from "follows"'))).toBe(false);
  expect(f.queries.some((q) => q.includes('from "media_uploads"'))).toBe(false);
});

test("small paged reads retain tied-date posts in deterministic order exactly once", async () => {
  const f = await fixture();
  for (let n = 0; n < 26; n++) await f.post(String(n).padStart(2, "0"));
  const response = await f.request("20000");
  expect(response.status).toBe(200);
  const body = await response.json();
  const ids = body.outbox.ordered_items.map((p: { ap_id: string }) => p.ap_id);
  expect(ids).toHaveLength(26);
  expect(new Set(ids).size).toBe(26);
  expect(ids).toEqual([...ids].sort().reverse());
  expect(f.queries.filter((q) => q.includes('from "objects"'))).toHaveLength(2);
  expect(
    f.queries
      .filter((q) => q.includes('from "objects"'))
      .every((q) => !q.includes('"raw_json"')),
  ).toBe(true);
});

for (const invalid of ["", " ", "0", "-1", "1.5", "512x", "8388609"]) {
  test(`invalid configured export limit ${JSON.stringify(invalid)} fails before reading data`, async () => {
    const f = await fixture();
    const response = await f.request(invalid);
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("EXPORT_LIMIT_INVALID");
    expect(f.queries).toHaveLength(0);
  });
}

test("unauthenticated export is refused before configuration or database work", async () => {
  const f = await fixture();
  const response = await f.request("not-a-limit", null);
  expect(response.status).toBe(401);
  expect(f.queries).toHaveLength(0);
});

test("local self-host adapter preserves valid and invalid export limits verbatim", () => {
  expect(
    buildLocalRuntimeEnvPassthrough({ YURUCOMMU_EXPORT_MAX_BYTES: "4096" })
      .YURUCOMMU_EXPORT_MAX_BYTES,
  ).toBe("4096");
  expect(
    buildLocalRuntimeEnvPassthrough({ YURUCOMMU_EXPORT_MAX_BYTES: " " })
      .YURUCOMMU_EXPORT_MAX_BYTES,
  ).toBe(" ");
  expect(
    buildLocalRuntimeEnvPassthrough({}).YURUCOMMU_EXPORT_MAX_BYTES,
  ).toBeUndefined();
});
