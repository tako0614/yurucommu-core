import { expect, test } from "bun:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  actors,
  blocks,
  communities,
  communityMembers,
  mutes,
  objects,
} from "../../../db/index.ts";
import type { Database } from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";
import dm from "../../routes/dm/messages.ts";
import read from "../../routes/dm/read-archive.ts";
import group from "../../routes/communities/messages.ts";
import contacts from "../../routes/dm/contacts.ts";
import { yurumeUnreadCounts } from "../../lib/unread-counts.ts";

const origin = "https://yuru.test";
const alice = `${origin}/ap/users/alice`;
const bob = `${origin}/ap/users/bob`;
const carol = `${origin}/ap/users/carol`;
const channel = `${origin}/ap/groups/room`;

for (const relation of ["block", "mute"] as const) {
  for (const retainedAlias of [false, true]) {
    test(`community observed moderation honors ${relation} (${retainedAlias ? "retained alias" : "exact actor"}) at init ACK and legacy read`, async () => {
      const f = await fixture();
      try {
        await f.db.insert(communities).values({
          apId: channel,
          preferredUsername: "room",
          name: "Room",
          visibility: "private",
          postPolicy: "members",
          inbox: `${channel}/inbox`,
          outbox: `${channel}/outbox`,
          followersUrl: `${channel}/followers`,
          publicKeyPem: "synthetic-public",
          privateKeyPem: "synthetic-private",
          createdBy: bob,
        });
        for (const actorApId of [alice, bob, carol])
          await f.db.insert(communityMembers).values({
            communityApId: channel,
            actorApId,
            role: "member",
            joinedAt: "2000-01-01T00:00:00Z",
          });
        async function send(sender: string, content: string, old = false) {
          const response = await f.request(
            sender,
            "/communities/room/messages",
            { content },
          );
          expect(response.status).toBe(201);
          const id = ((await response.json()) as { message: { id: string } })
            .message.id;
          if (old)
            await f.db
              .update(objects)
              .set({ published: "1999-01-01T00:00:00Z" })
              .where(eq(objects.apId, id));
          return id;
        }
        const hiddenOld = await send(bob, "suppressed legacy baseline", true);
        const allowedOld = await send(carol, "allowed legacy baseline", true);
        const hiddenNew = await send(bob, "suppressed after display");
        const allowedNew = await send(carol, "allowed displayed message");
        const groupPath = `/dm/community/${encodeURIComponent(channel)}`;
        const page = async () => {
          const response = await f.request(alice, "/communities/room/messages");
          expect(response.status).toBe(200);
          return (await response.json()) as { messages: { id: string }[] };
        };
        // These opaque IDs came from the actual producer, but policy must be
        // current at the receipt write; an earlier GET is not durable authority.
        expect((await page()).messages.map((m) => m.id).sort()).toEqual(
          [hiddenOld, allowedOld, hiddenNew, allowedNew].sort(),
        );
        const retained = async () => {
          const result: Record<string, unknown> = {};
          for (const table of [
            "objects",
            "object_recipients",
            "communities",
            "community_members",
          ])
            result[table] = (
              await f.client.execute(`SELECT * FROM ${table} ORDER BY rowid`)
            ).rows;
          return result;
        };
        const before = await retained();
        const target = retainedAlias
          ? "https://YURU.test:443/ap/users/bob/#profile"
          : bob;
        if (relation === "block")
          await f.db
            .insert(blocks)
            .values({ blockerApId: alice, blockedApId: target });
        else
          await f.db
            .insert(mutes)
            .values({ muterApId: alice, mutedApId: target });
        expect((await page()).messages.map((m) => m.id).sort()).toEqual(
          [allowedOld, allowedNew].sort(),
        );
        const readIds = async (viewer: string) =>
          (
            await f.client.execute({
              sql: "SELECT object_ap_id FROM talk_message_reads WHERE actor_ap_id=? AND kind='community' AND target_ap_id=? ORDER BY object_ap_id",
              args: [viewer, channel],
            })
          ).rows.map((r) => r.object_ap_id);
        const sidecars = async () => {
          const result: Record<string, unknown> = {};
          for (const table of [
            "talk_message_reads",
            "talk_read_modes",
            "talk_read_assertions",
            "dm_community_read_status",
          ])
            result[table] = (
              await f.client.execute(`SELECT * FROM ${table} ORDER BY rowid`)
            ).rows;
          return result;
        };
        expect(
          (await f.request(alice, `${groupPath}/read-observed/init`, {}))
            .status,
        ).toBe(200);
        expect(await readIds(alice)).toEqual([allowedOld]);
        const initialized = await sidecars();
        expect(
          (
            await f.request(alice, `${groupPath}/read-observed`, {
              message_ids: [allowedNew, hiddenNew],
            })
          ).status,
        ).toBe(409);
        expect(await sidecars()).toEqual(initialized);
        expect(
          (
            await f.request(alice, `${groupPath}/read-observed`, {
              message_ids: [allowedNew],
            })
          ).status,
        ).toBe(200);
        expect(await readIds(alice)).toEqual([allowedOld, allowedNew].sort());
        expect((await f.request(alice, `${groupPath}/read`, {})).status).toBe(
          200,
        );
        expect(await readIds(alice)).toEqual([allowedOld, allowedNew].sort());
        expect(
          (await f.request(carol, `${groupPath}/read-observed/init`, {}))
            .status,
        ).toBe(200);
        expect(
          (
            await f.request(carol, `${groupPath}/read-observed`, {
              message_ids: [hiddenNew],
            })
          ).status,
        ).toBe(200);
        expect(await readIds(carol)).toEqual(
          [allowedOld, hiddenOld, hiddenNew].sort(),
        );
        expect(await retained()).toEqual(before);
        if (relation === "block") await f.db.delete(blocks);
        else await f.db.delete(mutes);
        expect(
          (
            await f.request(alice, `${groupPath}/read-observed`, {
              message_ids: [hiddenOld, hiddenNew],
            })
          ).status,
        ).toBe(200);
        expect(await readIds(alice)).toEqual(
          [hiddenOld, allowedOld, hiddenNew, allowedNew].sort(),
        );
        expect(await retained()).toEqual(before);
      } finally {
        f.client.close();
      }
    });
  }
}

async function fixture() {
  const { db, client } = await createTestDb();
  for (const apId of [alice, bob, carol]) {
    await db.insert(actors).values({
      apId,
      preferredUsername: apId.split("/").at(-1)!,
      inbox: `${apId}/inbox`,
      outbox: `${apId}/outbox`,
      followersUrl: `${apId}/followers`,
      followingUrl: `${apId}/following`,
      publicKeyPem: "synthetic-public",
      privateKeyPem: "synthetic-private",
    });
  }
  const env = { APP_URL: origin, DB_INSTANCE: db } as unknown as Env;
  function app(viewer: string) {
    const router = new Hono<{ Bindings: Env; Variables: Variables }>();
    router.use("*", async (c, next) => {
      c.set("db", db);
      if (viewer)
        c.set("actor", {
          ap_id: viewer,
          preferred_username: viewer.split("/").at(-1),
          name: null,
          icon_url: null,
        } as Actor);
      await next();
    });
    router.route("/dm", dm);
    router.route("/dm", read);
    router.route("/dm", contacts);
    router.route("/communities", group);
    return router;
  }
  const request = (viewer: string, path: string, body?: unknown) =>
    app(viewer).fetch(
      new Request(
        origin + path,
        body === undefined
          ? undefined
          : {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            },
      ),
      env,
    );
  const path = (peer: string, suffix: string) =>
    `/dm/user/${encodeURIComponent(peer)}/${suffix}`;
  async function send(sender: string, peer: string, content: string) {
    const response = await request(sender, path(peer, "messages"), { content });
    expect(response.status).toBe(201);
    return ((await response.json()) as { message: { id: string } }).message.id;
  }
  const requestStream = (
    viewer: string,
    path: string,
    body: ReadableStream<Uint8Array>,
  ) =>
    app(viewer).fetch(
      new Request(origin + path, {
        method: "POST",
        headers: { "content-length": "1" },
        body,
      }),
      env,
    );
  const remove = (viewer: string, path: string) =>
    app(viewer).fetch(new Request(origin + path, { method: "DELETE" }), env);
  return { db, client, request, requestStream, path, send, remove };
}

async function collidingPeers() {
  const f = await fixture();
  const a = await f.send(bob, alice, "Bob incoming");
  const c = await f.send(carol, alice, "Carol incoming");
  const [{ conversation }] = await f.db
    .select({ conversation: objects.conversation })
    .from(objects)
    .where(eq(objects.apId, a));
  await f.db.update(objects).set({ conversation }).where(eq(objects.apId, c));
  return { ...f, a, c, conversation: conversation! };
}

test("requests for colliding historical conversations are counted by peer and a reply accepts only that peer", async () => {
  const f = await collidingPeers();
  try {
    const before = await f.request(alice, "/dm/contacts");
    expect(
      ((await before.json()) as { request_count: number }).request_count,
    ).toBe(2);
    await f.send(alice, bob, "Reply only to Bob");
    const after = await f.request(alice, "/dm/contacts");
    expect(
      ((await after.json()) as { request_count: number }).request_count,
    ).toBe(1);
  } finally {
    f.client.close();
  }
});

test("legacy mark-current read cannot clear another peer sharing the historical conversation ID", async () => {
  const f = await collidingPeers();
  try {
    expect((await f.request(alice, f.path(bob, "read"), {})).status).toBe(200);
    expect((await yurumeUnreadCounts(f.db, alice)).dm).toBe(1);
    const peers = await f.request(alice, "/dm/contacts");
    expect(
      (
        (await peers.json()) as {
          mutual_followers: { ap_id: string; unread_count: number }[];
        }
      ).mutual_followers
        .map((peer) => [peer.ap_id, peer.unread_count])
        .sort(),
    ).toEqual(
      [
        [bob, 0],
        [carol, 1],
      ].sort(),
    );
    await f.send(carol, alice, "Later Carol arrival");
    expect((await f.request(alice, f.path(bob, "read"), {})).status).toBe(200);
    expect((await yurumeUnreadCounts(f.db, alice)).dm).toBe(2);
    expect(
      (await f.client.execute("SELECT * FROM dm_read_status")).rows,
    ).toEqual([]);
  } finally {
    f.client.close();
  }
});

test("legacy read response keeps its timestamp ACK shape after opt-in without exposing a broad partner receipt", async () => {
  const f = await fixture();
  try {
    const id = await f.send(bob, alice, "A");
    expect(
      (await f.request(alice, f.path(bob, "read-observed/init"), {})).status,
    ).toBe(200);
    const response = await f.request(alice, f.path(bob, "read"), {});
    expect(response.status).toBe(200);
    expect(
      typeof ((await response.json()) as { last_read_at: string }).last_read_at,
    ).toBe("string");
    const partner = await f.request(bob, f.path(alice, "messages"));
    const receipt = (await partner.json()) as {
      partner_last_read_at: string | null;
      partner_read_message_ids: string[];
    };
    expect(receipt.partner_last_read_at).toBeNull();
    expect(receipt.partner_read_message_ids).toEqual([id]);
  } finally {
    f.client.close();
  }
});

test("per-peer archive preserves the other legacy peer's contact and unread badge", async () => {
  const f = await collidingPeers();
  try {
    expect(
      (await f.request(alice, f.path(bob, "read-observed/init"), {})).status,
    ).toBe(200);
    expect(
      (
        await f.request(alice, f.path(bob, "read-observed"), {
          message_ids: [f.a],
        })
      ).status,
    ).toBe(200);
    expect((await f.request(alice, f.path(bob, "archive"), {})).status).toBe(
      200,
    );
    const response = await f.request(alice, "/dm/contacts");
    const peers = (
      (await response.json()) as {
        mutual_followers: { ap_id: string; unread_count: number }[];
      }
    ).mutual_followers;
    expect(peers.map((peer) => [peer.ap_id, peer.unread_count])).toEqual([
      [carol, 1],
    ]);
    expect((await yurumeUnreadCounts(f.db, alice)).dm).toBe(1);
    const archived = await f.request(alice, "/dm/archived");
    expect(
      (
        (await archived.json()) as { archived: { ap_id: string }[] }
      ).archived.map((peer) => peer.ap_id),
    ).toEqual([bob]);
    expect((await f.remove(alice, f.path(bob, "archive"))).status).toBe(200);
    const restored = await f.request(alice, "/dm/contacts");
    expect(
      ((await restored.json()) as { mutual_followers: unknown[] })
        .mutual_followers,
    ).toHaveLength(2);
  } finally {
    f.client.close();
  }
});

test("legacy archives remain unchanged on GET and unarchiving one peer preserves the other's historical state", async () => {
  const f = await collidingPeers();
  try {
    await f.client.execute({
      sql: "INSERT INTO dm_archived_conversations (actor_ap_id, conversation_id, archived_at) VALUES (?, ?, '2020-01-01T00:00:00Z')",
      args: [alice, f.conversation],
    });
    const original = (
      await f.client.execute("SELECT * FROM dm_archived_conversations")
    ).rows;
    const before = await f.request(alice, "/dm/contacts");
    expect(
      ((await before.json()) as { mutual_followers: unknown[] })
        .mutual_followers,
    ).toEqual([]);
    await f.request(alice, "/dm/archived");
    expect(
      (await f.client.execute("SELECT * FROM dm_archived_conversations")).rows,
    ).toEqual(original);
    expect((await f.remove(alice, f.path(bob, "archive"))).status).toBe(200);
    const after = await f.request(alice, "/dm/contacts");
    expect(
      (
        (await after.json()) as { mutual_followers: { ap_id: string }[] }
      ).mutual_followers.map((peer) => peer.ap_id),
    ).toEqual([bob]);
    const archived = await f.request(alice, "/dm/archived");
    expect(
      (
        (await archived.json()) as { archived: { ap_id: string }[] }
      ).archived.map((peer) => peer.ap_id),
    ).toEqual([carol]);
    expect((await yurumeUnreadCounts(f.db, alice)).dm).toBe(1);
    expect(
      (await f.client.execute("SELECT * FROM dm_archived_conversations")).rows,
    ).toEqual(original);
    const expanded = (
      await f.client.execute(
        "SELECT conversation_id FROM dm_archive_expansions",
      )
    ).rows;
    expect(expanded.map((row) => row.conversation_id)).toEqual([
      f.conversation,
    ]);
    expect(
      (
        await f.client.execute(
          "SELECT target_ap_id, archived_at FROM dm_peer_archived_conversations",
        )
      ).rows.map((row) => ({
        target_ap_id: row.target_ap_id,
        archived_at: row.archived_at,
      })),
    ).toEqual([{ target_ap_id: carol, archived_at: "2020-01-01T00:00:00Z" }]);
    expect((await f.remove(alice, f.path(bob, "archive"))).status).toBe(200);
    const retried = await f.request(alice, "/dm/contacts");
    expect(
      (
        (await retried.json()) as { mutual_followers: { ap_id: string }[] }
      ).mutual_followers.map((peer) => peer.ap_id),
    ).toEqual([bob]);
  } finally {
    f.client.close();
  }
});

test("failed legacy archive expansion rolls back and reserved readers cannot change peer state", async () => {
  const f = await collidingPeers();
  try {
    await f.client.execute({
      sql: "INSERT INTO dm_archived_conversations (actor_ap_id, conversation_id, archived_at) VALUES (?, ?, '2020-01-01T00:00:00Z')",
      args: [alice, f.conversation],
    });
    const original = (
      await f.client.execute("SELECT * FROM dm_archived_conversations")
    ).rows;
    await f.client.executeMultiple(
      `CREATE TRIGGER reject_peer_seed BEFORE INSERT ON dm_peer_archived_conversations WHEN NEW.target_ap_id = '${carol}' BEGIN SELECT RAISE(ABORT, 'synthetic archive failure'); END;`,
    );
    expect((await f.remove(alice, f.path(bob, "archive"))).status).toBe(500);
    for (const table of [
      "dm_peer_archived_conversations",
      "dm_archive_expansions",
      "talk_read_assertions",
    ])
      expect((await f.client.execute(`SELECT * FROM ${table}`)).rows).toEqual(
        [],
      );
    expect(
      (await f.client.execute("SELECT * FROM dm_archived_conversations")).rows,
    ).toEqual(original);
    await f.client.executeMultiple("DROP TRIGGER reject_peer_seed;");
    expect((await f.remove(alice, f.path(bob, "archive"))).status).toBe(200);
    const peers = (
      await f.client.execute("SELECT * FROM dm_peer_archived_conversations")
    ).rows;
    const expansions = (
      await f.client.execute("SELECT * FROM dm_archive_expansions")
    ).rows;
    await f.client.execute({
      sql: "INSERT INTO account_deletion_targets (actor_ap_id, operation_id, public_key_pem, followers_url, delete_activity_ap_id) VALUES (?, 'archive-reserved', 'pub', 'followers', 'delete')",
      args: [alice],
    });
    expect((await f.request(alice, f.path(bob, "archive"), {})).status).toBe(
      500,
    );
    expect(
      (await f.client.execute("SELECT * FROM dm_peer_archived_conversations"))
        .rows,
    ).toEqual(peers);
    expect(
      (await f.client.execute("SELECT * FROM dm_archive_expansions")).rows,
    ).toEqual(expansions);
    expect(
      (await f.client.execute("SELECT * FROM dm_archived_conversations")).rows,
    ).toEqual(original);
    expect(
      (await f.client.execute("SELECT * FROM talk_read_assertions")).rows,
    ).toEqual([]);
  } finally {
    f.client.close();
  }
});

test("archive sidecars are private to the reader and removed with their parent actor", async () => {
  const f = await collidingPeers();
  try {
    await f.client.execute({
      sql: "INSERT INTO dm_archived_conversations (actor_ap_id, conversation_id, archived_at) VALUES (?, ?, '2020-01-01T00:00:00Z')",
      args: [alice, f.conversation],
    });
    expect((await f.remove(alice, f.path(bob, "archive"))).status).toBe(200);
    const outsider = await f.request(carol, "/dm/archived");
    expect(
      ((await outsider.json()) as { archived: unknown[] }).archived,
    ).toEqual([]);
    await f.db.delete(actors).where(eq(actors.apId, alice));
    expect(
      (await f.client.execute("SELECT * FROM dm_peer_archived_conversations"))
        .rows,
    ).toEqual([]);
    expect(
      (await f.client.execute("SELECT * FROM dm_archive_expansions")).rows,
    ).toEqual([]);
  } finally {
    f.client.close();
  }
});

test("observed ACK excludes an actual message committed between GET and ACK, including equal/backdated publications", async () => {
  const f = await fixture();
  try {
    const first = await f.send(bob, alice, "A");
    expect(
      (await f.request(alice, f.path(bob, "read-observed/init"), {})).status,
    ).toBe(200);
    const page = await f.request(alice, f.path(bob, "messages"));
    const shown = ((await page.json()) as { messages: { id: string }[] })
      .messages;
    expect(shown.map((m) => m.id)).toEqual([first]);
    const second = await f.send(bob, alice, "B after GET");
    const ack = await f.request(alice, f.path(bob, "read-observed"), {
      message_ids: shown.map((m) => m.id),
    });
    expect(ack.status).toBe(200);
    expect(await yurumeUnreadCounts(f.db, alice)).toEqual({
      dm: 1,
      community: 0,
      total: 1,
    });
    const peer = await f.request(bob, f.path(alice, "messages"));
    const receipt = (await peer.json()) as {
      partner_last_read_at: string | null;
      partner_read_message_ids: string[];
    };
    expect(receipt.partner_last_read_at).toBeNull();
    expect(receipt.partner_read_message_ids).toEqual([first]);
    // Imported publication time is not an ingestion watermark. The IDs and
    // initial ACKs above are genuine route results, never manually reseeded.
    const [{ published }] = await f.db
      .select({ published: objects.published })
      .from(objects)
      .where(eq(objects.apId, first));
    await f.db
      .update(objects)
      .set({ published })
      .where(eq(objects.apId, second));
    expect((await yurumeUnreadCounts(f.db, alice)).dm).toBe(1);
    const inbox = await f.request(alice, "/dm/contacts");
    expect(inbox.status).toBe(200);
    const inboxBody = (await inbox.json()) as {
      mutual_followers: { ap_id: string; unread_count: number }[];
    };
    expect(
      inboxBody.mutual_followers.find((entry) => entry.ap_id === bob)
        ?.unread_count,
    ).toBe(1);
    await f.db
      .update(objects)
      .set({ published: "2000-01-01T00:00:00Z" })
      .where(eq(objects.apId, second));
    expect((await yurumeUnreadCounts(f.db, alice)).dm).toBe(1);
    expect(
      (
        await f.request(alice, f.path(bob, "read-observed"), {
          message_ids: [second],
        })
      ).status,
    ).toBe(200);
    expect((await yurumeUnreadCounts(f.db, alice)).dm).toBe(0);
  } finally {
    f.client.close();
  }
});

test("a failed init rolls its seed back, and a failed after-assertion rolls ACK plus mode changes back", async () => {
  const f = await fixture();
  try {
    const first = await f.send(bob, alice, "legacy read");
    expect((await f.request(alice, f.path(bob, "read"), {})).status).toBe(200);
    await f.client.executeMultiple(
      "CREATE TRIGGER reject_init BEFORE INSERT ON talk_read_modes BEGIN SELECT RAISE(ABORT, 'synthetic init failure'); END;",
    );
    expect(
      (await f.request(alice, f.path(bob, "read-observed/init"), {})).status,
    ).toBe(500);
    expect(
      (await f.client.execute("SELECT * FROM talk_message_reads")).rows,
    ).toEqual([]);
    expect(
      (await f.client.execute("SELECT * FROM talk_read_modes")).rows,
    ).toEqual([]);
    expect(
      (await f.client.execute("SELECT * FROM talk_read_assertions")).rows,
    ).toEqual([]);
    await f.client.executeMultiple("DROP TRIGGER reject_init;");
    expect(
      (await f.request(alice, f.path(bob, "read-observed/init"), {})).status,
    ).toBe(200);
    const second = await f.send(bob, alice, "new unread");
    await f.client.executeMultiple(
      "CREATE TRIGGER stale_ack AFTER INSERT ON talk_message_reads BEGIN UPDATE talk_read_modes SET epoch = 'changed'; END;",
    );
    expect(
      (
        await f.request(alice, f.path(bob, "read-observed"), {
          message_ids: [second],
        })
      ).status,
    ).toBe(409);
    const ids = (
      await f.client.execute("SELECT object_ap_id FROM talk_message_reads")
    ).rows.map((row) => row.object_ap_id);
    expect(ids).toEqual([first]);
    expect(
      (await f.client.execute("SELECT epoch FROM talk_read_modes")).rows[0]
        .epoch,
    ).toBe("");
    expect(
      (await f.client.execute("SELECT * FROM talk_read_assertions")).rows,
    ).toEqual([]);
    expect((await yurumeUnreadCounts(f.db, alice)).dm).toBe(1);
  } finally {
    f.client.close();
  }
});

test("legacy conversation-ID collisions cannot grant another peer's observed receipt", async () => {
  const f = await fixture();
  try {
    const a = await f.send(bob, alice, "our pair");
    const c = await f.send(carol, alice, "other pair");
    const [{ conversation }] = await f.db
      .select({ conversation: objects.conversation })
      .from(objects)
      .where(eq(objects.apId, a));
    await f.db.update(objects).set({ conversation }).where(eq(objects.apId, c));
    const visible = await f.request(alice, f.path(bob, "messages"));
    expect(
      ((await visible.json()) as { messages: { id: string }[] }).messages.map(
        (row) => row.id,
      ),
    ).toEqual([a]);
    expect(
      (await f.request(alice, f.path(bob, "read-observed/init"), {})).status,
    ).toBe(200);
    expect(
      (
        await f.request(alice, f.path(bob, "read-observed"), {
          message_ids: [a, c],
        })
      ).status,
    ).toBe(409);
    expect(
      (await f.client.execute("SELECT * FROM talk_message_reads")).rows,
    ).toEqual([]);
    expect(
      (
        await f.request(alice, f.path(bob, "read-observed"), {
          message_ids: [a],
        })
      ).status,
    ).toBe(200);
    const inbox = await f.request(alice, "/dm/contacts");
    const peers = (
      (await inbox.json()) as {
        mutual_followers: { ap_id: string; unread_count: number }[];
      }
    ).mutual_followers;
    expect(peers.map((p) => [p.ap_id, p.unread_count]).sort()).toEqual(
      [
        [bob, 0],
        [carol, 1],
      ].sort(),
    );
    expect((await yurumeUnreadCounts(f.db, alice)).dm).toBe(1);
  } finally {
    f.client.close();
  }
});

test("reserved reader cannot add receipts, while another author's deletion cleans the sidecar", async () => {
  const f = await fixture();
  try {
    const first = await f.send(bob, alice, "read then delete");
    expect(
      (await f.request(alice, f.path(bob, "read-observed/init"), {})).status,
    ).toBe(200);
    expect(
      (
        await f.request(alice, f.path(bob, "read-observed"), {
          message_ids: [first],
        })
      ).status,
    ).toBe(200);
    const second = await f.send(bob, alice, "not read");
    await f.client.execute({
      sql: "INSERT INTO account_deletion_targets (actor_ap_id, operation_id, public_key_pem, followers_url, delete_activity_ap_id) VALUES (?, 'reserved-reader', 'pub', 'followers', 'delete')",
      args: [alice],
    });
    expect(
      (
        await f.request(alice, f.path(bob, "read-observed"), {
          message_ids: [second],
        })
      ).status,
    ).toBe(500);
    expect(
      (
        await f.client.execute("SELECT object_ap_id FROM talk_message_reads")
      ).rows.map((row) => row.object_ap_id),
    ).toEqual([first]);
    await f.db.delete(objects).where(eq(objects.apId, first));
    expect(
      (await f.client.execute("SELECT * FROM talk_message_reads")).rows,
    ).toEqual([]);
  } finally {
    f.client.close();
  }
});

test("init preserves old read state once; retry never seeds a subsequent backdated message", async () => {
  const f = await fixture();
  try {
    const first = await f.send(bob, alice, "old read");
    expect((await f.request(alice, f.path(bob, "read"), {})).status).toBe(200);
    expect(
      (await f.request(alice, f.path(bob, "read-observed/init"), {})).status,
    ).toBe(200);
    const later = await f.send(bob, alice, "new arrival, older publication");
    await f.db
      .update(objects)
      .set({ published: "2000-01-01T00:00:00Z" })
      .where(eq(objects.apId, later));
    expect(
      (await f.request(alice, f.path(bob, "read-observed/init"), {})).status,
    ).toBe(200);
    expect((await yurumeUnreadCounts(f.db, alice)).dm).toBe(1);
    const peer = await f.request(bob, f.path(alice, "messages"));
    expect(
      ((await peer.json()) as { partner_read_message_ids: string[] })
        .partner_read_message_ids,
    ).toEqual([first]);
    // The legacy endpoint keeps its explicit mark-current-conversation
    // semantics; it must not update only a timestamp once exact mode exists.
    expect((await f.request(alice, f.path(bob, "read"), {})).status).toBe(200);
    expect((await yurumeUnreadCounts(f.db, alice)).dm).toBe(0);
  } finally {
    f.client.close();
  }
});

test("mixed unknown/wrong-partner IDs reject atomically, duplicate ACK is idempotent, and input is bounded", async () => {
  const f = await fixture();
  try {
    const a = await f.send(bob, alice, "A");
    const unrelated = await f.send(carol, alice, "other conversation");
    expect(
      (await f.request(alice, f.path(bob, "read-observed/init"), {})).status,
    ).toBe(200);
    const bad = await f.request(alice, f.path(bob, "read-observed"), {
      message_ids: [a, unrelated],
    });
    expect(bad.status).toBe(409);
    expect((await yurumeUnreadCounts(f.db, alice)).dm).toBe(2);
    expect(
      (
        await f.request(alice, f.path(bob, "read-observed"), {
          message_ids: Array.from(
            { length: 51 },
            (_, i) => `https://ids.test/${i}`,
          ),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await f.request(alice, f.path(bob, "read-observed"), {
          message_ids: [a, a],
        })
      ).status,
    ).toBe(400);
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(
        (
          await f.request(alice, f.path(bob, "read-observed"), {
            message_ids: [a],
          })
        ).status,
      ).toBe(200);
      expect((await yurumeUnreadCounts(f.db, alice)).dm).toBe(1);
    }
    expect(
      (
        await f.request(carol, f.path(bob, "read-observed"), {
          message_ids: [a],
        })
      ).status,
    ).toBe(409);
  } finally {
    f.client.close();
  }
});

test("community observed reads require current membership and leave/rejoin does not reuse the previous mode", async () => {
  const f = await fixture();
  try {
    await f.db.insert(communities).values({
      apId: channel,
      preferredUsername: "room",
      name: "Room",
      visibility: "private",
      inbox: `${channel}/inbox`,
      outbox: `${channel}/outbox`,
      followersUrl: `${channel}/followers`,
      publicKeyPem: "synthetic-public",
      privateKeyPem: "synthetic-private",
      createdBy: bob,
    });
    for (const actorApId of [alice, bob])
      await f.db.insert(communityMembers).values({
        communityApId: channel,
        actorApId,
        role: "owner",
        joinedAt: "2000-01-01T00:00:00Z",
      });
    const groupPath = `/dm/community/${encodeURIComponent(channel)}`;
    expect(
      (await f.request(alice, `${groupPath}/read-observed/init`, {})).status,
    ).toBe(200);
    const sent = await f.request(bob, "/communities/room/messages", {
      content: "group A",
    });
    expect(sent.status).toBe(201);
    const id = ((await sent.json()) as { message: { id: string } }).message.id;
    expect(
      (
        await f.request(alice, `${groupPath}/read-observed`, {
          message_ids: [id],
        })
      ).status,
    ).toBe(200);
    expect((await yurumeUnreadCounts(f.db, alice)).community).toBe(0);
    const next = await f.request(bob, "/communities/room/messages", {
      content: "group B after GET",
    });
    expect(next.status).toBe(201);
    const unseen = ((await next.json()) as { message: { id: string } }).message
      .id;
    await f.db
      .update(objects)
      .set({ published: "1999-01-01T00:00:00Z" })
      .where(eq(objects.apId, unseen));
    expect(
      (
        await f.request(alice, `${groupPath}/read-observed`, {
          message_ids: [id],
        })
      ).status,
    ).toBe(200);
    expect((await yurumeUnreadCounts(f.db, alice)).community).toBe(1);
    const groupInbox = await f.request(alice, "/dm/contacts");
    expect(
      (
        (await groupInbox.json()) as {
          communities: { ap_id: string; unread_count: number }[];
        }
      ).communities.find((c) => c.ap_id === channel)?.unread_count,
    ).toBe(1);
    const groupPage = await f.request(bob, "/communities/room/messages");
    expect(
      (
        (await groupPage.json()) as { read_states: { actor_ap_id: string }[] }
      ).read_states.some((state) => state.actor_ap_id === alice),
    ).toBe(false);
    await f.db
      .delete(communityMembers)
      .where(eq(communityMembers.actorApId, alice));
    expect(
      (
        await f.request(alice, `${groupPath}/read-observed`, {
          message_ids: [id],
        })
      ).status,
    ).toBe(403);
    await f.db.insert(communityMembers).values({
      communityApId: channel,
      actorApId: alice,
      role: "member",
      joinedAt: "2001-01-01T00:00:00Z",
    });
    expect(
      (
        await f.request(alice, `${groupPath}/read-observed`, {
          message_ids: [id],
        })
      ).status,
    ).toBe(409);
    expect(
      (await f.request(alice, `${groupPath}/read-observed/init`, {})).status,
    ).toBe(200);
  } finally {
    f.client.close();
  }
});

test("observed endpoints require real request actor and a bounded well-formed ID body", async () => {
  const f = await fixture();
  try {
    const id = await f.send(bob, alice, "A");
    expect(
      (await f.request("", f.path(bob, "read-observed/init"), {})).status,
    ).toBe(401);
    expect(
      (await f.request("", f.path(bob, "read-observed"), { message_ids: [id] }))
        .status,
    ).toBe(401);
    expect(
      (
        await f.request(alice, f.path(bob, "read-observed"), {
          message_ids: [id],
        })
      ).status,
    ).toBe(409);
    expect(
      (await f.request(alice, f.path(bob, "read-observed/init"), {})).status,
    ).toBe(200);
    for (const body of [
      null,
      [],
      {},
      { message_ids: [] },
      { message_ids: [" "] },
      { message_ids: [1] },
      { message_ids: ["x".repeat(2049)] },
    ]) {
      expect(
        (await f.request(alice, f.path(bob, "read-observed"), body)).status,
      ).toBe(400);
    }
    expect(
      (await f.client.execute("SELECT * FROM talk_message_reads")).rows,
    ).toEqual([]);
    expect(
      (await f.client.execute("SELECT * FROM talk_read_assertions")).rows,
    ).toEqual([]);
  } finally {
    f.client.close();
  }
});

test("unknown empty peers cannot create mode rows", async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 3; i++) {
      expect(
        (
          await f.request(
            alice,
            f.path(`https://absent.test/${i}`, "read-observed/init"),
            {},
          )
        ).status,
      ).toBe(409);
    }
    expect(
      (await f.client.execute("SELECT * FROM talk_read_modes")).rows,
    ).toEqual([]);
    expect(
      (await f.client.execute("SELECT * FROM talk_read_assertions")).rows,
    ).toEqual([]);
  } finally {
    f.client.close();
  }
});

test("oversized streaming ACK stops before buffering the whole source even with a false small Content-Length", async () => {
  const f = await fixture();
  try {
    expect(
      (await f.request(alice, f.path(bob, "read-observed/init"), {})).status,
    ).toBe(200);
    let pulled = 0,
      cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(8192).fill(32));
        if (pulled === 50) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    expect(
      (await f.requestStream(alice, f.path(bob, "read-observed"), body)).status,
    ).toBe(413);
    await Bun.sleep(0);
    expect(pulled).toBeLessThan(50);
    expect(cancelled).toBe(true);
    expect(
      (await f.client.execute("SELECT * FROM talk_message_reads")).rows,
    ).toEqual([]);
  } finally {
    f.client.close();
  }
});
