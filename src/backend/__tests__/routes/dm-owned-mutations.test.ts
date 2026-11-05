import { expect, test } from "bun:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  actors,
  objects,
  objectRecipients,
  activities,
  inbox,
  deliveryResolutions,
  deliveryFanouts,
  mediaBlobDeletionJobs,
  actorWriteAssertions,
  communities,
  communityMembers,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import dm from "../../routes/dm/messages.ts";
import group from "../../routes/communities/messages.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";
import { enqueuePendingDeliveryResolutionJobs } from "../../lib/delivery/resolution-outbox.ts";
import { guardActorWrites } from "../../lib/account-deletion-admission.ts";

const origin = "https://owned.test",
  alice = origin + "/ap/users/alice",
  remote = "https://remote.example/users/bob";
async function fixture() {
  const f = await createTestDb(),
    db = f.db;
  await db.insert(actors).values({
    apId: alice,
    preferredUsername: "alice",
    name: "Alice",
    inbox: alice + "/inbox",
    outbox: alice + "/outbox",
    followersUrl: alice + "/followers",
    followingUrl: alice + "/following",
    publicKeyPem: "public-fixture",
    privateKeyPem: "private-fixture",
  });
  const actor = {
    ap_id: alice,
    preferred_username: "alice",
    name: "Alice",
    icon_url: null,
    public_key_pem: "public-fixture",
    takos_user_id: null,
  } as Actor;
  const env = { APP_URL: origin, DB_INSTANCE: db } as Env;
  const errors: unknown[] = [];
  function app(viewer: Actor | null = actor, guarded = false) {
    const a = new Hono<{ Bindings: Env; Variables: Variables }>();
    a.use("*", async (c, next) => {
      c.set("db", viewer && guarded ? guardActorWrites(db, viewer) : db);
      if (viewer) c.set("actor", viewer);
      await next();
    });
    a.onError((error, c) => {
      errors.push(error);
      return c.json({ error: "controlled DB failure" }, 500);
    });
    a.route("/api/dm", dm);
    a.route("/api/communities", group);
    return a;
  }
  const id = origin + "/ap/objects/opaque%2Fone?value=%25";
  await db.insert(objects).values({
    apId: id,
    type: "Note",
    attributedTo: alice,
    content: "Original message",
    visibility: "direct",
    toJson: JSON.stringify([remote]),
    ccJson: "[]",
    conversation: "stored-pair",
    published: "2026-11-05T00:00:00Z",
    isLocal: 1,
  });
  await db.insert(activities).values({
    apId: id + "#create",
    type: "Create",
    actorApId: alice,
    objectApId: id,
    direction: "outbound",
    rawJson: JSON.stringify({
      type: "Create",
      actor: alice,
      object: { id, type: "Note", content: "Original message", to: [remote] },
    }),
  });
  const path = "/api/dm/messages/" + encodeURIComponent(id);
  async function request(method = "GET", body?: unknown, revision?: string) {
    return app().fetch(
      new Request(origin + path, {
        method,
        headers: {
          ...(body ? { "content-type": "application/json" } : {}),
          ...(revision ? { "if-match": JSON.stringify(revision) } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      env,
    );
  }
  async function snapshot() {
    return {
      objects: await db.select().from(objects),
      recipients: await db.select().from(objectRecipients),
      activities: await db.select().from(activities),
      inbox: await db.select().from(inbox),
      resolutions: await db.select().from(deliveryResolutions),
      fanouts: await db.select().from(deliveryFanouts),
      media: await db.select().from(mediaBlobDeletionJobs),
      assertions: await db.select().from(actorWriteAssertions),
    };
  }
  return { ...f, actor, env, app, id, path, request, snapshot, errors };
}

test("one owned DM can be read back without writes, including an opaque percent ID", async () => {
  const f = await fixture();
  try {
    const before = await f.snapshot(),
      response = await f.request();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const data = (await response.json()) as {
      message: { id: string; content: string; sender: { ap_id: string } };
      revision: string;
    };
    expect(data.message).toMatchObject({
      id: f.id,
      content: "Original message",
      sender: { ap_id: alice },
    });
    expect(data.revision).toMatch(/^dm-v1:[a-f0-9]{64}$/);
    expect(response.headers.get("etag")).toBe(JSON.stringify(data.revision));
    expect(await f.snapshot()).toEqual(before);
    const other = await f
      .app({ ...f.actor, ap_id: "other" })
      .fetch(new Request(origin + f.path), f.env);
    expect(other.status).toBe(403);
    expect(await other.text()).not.toContain("Original message");
  } finally {
    f.client.close();
  }
});

test("missing authentication and another author cannot read, edit or delete the owned DM", async () => {
  const f = await fixture();
  try {
    const before = await f.snapshot();
    for (const actor of [null, { ...f.actor, ap_id: "another-actor" }]) {
      for (const method of ["GET", "PATCH", "DELETE"]) {
        const response = await f.app(actor).fetch(
          new Request(origin + f.path, {
            method,
            ...(method === "PATCH"
              ? {
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ content: "not mine" }),
                }
              : {}),
          }),
          f.env,
        );
        expect(response.status).toBe(actor ? 403 : 401);
        expect(await response.text()).not.toContain("Original message");
        expect(await f.snapshot()).toEqual(before);
      }
    }
  } finally {
    f.client.close();
  }
});

test("owner source checks compose with the actual request actor guard", async () => {
  const f = await fixture();
  try {
    const revision = (
      (await (await f.request()).json()) as { revision: string }
    ).revision;
    const response = await f.app(f.actor, true).fetch(
      new Request(origin + f.path, {
        method: "DELETE",
        headers: { "if-match": JSON.stringify(revision) },
      }),
      f.env,
    );
    expect(response.status).toBe(200);
    expect(await f.db.select().from(actorWriteAssertions)).toHaveLength(0);
    expect(await f.db.select().from(objects)).toHaveLength(0);
    expect((await f.db.select().from(activities)).map((x) => x.type)).toEqual([
      "Delete",
    ]);
  } finally {
    f.client.close();
  }
});

test("a stale edit/delete precondition has zero effects", async () => {
  const f = await fixture();
  try {
    const before = await f.snapshot();
    for (const method of ["PATCH", "DELETE"]) {
      const response = await f.request(
        method,
        method === "PATCH"
          ? { content: "replace from an old draft" }
          : undefined,
        "dm-v1:" + "0".repeat(64),
      );
      expect(response.status).toBe(409);
      expect(await f.snapshot()).toEqual(before);
    }
  } finally {
    f.client.close();
  }
});

test("a current revision edits once and an older revision cannot delete the new value", async () => {
  const f = await fixture();
  try {
    const first = (await (await f.request()).json()) as { revision: string };
    const edited = await f.request(
      "PATCH",
      { content: "Current revision edit" },
      first.revision,
    );
    expect(edited.status).toBe(200);
    const ack = (await edited.json()) as {
      revision: string;
      message: { id: string; content: string };
    };
    expect(ack.message).toMatchObject({
      id: f.id,
      content: "Current revision edit",
    });
    expect(ack.revision).not.toBe(first.revision);
    expect(
      ((await (await f.request()).json()) as { revision: string }).revision,
    ).toBe(ack.revision);
    const before = await f.snapshot();
    expect((await f.request("DELETE", undefined, first.revision)).status).toBe(
      409,
    );
    expect(await f.snapshot()).toEqual(before);
    expect((await f.request("DELETE", undefined, ack.revision)).status).toBe(
      200,
    );
  } finally {
    f.client.close();
  }
});

test("a source change immediately before the mutation batch denies the stale edit without side effects", async () => {
  const f = await fixture();
  try {
    const batch = f.client.batch.bind(f.client);
    let before: Awaited<ReturnType<typeof f.snapshot>> | undefined;
    f.client.batch = (async (statements, ...rest) => {
      if (!before) {
        await f.db
          .update(objects)
          .set({ content: "Another device", updated: "2026-11-05T00:00:01Z" })
          .where(eq(objects.apId, f.id));
        before = await f.snapshot();
      }
      return batch(statements, ...rest);
    }) as typeof f.client.batch;
    expect(
      (await f.request("PATCH", { content: "stale overwrite" })).status,
    ).toBe(409);
    expect(before).toBeDefined();
    expect(await f.snapshot()).toEqual(before!);
  } finally {
    f.client.close();
  }
});

test("an Update and its explicit remote delivery intent commit with the edit, without follower fanout", async () => {
  const f = await fixture();
  try {
    const response = await f.request("PATCH", {
      content: "  Updated message  ",
    });
    expect(f.errors).toEqual([]);
    expect(response.status).toBe(200);
    expect(
      (await f.db.select().from(objects).where(eq(objects.apId, f.id)))[0]
        ?.content,
    ).toBe("Updated message");
    const updates = await f.db
      .select()
      .from(activities)
      .where(eq(activities.type, "Update"));
    expect(updates).toHaveLength(1);
    const wire = JSON.parse(updates[0]!.rawJson);
    expect(wire).toMatchObject({
      type: "Update",
      actor: alice,
      to: [remote],
      cc: [],
      object: {
        id: f.id,
        content: "Updated message",
        attributedTo: alice,
        to: [remote],
      },
    });
    const intents = await f.db.select().from(deliveryResolutions);
    expect(
      intents.map((x) => [x.activityApId, x.recipientActorApId, x.status]),
    ).toEqual([[updates[0]!.apId, remote, "pending"]]);
    expect(await f.db.select().from(deliveryFanouts)).toHaveLength(0);
  } finally {
    f.client.close();
  }
});

test("a failed final delete rolls back all cascades and delivery intents", async () => {
  const f = await fixture();
  try {
    await f.client.execute(
      "CREATE TRIGGER synthetic_owned_delete_failure BEFORE DELETE ON objects BEGIN SELECT RAISE(ABORT, 'synthetic final delete failure'); END",
    );
    const before = await f.snapshot();
    expect((await f.request("DELETE")).status).toBe(500);
    expect(String(f.errors[0])).toContain("synthetic final delete failure");
    expect(await f.snapshot()).toEqual(before);
  } finally {
    f.client.close();
  }
});

test("a failed durable delivery intent rolls back the edit and Activity", async () => {
  const f = await fixture();
  try {
    await f.client.execute(
      "CREATE TRIGGER synthetic_owned_intent_failure BEFORE INSERT ON delivery_resolutions BEGIN SELECT RAISE(ABORT, 'synthetic intent failure'); END",
    );
    const before = await f.snapshot();
    expect(
      (await f.request("PATCH", { content: "must not commit without intent" }))
        .status,
    ).toBe(500);
    expect(String(f.errors[0])).toContain("synthetic intent failure");
    expect(await f.snapshot()).toEqual(before);
  } finally {
    f.client.close();
  }
});

test("a lost Queue wakeup retains a committed edit and the actual outbox drain recovers it", async () => {
  const f = await fixture();
  try {
    let attempted = 0;
    f.env.DELIVERY_QUEUE = {
      sendBatch: async () => {
        attempted += 1;
        throw new Error("synthetic lost wakeup");
      },
    } as unknown as Env["DELIVERY_QUEUE"];
    f.env.DELIVERY_DLQ = {} as NonNullable<Env["DELIVERY_DLQ"]>;
    expect(
      (await f.request("PATCH", { content: "committed despite a lost wakeup" }))
        .status,
    ).toBe(200);
    expect(attempted).toBe(1);
    const jobs = await f.db.select().from(deliveryResolutions);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe("pending");
    const recovered: unknown[] = [];
    f.env.DELIVERY_QUEUE = {
      sendBatch: async (messages: unknown[]) => {
        recovered.push(...messages);
      },
    } as unknown as Env["DELIVERY_QUEUE"];
    expect(await enqueuePendingDeliveryResolutionJobs(f.env)).toBe(1);
    expect(recovered).toMatchObject([
      {
        body: {
          type: "resolve_actor",
          activityId: jobs[0]!.activityApId,
          recipientActorApId: remote,
        },
      },
    ]);
    expect((await f.db.select().from(deliveryResolutions))[0]?.status).toBe(
      "queued",
    );
  } finally {
    f.client.close();
  }
});

test("Delete removes the object but retains its Tombstone and durable remote withdrawal", async () => {
  const f = await fixture();
  try {
    const response = await f.request("DELETE");
    expect(f.errors).toEqual([]);
    expect(response.status).toBe(200);
    expect(
      await f.db.select().from(objects).where(eq(objects.apId, f.id)),
    ).toHaveLength(0);
    const deletes = await f.db
      .select()
      .from(activities)
      .where(eq(activities.type, "Delete"));
    expect(deletes).toHaveLength(1);
    expect(JSON.parse(deletes[0]!.rawJson)).toMatchObject({
      type: "Delete",
      actor: alice,
      to: [remote],
      object: { id: f.id, type: "Tombstone" },
    });
    expect(
      (await f.db.select().from(deliveryResolutions)).map(
        (x) => x.recipientActorApId,
      ),
    ).toEqual([remote]);
    expect((await f.request()).status).toBe(404);
  } finally {
    f.client.close();
  }
});

test("DM mutation cannot bypass a removed group author's membership boundary", async () => {
  const f = await fixture();
  try {
    const channel = origin + "/ap/groups/chat";
    await f.db.insert(communities).values({
      apId: channel,
      preferredUsername: "chat",
      name: "Chat",
      inbox: channel + "/inbox",
      outbox: channel + "/outbox",
      followersUrl: channel + "/followers",
      publicKeyPem: "group-fixture",
      privateKeyPem: "group-fixture",
      createdBy: alice,
      visibility: "private",
    });
    await f.db
      .insert(communityMembers)
      .values({ communityApId: channel, actorApId: alice, role: "owner" });
    const sent = await f.app().fetch(
      new Request(origin + "/api/communities/chat/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "Private group message" }),
      }),
      f.env,
    );
    expect(sent.status).toBe(201);
    const id = ((await sent.json()) as { message: { id: string } }).message.id;
    await f.db
      .delete(communityMembers)
      .where(eq(communityMembers.communityApId, channel));
    const before = await f.snapshot();
    for (const method of ["GET", "PATCH", "DELETE"]) {
      const response = await f.app().fetch(
        new Request(origin + "/api/dm/messages/" + encodeURIComponent(id), {
          method,
          ...(method === "PATCH"
            ? {
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ content: "membership bypass" }),
              }
            : {}),
        }),
        f.env,
      );
      expect(response.status).toBe(404);
      expect(await f.snapshot()).toEqual(before);
    }
  } finally {
    f.client.close();
  }
});
