import { expect, test } from "bun:test";
import { createTestDb } from "../helpers/d1-semantics.ts";
import type { InArgs, InStatement } from "@libsql/client";
/**
 * GA #20 regression: GET /dm/contacts must enumerate conversations and count
 * pending requests via the indexed `object_recipients` link (not an unindexable
 * `to_json LIKE '%"<apId>"%'` substring scan) AND must be side-effect-free (no
 * DELETE / write on a GET).
 *
 * These run the real DM route handlers against an in-memory libsql database
 * with the production migrations applied, so the assertions reflect the actual
 * SQL behaviour (recipient-membership via object_recipients) rather than mock
 * bookkeeping.
 */

import { Hono } from "hono";

import { sql } from "drizzle-orm";

import type { Database } from "../../../db/index.ts";
import { actorCache, actors, objects } from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import { blockDomain } from "../../lib/blocklist.ts";
import dmRoutes from "../../routes/dm/conversations.ts";

const APP_URL = "https://yuru.test";
async function freshDb(): Promise<Database> {
  return (await createTestDb()).db;
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

/**
 * Insert a direct (DM) Note from `senderApId` to `recipientApId`, mirroring the
 * production DM write path: a direct-visibility Note row plus a `type='to'`
 * `object_recipients` row keyed on the recipient (raw SQL bypasses the FK to
 * actors, matching the production D1 write path).
 */
async function insertDm(
  db: Database,
  senderApId: string,
  recipientApId: string,
  conversationId: string,
  id: string,
  published: string,
): Promise<string> {
  const apId = `${APP_URL}/ap/objects/${id}`;
  await db.insert(objects).values({
    apId,
    type: "Note",
    attributedTo: senderApId,
    content: id,
    toJson: JSON.stringify([recipientApId]),
    visibility: "direct",
    conversation: conversationId,
    published,
    isLocal: 1,
  });
  await db.run(sql`
    INSERT INTO object_recipients (object_ap_id, recipient_ap_id, type, created_at)
    VALUES (${apId}, ${recipientApId}, 'to', ${published})
  `);
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
  return { APP_URL, DB_INSTANCE: db } as unknown as Env;
}

type ContactsResponse = {
  mutual_followers: Array<{
    ap_id?: string;
    conversation_id: string;
    last_message: { content: string; is_mine: boolean } | null;
    unread_count?: number;
  }>;
  communities: Array<{ ap_id: string }>;
  request_count: number;
};

async function getContacts(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
  db: Database,
): Promise<ContactsResponse> {
  const res = await app.fetch(new Request(`${APP_URL}/contacts`), envFor(db));
  expect(res.status).toEqual(200);
  return (await res.json()) as ContactsResponse;
}

async function countRows(db: Database, table: string): Promise<number> {
  const row = (await db.get(sql.raw(`SELECT COUNT(*) AS c FROM ${table}`))) as
    { c: number } | undefined;
  return row?.c ?? 0;
}

async function unreadContactWorkload(threads: number, orphanStatuses: number) {
  const fixture = await createTestDb();
  const { db } = fixture;
  const viewer = await insertLocalActor(db, "viewer");
  const peer = await insertLocalActor(db, "peer");
  await db.run(sql`
    INSERT INTO objects (ap_id, type, attributed_to, content, to_json, visibility, conversation, published)
    WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ${threads})
    SELECT ${APP_URL} || '/ap/objects/unread-' || n, 'Note', ${peer}, 'message-' || n,
      json_array(${viewer}), 'direct', 'thread-' || n, '2024-01-01T00:00:02Z' FROM seq
  `);
  await db.run(sql`
    INSERT INTO object_recipients (object_ap_id, recipient_ap_id, type)
    SELECT ap_id, ${viewer}, 'to' FROM objects
  `);
  await db.run(sql`
    INSERT INTO dm_read_status (actor_ap_id, conversation_id, last_read_at)
    WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ${threads})
    SELECT ${viewer}, 'thread-' || n,
      CASE WHEN n % 2 = 0 THEN '2024-01-01T00:00:03.' ELSE '2024-01-01T00:00:01.' END
        || printf('%06d', n) || 'Z' FROM seq
  `);
  // A join that forgets the viewer predicate must not borrow these baselines.
  await db.run(sql`
    INSERT INTO dm_read_status (actor_ap_id, conversation_id, last_read_at)
    SELECT ${peer}, conversation_id, '2099-01-01T00:00:00Z'
    FROM dm_read_status WHERE actor_ap_id = ${viewer}
  `);
  if (orphanStatuses > 0) {
    await db.run(sql`
      INSERT INTO dm_read_status (actor_ap_id, conversation_id, last_read_at)
      WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ${orphanStatuses})
      SELECT ${viewer}, 'orphan-' || n, '2099-01-01T00:00:00Z' FROM seq
    `);
  }
  expect(await countRows(db, "objects")).toBe(threads);
  expect(await countRows(db, "dm_read_status")).toBe(
    threads * 2 + orphanStatuses,
  );
  return { ...fixture, viewer, peer };
}

async function measuredContacts(
  fixture: Awaited<ReturnType<typeof unreadContactWorkload>>,
) {
  const { db, client, viewer } = fixture;
  const execute = client.execute,
    batch = client.batch;
  const metrics = { statements: 0, rows: 0, readStatusRows: 0, maxParams: 0 };
  const observe = (
    statement: InStatement,
    result: Awaited<ReturnType<typeof execute>>,
    args?: InArgs,
  ) => {
    metrics.statements++;
    metrics.rows += result.rows.length;
    metrics.maxParams = Math.max(
      metrics.maxParams,
      Object.keys((typeof statement === "string" ? args : statement.args) ?? {})
        .length,
    );
    if (
      result.columns.includes("last_read_at") &&
      result.columns.includes("conversation_id")
    ) {
      metrics.readStatusRows += result.rows.length;
    }
  };
  client.execute = async (statement: InStatement, args?: InArgs) => {
    const result =
      typeof statement === "string"
        ? await execute(statement, args)
        : await execute(statement);
    observe(statement, result, args);
    return result;
  };
  client.batch = async (...args: Parameters<typeof batch>) => {
    const results = await batch(...args);
    results.forEach((result, index) => {
      const statement = args[0][index]!;
      if (Array.isArray(statement)) observe(statement[0], result, statement[1]);
      else observe(statement, result);
    });
    return results;
  };
  try {
    const response = await getContacts(
      appWith(db, fakeActor(viewer, "viewer")),
      db,
    );
    return { response, metrics };
  } finally {
    client.execute = execute;
    client.batch = batch;
  }
}

test("101 distinct read baselines keep contact queries and returned metadata bounded", async () => {
  const fixture = await unreadContactWorkload(101, 1000);
  try {
    const { response, metrics } = await measuredContacts(fixture);
    expect(response.mutual_followers).toHaveLength(101);
    expect(
      new Set(response.mutual_followers.map((row) => row.conversation_id)).size,
    ).toBe(101);
    for (const row of response.mutual_followers) {
      const index = Number(row.conversation_id.slice("thread-".length));
      expect(row.unread_count).toBe(index % 2);
    }
    expect(
      response.mutual_followers.reduce(
        (sum, row) => sum + row.unread_count!,
        0,
      ),
    ).toBe(51);
    expect(metrics.statements).toBeLessThanOrEqual(20);
    expect(metrics.readStatusRows).toBeLessThanOrEqual(101);
    expect(metrics.maxParams).toBeLessThanOrEqual(100);
    expect(await countRows(fixture.db, "dm_read_status")).toBe(1202);
  } finally {
    fixture.client.close();
  }
});

test("2000 distinct read baselines stay bounded with 10000 unrelated status rows", async () => {
  const fixture = await unreadContactWorkload(2000, 10000);
  try {
    const { response, metrics } = await measuredContacts(fixture);
    expect(response.mutual_followers).toHaveLength(2000);
    expect(
      new Set(response.mutual_followers.map((row) => row.conversation_id)).size,
    ).toBe(2000);
    for (const row of response.mutual_followers) {
      const index = Number(row.conversation_id.slice("thread-".length));
      expect(row.unread_count).toBe(index % 2);
    }
    expect(
      response.mutual_followers.reduce(
        (sum, row) => sum + row.unread_count!,
        0,
      ),
    ).toBe(1000);
    expect(metrics.statements).toBeLessThanOrEqual(50);
    expect(metrics.readStatusRows).toBeLessThanOrEqual(2000);
    expect(metrics.maxParams).toBeLessThanOrEqual(100);
    expect(await countRows(fixture.db, "dm_read_status")).toBe(14000);
  } finally {
    fixture.client.close();
  }
});

test("legacy collisions do not materialize unread groups outside the selected contact page", async () => {
  const fixture = await unreadContactWorkload(1, 0);
  const { db, viewer } = fixture;
  try {
    // Remove only this fixture's initial note; keep the synthetic identities.
    await db.run(sql`DELETE FROM object_recipients`);
    await db.run(sql`DELETE FROM objects`);
    await db.run(sql`
      INSERT INTO objects (ap_id, type, attributed_to, content, to_json, visibility, conversation, published)
      WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 6000)
      SELECT ${APP_URL} || '/ap/objects/collision-' || n, 'Note', 'https://legacy.test/users/peer-' || n,
        'message-' || n, json_array(${viewer}), 'direct', 'colliding-legacy',
        '2024-01-01T00:00:02.' || printf('%06d', n) || 'Z' FROM seq
    `);
    await db.run(sql`
      INSERT INTO object_recipients (object_ap_id, recipient_ap_id, type)
      SELECT ap_id, ${viewer}, 'to' FROM objects
    `);
    expect(await countRows(db, "objects")).toBe(6000);
    const { response, metrics } = await measuredContacts(fixture);
    expect(response.mutual_followers).toHaveLength(2000);
    const peers = response.mutual_followers.map((row) => row.ap_id!);
    expect(new Set(peers).size).toBe(2000);
    expect(peers).toContain("https://legacy.test/users/peer-6000");
    expect(peers).toContain("https://legacy.test/users/peer-4001");
    expect(peers).not.toContain("https://legacy.test/users/peer-4000");
    for (const row of response.mutual_followers)
      expect(row.unread_count).toBe(1);
    expect(metrics.statements).toBeLessThanOrEqual(100);
    expect(metrics.rows).toBeLessThanOrEqual(4100);
    expect(metrics.maxParams).toBeLessThanOrEqual(100);
  } finally {
    fixture.client.close();
  }
});

test("bounded contact counts preserve observed late arrivals and the legacy empty baseline", async () => {
  const fixture = await unreadContactWorkload(2, 0);
  const { db, viewer, peer } = fixture;
  try {
    await db.run(sql`UPDATE objects SET published = '2024-01-01T00:00:04Z'
      WHERE ap_id = ${`${APP_URL}/ap/objects/unread-2`}`);
    await db.run(sql`UPDATE dm_read_status SET last_read_at = ''
      WHERE actor_ap_id = ${viewer} AND conversation_id = 'thread-1'`);
    const app = appWith(db, fakeActor(viewer, "viewer"));
    const path = `${APP_URL}/user/${encodeURIComponent(peer)}/read-observed`;
    const initialized = await app.fetch(
      new Request(path + "/init", { method: "POST" }),
      envFor(db),
    );
    expect(initialized.status).toBe(200);
    const acknowledged = await app.fetch(
      new Request(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message_ids: [`${APP_URL}/ap/objects/unread-2`],
        }),
      }),
      envFor(db),
    );
    expect(acknowledged.status).toBe(200);
    await insertDm(
      db,
      peer,
      viewer,
      "thread-1",
      "pre-epoch",
      "1969-01-01T00:00:00Z",
    );
    await insertDm(
      db,
      peer,
      viewer,
      "thread-2",
      "late-a",
      "2024-01-01T00:00:00Z",
    );
    await insertDm(
      db,
      peer,
      viewer,
      "thread-2",
      "late-b",
      "2024-01-01T00:00:00Z",
    );
    const { response, metrics } = await measuredContacts(fixture);
    expect(
      Object.fromEntries(
        response.mutual_followers.map((row) => [
          row.conversation_id,
          row.unread_count,
        ]),
      ),
    ).toEqual({
      "thread-1": 1,
      "thread-2": 2,
    });
    expect(metrics.statements).toBeLessThanOrEqual(20);
    expect(metrics.maxParams).toBeLessThanOrEqual(100);
    expect(await countRows(db, "dm_read_status")).toBe(4);
  } finally {
    fixture.client.close();
  }
});

test("contacts lists conversations found via the object_recipients index (recipient + author)", async () => {
  const db = await freshDb();
  const viewer = await insertLocalActor(db, "viewer");
  const alice = await insertLocalActor(db, "alice");
  const bob = await insertLocalActor(db, "bob");

  // Conversation A: alice -> viewer (viewer is recipient, found via index).
  const convA = "conv-a";
  await insertDm(db, alice, viewer, convA, "a1", "2024-01-01T00:00:01Z");

  // Conversation B: viewer -> bob (viewer is author, found via attributed_to).
  const convB = "conv-b";
  await insertDm(db, viewer, bob, convB, "b1", "2024-01-01T00:00:02Z");

  // Unrelated DM between alice and bob: must NOT appear for viewer.
  const convC = "conv-c";
  await insertDm(db, alice, bob, convC, "c1", "2024-01-01T00:00:03Z");

  const app = appWith(db, fakeActor(viewer, "viewer"));
  const data = await getContacts(app, db);

  const convIds = data.mutual_followers.map((m) => m.conversation_id).sort();
  expect(convIds).toEqual([convA, convB].sort());
  expect(data.mutual_followers.some((m) => m.conversation_id === convC)).toBe(
    false,
  );
});

test("request_count counts incoming conversations the viewer has not replied to", async () => {
  const db = await freshDb();
  const viewer = await insertLocalActor(db, "viewer");
  const alice = await insertLocalActor(db, "alice");
  const bob = await insertLocalActor(db, "bob");

  // alice -> viewer, no reply from viewer => pending request.
  await insertDm(db, alice, viewer, "conv-a", "a1", "2024-01-01T00:00:01Z");

  // bob -> viewer, then viewer replies => NOT a pending request.
  await insertDm(db, bob, viewer, "conv-b", "b1", "2024-01-01T00:00:02Z");
  await insertDm(db, viewer, bob, "conv-b", "b2", "2024-01-01T00:00:03Z");

  const app = appWith(db, fakeActor(viewer, "viewer"));
  const data = await getContacts(app, db);

  expect(data.request_count).toEqual(1);
});

test("one incoming request does not materialize unrelated outgoing peer pairs", async () => {
  const { db, client } = await createTestDb();
  const execute = client.execute;
  try {
    const viewer = await insertLocalActor(db, "viewer");
    const pending = await insertLocalActor(db, "pending");
    await insertDm(
      db,
      pending,
      viewer,
      "pending-thread",
      "incoming",
      "2024-01-01T00:00:01Z",
    );
    await db.run(sql`INSERT INTO objects (ap_id, attributed_to, type, visibility, conversation, to_json, published)
      WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 128)
      SELECT 'https://yuru.test/ap/objects/out-' || n, ${viewer}, 'Note', 'direct', 'out-' || n,
        json_array('https://unrelated.test/users/' || n), '2024-01-01T00:00:00Z' FROM seq`);
    await db.run(sql`INSERT INTO object_recipients (object_ap_id, recipient_ap_id, type)
      SELECT ap_id, json_extract(to_json, '$[0]'), 'to' FROM objects WHERE instr(ap_id, 'https://yuru.test/ap/objects/out-') = 1`);
    let unrelatedPairsReturned = 0;
    client.execute = async (statement: InStatement, args?: InArgs) => {
      const result =
        typeof statement === "string"
          ? await execute(statement, args)
          : await execute(statement);
      // Observe actual driver rows unchanged. Contact rows are legitimate UI
      // data; an outgoing pair list for request counting is not needed here.
      if (
        result.columns.includes("conversation") &&
        result.columns.includes("recipient_ap_id")
      ) {
        unrelatedPairsReturned += result.rows.filter((row) =>
          String(row.conversation).startsWith("out-"),
        ).length;
      }
      return result;
    };
    const response = await getContacts(
      appWith(db, fakeActor(viewer, "viewer")),
      db,
    );
    expect(response.request_count).toBe(1);
    expect(unrelatedPairsReturned).toBe(0);
  } finally {
    client.execute = execute;
    client.close();
  }
});

test("unread_count reflects messages from others after the read baseline", async () => {
  const db = await freshDb();
  const viewer = await insertLocalActor(db, "viewer");
  const alice = await insertLocalActor(db, "alice");

  await insertDm(db, alice, viewer, "conv-a", "a1", "2024-01-01T00:00:01Z");
  await insertDm(db, alice, viewer, "conv-a", "a2", "2024-01-01T00:00:02Z");

  const app = appWith(db, fakeActor(viewer, "viewer"));
  const data = await getContacts(app, db);

  const conv = data.mutual_followers.find(
    (m) => m.conversation_id === "conv-a",
  );
  expect(conv).toBeDefined();
  expect(conv?.unread_count).toEqual(2);
});

test("contacts cap bounds CONVERSATIONS, not message rows (busy thread can't evict an older conversation)", async () => {
  const db = await freshDb();
  const viewer = await insertLocalActor(db, "viewer");
  const alice = await insertLocalActor(db, "alice");
  const bob = await insertLocalActor(db, "bob");

  // One OLD conversation: alice -> viewer, a single January message.
  await insertDm(
    db,
    alice,
    viewer,
    "conv-stale",
    "stale-1",
    "2024-01-01T00:00:00Z",
  );

  // One VERY busy conversation: viewer -> bob, 2000 February messages (all
  // newer than conv-stale). Authored by the viewer so dmWhere matches via
  // attributed_to without needing object_recipients rows. Generated in a single
  // recursive-CTE insert so the test stays fast.
  await db.run(sql`
    INSERT INTO objects
      (ap_id, type, attributed_to, content, to_json, visibility, conversation, published, is_local)
    WITH RECURSIVE seq(n) AS (
      SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 2000
    )
    SELECT
      ${APP_URL} || '/ap/objects/busy-' || n,
      'Note',
      ${viewer},
      'busy-' || n,
      json_array(${bob}),
      'direct',
      'conv-busy',
      '2024-02-01T00:00:00.' || printf('%04d', n) || 'Z',
      1
    FROM seq
  `);

  const app = appWith(db, fakeActor(viewer, "viewer"));
  const data = await getContacts(app, db);

  const convIds = data.mutual_followers.map((m) => m.conversation_id);
  // Pre-fix, the 2000 busy message rows filled the row-capped window and
  // dropped conv-stale entirely. Post-fix (one row per conversation), both
  // appear and the busy thread shows only its latest message.
  expect(convIds).toContain("conv-stale");
  expect(convIds).toContain("conv-busy");
  const busy = data.mutual_followers.find(
    (m) => m.conversation_id === "conv-busy",
  );
  expect(busy?.last_message?.content).toEqual("busy-2000");
});

test("GET /contacts performs no writes (side-effect-free)", async () => {
  const db = await freshDb();
  const viewer = await insertLocalActor(db, "viewer");
  const alice = await insertLocalActor(db, "alice");

  await insertDm(db, alice, viewer, "conv-a", "a1", "2024-01-01T00:00:01Z");

  // Seed an ORPHANED dm_read_status row (a conversation that has no objects).
  // The old GET handler DELETEd such rows on read; a side-effect-free GET must
  // leave it in place.
  await db.run(sql`
    INSERT INTO dm_read_status (actor_ap_id, conversation_id, last_read_at)
    VALUES (${viewer}, 'orphan-conv', '2024-01-01T00:00:00Z')
  `);

  const before = await countRows(db, "dm_read_status");

  const app = appWith(db, fakeActor(viewer, "viewer"));
  const res = await app.fetch(new Request(`${APP_URL}/contacts`), envFor(db));
  expect(res.status).toEqual(200);

  const after = await countRows(db, "dm_read_status");
  expect(after).toEqual(before);

  // The orphaned read-status row specifically must survive.
  const orphan = (await db.get(
    sql`SELECT conversation_id FROM dm_read_status WHERE conversation_id = 'orphan-conv'`,
  )) as { conversation_id: string } | undefined;
  expect(orphan?.conversation_id).toEqual("orphan-conv");
});

test("DM presentation suppresses retained operator-blocked remote identities", async () => {
  const db = await freshDb();
  const viewer = await insertLocalActor(db, "viewer");
  const allowed = await insertLocalActor(db, "allowed");
  const blocked = "https://node.defederated.example/users/spammer";
  await db.insert(actorCache).values({
    apId: blocked,
    preferredUsername: "spammer",
    name: "Blocked Remote",
    inbox: `${blocked}/inbox`,
    rawJson: JSON.stringify({ id: blocked, type: "Person" }),
  });

  await insertDm(
    db,
    blocked,
    viewer,
    "conv-blocked-in",
    "blocked-in",
    "2024-01-01T00:00:03Z",
  );
  await insertDm(
    db,
    viewer,
    blocked,
    "conv-blocked-out",
    "blocked-out",
    "2024-01-01T00:00:02Z",
  );
  await insertDm(
    db,
    allowed,
    viewer,
    "conv-allowed",
    "allowed-in",
    "2024-01-01T00:00:01Z",
  );
  await blockDomain(db, "defederated.example", "operator block");

  const app = appWith(db, fakeActor(viewer, "viewer"));
  const contacts = await getContacts(app, db);
  expect(
    contacts.mutual_followers.map((contact) => contact.conversation_id),
  ).toEqual(["conv-allowed"]);
  expect(contacts.request_count).toBe(1);

  await db.run(sql`
    INSERT INTO dm_archived_conversations (actor_ap_id, conversation_id, archived_at)
    VALUES (${viewer}, 'conv-blocked-in', '2024-01-01T00:00:04Z')
  `);
  const archivedRes = await app.fetch(
    new Request(`${APP_URL}/archived`),
    envFor(db),
  );
  expect(archivedRes.status).toBe(200);
  expect(await archivedRes.json()).toEqual({ archived: [] });

  const requestsRes = await app.fetch(
    new Request(`${APP_URL}/requests`),
    envFor(db),
  );
  expect(requestsRes.status).toBe(200);
  expect(
    (
      (await requestsRes.json()) as {
        requests: Array<{ sender: { ap_id: string } }>;
      }
    ).requests.map((request) => request.sender.ap_id),
  ).toEqual([allowed]);

  const unreadRes = await app.fetch(
    new Request(`${APP_URL}/unread/count`),
    envFor(db),
  );
  expect(unreadRes.status).toBe(200);
  expect(await unreadRes.json()).toEqual({ total: 1, dm: 1, community: 0 });

  const contactRes = await app.fetch(
    new Request(`${APP_URL}/contact/${encodeURIComponent(blocked)}`),
    envFor(db),
  );
  expect(contactRes.status).toBe(404);
  expect(await contactRes.json()).toEqual({ error: "Contact not found" });
});
