import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import type { InArgs, InStatement } from "@libsql/client";
import { desc, eq } from "drizzle-orm";
import {
  ExportInputTooLarge,
  ExportReadBudget,
  readExportPage,
} from "../../routes/actor-export.ts";
import {
  actors,
  objects,
  follows,
  mediaUploads,
  insertMany,
  runBatch,
} from "../../../db/index.ts";
import actorsRoute from "../../routes/actors.ts";
import { admitSessionRequest } from "../../lib/account-deletion-admission.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const APP_URL = "https://export-input.test";
const clients: Awaited<ReturnType<typeof createTestDb>>["client"][] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.close();
});

async function fixture() {
  const { db, client } = await createTestDb();
  clients.push(client);
  const apId = `${APP_URL}/ap/users/owner`;
  await db.insert(actors).values({
    apId,
    preferredUsername: "owner",
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    followingUrl: `${apId}/following`,
    publicKeyPem: "unused-local-fixture",
    privateKeyPem: "unused-local-fixture",
  });
  const actor = { ap_id: apId, preferred_username: "owner" } as Actor;
  const reads: { sql: string; rows: number; contentBytes: number }[] = [];
  const allReads: { sql: string; rows: number; longTextBytes: number }[] = [];
  const execute = client.execute.bind(client);
  client.execute = async (statement: InStatement, args?: InArgs) => {
    const query = typeof statement === "string" ? statement : statement.sql;
    const result = await execute(
      query,
      typeof statement === "string" ? args : statement.args,
    );
    if (query.includes("__export_input_bytes")) {
      allReads.push({
        sql: query,
        rows: result.rows.length,
        longTextBytes: result.rows.reduce(
          (bytes, row) =>
            bytes +
            result.columns.reduce(
              (sum, key) =>
                sum +
                (typeof row[key] === "string" && row[key].length > 1000
                  ? Buffer.byteLength(row[key])
                  : 0),
              0,
            ),
          0,
        ),
      });
    }
    // Observe the actual driver result, without replacing it or its rows.
    if (query.includes('from "objects"') && query.includes("limit")) {
      reads.push({
        sql: query,
        rows: result.rows.length,
        contentBytes: result.rows.reduce(
          (bytes, row) =>
            bytes +
            (typeof row.content === "string"
              ? Buffer.byteLength(row.content)
              : 0),
          0,
        ),
      });
    }
    return result;
  };
  async function request(maxBytes: number) {
    reads.length = 0;
    allReads.length = 0;
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use("*", async (c, next) => {
      c.set("db", db);
      c.set("actor", actor);
      await admitSessionRequest(c, next);
    });
    app.route("/api/actors", actorsRoute);
    return app.fetch(new Request(`${APP_URL}/api/actors/me/export`), {
      APP_URL,
      YURUCOMMU_EXPORT_MAX_BYTES: String(maxBytes),
    } as Env);
  }
  async function post(id: string, content: string) {
    await db.insert(objects).values({
      apId: `${APP_URL}/ap/objects/${id}`,
      attributedTo: apId,
      content,
      visibility: "private",
      published: "2026-11-01T00:00:00.000Z",
    });
  }
  return { db, client, actor, post, request, reads, allReads };
}

test("small owner export preserves the original content through the real driver", async () => {
  const f = await fixture();
  await f.post("small", "hello");
  const response = await f.request(4096);
  expect(response.status).toBe(200);
  expect((await response.json()).outbox.ordered_items[0].content).toBe("hello");
  expect(f.reads).toHaveLength(1);
  expect(f.reads[0].contentBytes).toBe(5);
});

test("an oversized page returns no stored content to the app and fails explicitly", async () => {
  const f = await fixture();
  // Only 64 KiB of harmless local text. No external target or delivery.
  for (let n = 0; n < 8; n++) await f.post(String(n), "x".repeat(8192));
  const response = await f.request(1024);
  expect(f.reads).toHaveLength(1);
  expect(f.reads[0].contentBytes).toBe(0);
  expect(f.reads[0].rows).toBe(1);
  expect(response.status).toBe(413);
  expect(response.headers.get("content-disposition")).toBeNull();
  expect(await response.json()).toEqual({
    error: "Export exceeds the synchronous input byte limit",
    code: "EXPORT_INPUT_TOO_LARGE",
    max_bytes: 1024,
  });
});

test("input bytes count UTF-8 and embedded NUL exactly, without changing values", async () => {
  const f = await fixture();
  const content = "日🌱\u0000";
  await f.post("unicode", content);
  const fields = { content: objects.content };
  const query = f.db
    .select(fields)
    .from(objects)
    .where(eq(objects.attributedTo, f.actor.ap_id))
    .limit(1);
  const bytes = Buffer.byteLength(content);
  const budget = new ExportReadBudget(bytes);
  // Preserve this adapter's actual text result, including its existing NUL
  // handling; the SQL byte measurement still covers the full stored blob.
  const original = await query;
  expect(await readExportPage(f.db, budget, fields, query)).toEqual(original);
  expect(budget.remainingBytes).toBe(0);
  f.reads.length = 0;
  await expect(
    readExportPage(f.db, new ExportReadBudget(bytes - 1), fields, query),
  ).rejects.toBeInstanceOf(ExportInputTooLarge);
  expect(f.reads[0].contentBytes).toBe(0);
});

test("one input allowance is shared across SQL pages, including exact exhaustion", async () => {
  const f = await fixture();
  await f.post("first", "hello");
  await f.post("second", "world");
  const fields = { content: objects.content };
  const read = (offset: number, budget: ExportReadBudget) =>
    readExportPage(
      f.db,
      budget,
      fields,
      f.db
        .select(fields)
        .from(objects)
        .where(eq(objects.attributedTo, f.actor.ap_id))
        .orderBy(desc(objects.apId))
        .limit(1)
        .offset(offset),
    );
  const exact = new ExportReadBudget(10);
  expect(await read(0, exact)).toEqual([{ content: "world" }]);
  expect(await read(1, exact)).toEqual([{ content: "hello" }]);
  expect(exact.remainingBytes).toBe(0);
  expect(await read(2, exact)).toEqual([]);
  const short = new ExportReadBudget(9);
  await read(0, short);
  f.reads.length = 0;
  await expect(read(1, short)).rejects.toBeInstanceOf(ExportInputTooLarge);
  expect(f.reads[0].contentBytes).toBe(0);
  expect(short.remainingBytes).toBe(4);
});

test("profile input is bounded before JSON parsing, even when decoded fields are tiny", async () => {
  const f = await fixture();
  await f.db
    .update(actors)
    .set({ fieldsJson: " ".repeat(8192) + "[]" })
    .where(eq(actors.apId, f.actor.ap_id));
  const response = await f.request(1024);
  expect(response.status).toBe(413);
  expect((await response.json()).code).toBe("EXPORT_INPUT_TOO_LARGE");
  expect(response.headers.get("content-disposition")).toBeNull();
  expect(f.reads).toHaveLength(0);
  expect(f.allReads).toHaveLength(1);
  expect(f.allReads[0].rows).toBe(1);
  expect(f.allReads[0].longTextBytes).toBe(0);
});

for (const collection of ["following", "followers", "media"] as const) {
  test(`${collection} input refuses large stored values before returning their payload`, async () => {
    const f = await fixture();
    if (collection === "media") {
      await f.db.insert(mediaUploads).values({
        id: "local-media",
        uploaderApId: f.actor.ap_id,
        r2Key: "m/" + "x".repeat(8192),
        contentType: "image/png",
        size: 7,
      });
    } else {
      const other = `${APP_URL}/ap/users/remote-fixture`;
      await f.db.insert(follows).values({
        followerApId: collection === "following" ? f.actor.ap_id : other,
        followingApId: collection === "following" ? other : f.actor.ap_id,
        status: "x".repeat(8192),
      });
    }
    const response = await f.request(4096);
    expect(response.status).toBe(413);
    expect((await response.json()).code).toBe("EXPORT_INPUT_TOO_LARGE");
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(f.allReads.every((read) => read.longTextBytes === 0)).toBe(true);
    expect(f.allReads).toHaveLength(
      collection === "following" ? 3 : collection === "followers" ? 4 : 5,
    );
  });
}

test("normal schema-decoded values, numbers and nulls remain unchanged, foreign/deleted posts stay excluded", async () => {
  const f = await fixture();
  await f.db
    .update(actors)
    .set({ isPrivate: 1, summary: null })
    .where(eq(actors.apId, f.actor.ap_id));
  await f.post("mine", "hello");
  await f.post("deleted", "x".repeat(8192));
  await f.db
    .update(objects)
    .set({ deletedAt: "2026-11-01T01:00:00.000Z" })
    .where(eq(objects.apId, `${APP_URL}/ap/objects/deleted`));
  await f.db.insert(objects).values({
    apId: `${APP_URL}/ap/objects/foreign`,
    attributedTo: `${APP_URL}/ap/users/other`,
    content: "y".repeat(8192),
    visibility: "private",
  });
  await f.db.insert(mediaUploads).values({
    id: "local-media",
    uploaderApId: f.actor.ap_id,
    r2Key: "m/local",
    contentType: "image/png",
    size: 7,
  });
  const response = await f.request(4096);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.actor.is_private).toBe(1);
  expect(body.actor.summary).toBeNull();
  expect(
    body.outbox.ordered_items.map((row: { content: string }) => row.content),
  ).toEqual(["hello"]);
  expect(body.media.items[0].size).toBe(7);
  expect(f.reads[0].contentBytes).toBe(5);
});

test("following, followers and media traverse two actual SQL pages without gaps or extra reads", async () => {
  const f = await fixture();
  const peers = Array.from(
    { length: 1251 },
    (_, n) => `${APP_URL}/ap/users/p${String(n).padStart(4, "0")}`,
  );
  const time = "2026-11-01T00:00:00.000Z";
  const followRows = peers.flatMap((peer) => [
    {
      followerApId: f.actor.ap_id,
      followingApId: peer,
      status: "accepted",
      createdAt: time,
    },
    {
      followerApId: peer,
      followingApId: f.actor.ap_id,
      status: "accepted",
      createdAt: time,
    },
  ]);
  const mediaRows = peers.map((_, n) => ({
    id: `m${String(n).padStart(4, "0")}`,
    r2Key: `m/${n}`,
    uploaderApId: f.actor.ap_id,
    contentType: "image/png",
    size: n,
    createdAt: time,
  }));
  // Use existing bounded batch primitives; no oversized VALUES/IN query.
  // Each independently inserted fixture page stays under the existing batch
  // cap. No replace/delete transaction is split or emulated here.
  for (let start = 0; start < followRows.length; start += 200) {
    const statements = insertMany(
      f.db,
      follows,
      followRows.slice(start, start + 200),
    );
    if (statements.length)
      await runBatch(f.db, [statements[0], ...statements.slice(1)]);
  }
  for (let start = 0; start < mediaRows.length; start += 200) {
    const statements = insertMany(
      f.db,
      mediaUploads,
      mediaRows.slice(start, start + 200),
    );
    if (statements.length)
      await runBatch(f.db, [statements[0], ...statements.slice(1)]);
  }
  const response = await f.request(2 * 1024 * 1024);
  expect(response.status).toBe(200);
  const body = await response.json();
  for (const key of ["following", "followers", "media"] as const) {
    expect(body[key].total_items).toBe(1251);
    expect(body[key].truncated).toBe(false);
    expect(body[key].items).toHaveLength(1251);
  }
  expect(body.following.items.map((r: { ap_id: string }) => r.ap_id)).toEqual(
    [...peers].reverse(),
  );
  expect(body.followers.items.map((r: { ap_id: string }) => r.ap_id)).toEqual(
    [...peers].reverse(),
  );
  expect(body.media.items.map((r: { id: string }) => r.id)).toEqual(
    mediaRows.map((r) => r.id).reverse(),
  );
  expect(body.media.items[0].size).toBe(1250);
  expect(f.allReads).toHaveLength(8);
  expect(
    f.allReads.filter((r) => r.sql.includes('from "follows"')),
  ).toHaveLength(4);
  expect(
    f.allReads.filter((r) => r.sql.includes('from "media_uploads"')),
  ).toHaveLength(2);
});

test("a local write just before the page statement cannot slip payload past a prior size check", async () => {
  const f = await fixture();
  await f.post("small", "hello");
  const execute = f.client.execute.bind(f.client);
  let writes = 0;
  f.client.execute = async (statement: InStatement, args?: InArgs) => {
    const query = typeof statement === "string" ? statement : statement.sql;
    if (
      writes === 0 &&
      query.includes('from "objects"') &&
      query.includes("limit")
    ) {
      writes++;
      await execute("update objects set content = ? where attributed_to = ?", [
        "x".repeat(8192),
        f.actor.ap_id,
      ]);
    }
    return execute(
      query,
      typeof statement === "string" ? args : statement.args,
    );
  };
  const response = await f.request(1024);
  expect(writes).toBe(1);
  expect(response.status).toBe(413);
  expect((await response.json()).code).toBe("EXPORT_INPUT_TOO_LARGE");
  expect(f.reads).toHaveLength(1);
  expect(f.reads[0].contentBytes).toBe(0);
  expect(f.allReads).toHaveLength(2);
});
