import { expect, test } from "bun:test";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import {
  activities,
  actors,
  blocks,
  communities,
  communityMembers,
  mutes,
  objectRecipients,
  objects,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";
import dm from "../../routes/dm.ts";
import group from "../../routes/communities/messages.ts";

const origin = "https://yuru.test";
const alice = `${origin}/ap/users/alice`;
const bob = `${origin}/ap/users/bob`;
const carol = `${origin}/ap/users/carol`;
const channel = `${origin}/ap/groups/room`;

async function fixture() {
  const { db, client } = await createTestDb();
  for (const apId of [alice, bob, carol])
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
  const env = { APP_URL: origin, DB_INSTANCE: db } as unknown as Env;
  function request(
    viewer: string,
    path: string,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
  ) {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use("*", async (c, next) => {
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
    app.route("/api/dm", dm);
    app.route("/api/communities", group);
    return app.fetch(
      new Request(origin + path, {
        method,
        ...(body === undefined
          ? {}
          : {
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            }),
      }),
      env,
    );
  }
  async function eventFor(objectId: string) {
    const [event] = await db
      .select({ id: activities.apId })
      .from(activities)
      .where(eq(activities.objectApId, objectId));
    expect(event?.id).toBeString();
    return event!.id;
  }
  async function send(sender = bob, recipient = alice) {
    const response = await request(
      sender,
      `/api/dm/user/${encodeURIComponent(recipient)}/messages`,
      { content: "actual source message" },
    );
    expect(response.status).toBe(201);
    const objectId = ((await response.json()) as { message: { id: string } })
      .message.id;
    return { objectId, eventId: await eventFor(objectId) };
  }
  async function groupMessage() {
    await db.insert(communities).values({
      apId: channel,
      preferredUsername: "room",
      name: "Room",
      inbox: `${channel}/inbox`,
      outbox: `${channel}/outbox`,
      followersUrl: `${channel}/followers`,
      publicKeyPem: "synthetic-public",
      privateKeyPem: "synthetic-private",
      createdBy: bob,
      visibility: "private",
    });
    for (const actorApId of [alice, bob])
      await db
        .insert(communityMembers)
        .values({ communityApId: channel, actorApId });
    const response = await request(bob, "/api/communities/room/messages", {
      content: "actual group source",
    });
    expect(response.status).toBe(201);
    const objectId = ((await response.json()) as { message: { id: string } })
      .message.id;
    return { objectId, eventId: await eventFor(objectId) };
  }
  const target = (viewer: string, eventId: string, objectId?: string) =>
    request(
      viewer,
      "/api/dm/notification-target?" +
        new URLSearchParams({
          event_id: eventId,
          ...(objectId ? { object_id: objectId } : {}),
        }),
    );
  return { db, client, request, send, groupMessage, target };
}

test("a push Create resolves only its actual incoming recipient and never writes read state", async () => {
  const f = await fixture();
  try {
    const { eventId, objectId } = await f.send();
    const before = await f.db.get<{ total: number }>(
      sql`SELECT total_changes() AS total`,
    );
    const execute = f.client.execute;
    const statements: { sql: string; parameters: number }[] = [];
    f.client.execute = (async (statement: any, args?: any) => {
      statements.push({
        sql: typeof statement === "string" ? statement : statement.sql,
        parameters: Object.keys(
          (typeof statement === "string" ? args : statement.args) ?? {},
        ).length,
      });
      return typeof statement === "string"
        ? execute(statement, args)
        : execute(statement);
    }) as typeof execute;
    let response: Response;
    try {
      response = await f.target(alice, eventId, objectId);
    } finally {
      f.client.execute = execute;
    }
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      event_id: eventId,
      recipient_ap_id: alice,
      target: { type: "user", ap_id: bob },
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(statements).toHaveLength(1);
    expect(statements[0]!.sql).toMatch(/^select\b/i);
    expect(statements[0]!.parameters).toBeLessThan(90);
    expect(
      await f.db.get<{ total: number }>(sql`SELECT total_changes() AS total`),
    ).toEqual(before);
    expect((await f.target("", eventId)).status).toBe(401);
    for (const viewer of [bob, carol])
      expect((await f.target(viewer, eventId)).status).toBe(404);
    expect((await f.target(alice, objectId)).status).toBe(404); // room_id is not the event
    expect((await f.target(alice, eventId, "wrong-object")).status).toBe(404);
    // bto/bcc can be absent from to_json: the indexed edge is read authority.
    await f.db
      .update(objects)
      .set({ toJson: "[]" })
      .where(eq(objects.apId, objectId));
    expect((await f.target(alice, eventId)).status).toBe(200);
  } finally {
    f.client.close();
  }
});

test("a group event resolves the Group instead of its author and rechecks current membership", async () => {
  const f = await fixture();
  try {
    const { eventId, objectId } = await f.groupMessage();
    const response = await f.target(alice, eventId, objectId);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      event_id: eventId,
      recipient_ap_id: alice,
      target: { type: "community", ap_id: channel },
    });
    expect((await f.target(carol, eventId)).status).toBe(404);
    await f.db
      .delete(communityMembers)
      .where(eq(communityMembers.actorApId, alice));
    expect((await f.target(alice, eventId)).status).toBe(404);
  } finally {
    f.client.close();
  }
});

test("source event, chat object and audience must agree, with ambiguous groups unavailable", async () => {
  const f = await fixture();
  try {
    const { eventId, objectId } = await f.groupMessage();
    expect((await f.target(alice, eventId)).status).toBe(200);
    const second = `${origin}/ap/groups/second`;
    await f.db.insert(communities).values({
      apId: second,
      preferredUsername: "second",
      name: "Second",
      inbox: `${second}/inbox`,
      outbox: `${second}/outbox`,
      followersUrl: `${second}/followers`,
      publicKeyPem: "synthetic-public",
      privateKeyPem: "synthetic-private",
      createdBy: bob,
    });
    await f.db
      .insert(communityMembers)
      .values({ communityApId: second, actorApId: alice });
    await f.db.insert(objectRecipients).values({
      objectApId: objectId,
      recipientApId: second,
      type: "audience",
    });
    expect((await f.target(alice, eventId)).status).toBe(404);
    await f.db
      .delete(objectRecipients)
      .where(eq(objectRecipients.recipientApId, second));
    expect((await f.target(alice, eventId)).status).toBe(200);
    await f.db
      .update(objects)
      .set({ communityApId: channel })
      .where(eq(objects.apId, objectId));
    expect((await f.target(alice, eventId)).status).toBe(404); // community feed, not chat
    await f.db
      .update(objects)
      .set({ communityApId: null })
      .where(eq(objects.apId, objectId));
    expect((await f.target(alice, eventId)).status).toBe(200);
    await f.db
      .update(activities)
      .set({ actorApId: carol })
      .where(eq(activities.apId, eventId));
    expect((await f.target(alice, eventId)).status).toBe(404);
    await f.db
      .update(activities)
      .set({ actorApId: bob })
      .where(eq(activities.apId, eventId));
    expect((await f.target(alice, eventId)).status).toBe(200);
    await f.db
      .update(activities)
      .set({ type: "Update" })
      .where(eq(activities.apId, eventId));
    expect((await f.target(alice, eventId)).status).toBe(404);
  } finally {
    f.client.close();
  }
});

test("blocks, mutes, archives and removed recipient links invalidate an old tap", async () => {
  const f = await fixture();
  try {
    const { eventId, objectId } = await f.send();
    expect((await f.target(alice, eventId)).status).toBe(200);
    await f.db.insert(blocks).values({ blockerApId: alice, blockedApId: bob });
    expect((await f.target(alice, eventId)).status).toBe(404);
    await f.db.delete(blocks);
    expect((await f.target(alice, eventId)).status).toBe(200);
    await f.db.insert(mutes).values({ muterApId: alice, mutedApId: bob });
    expect((await f.target(alice, eventId)).status).toBe(404);
    await f.db.delete(mutes);
    expect((await f.target(alice, eventId)).status).toBe(200);
    const archivePath = `/api/dm/user/${encodeURIComponent(bob)}/archive`;
    expect((await f.request(alice, archivePath, {})).status).toBe(200);
    expect((await f.target(alice, eventId)).status).toBe(404);
    expect(
      (await f.request(alice, archivePath, undefined, "DELETE")).status,
    ).toBe(200);
    expect((await f.target(alice, eventId)).status).toBe(200);
    await f.db
      .delete(objectRecipients)
      .where(eq(objectRecipients.objectApId, objectId));
    expect((await f.target(alice, eventId)).status).toBe(404);
  } finally {
    f.client.close();
  }
});

test("colliding legacy conversation ids never authorize another event's recipient", async () => {
  const f = await fixture();
  try {
    const a = await f.send();
    const b = await f.send(bob, carol);
    const [message] = await f.db
      .select({ thread: objects.conversation })
      .from(objects)
      .where(eq(objects.apId, a.objectId));
    await f.db
      .update(objects)
      .set({ conversation: message!.thread })
      .where(eq(objects.apId, b.objectId));
    expect((await f.target(alice, a.eventId)).status).toBe(200);
    expect((await f.target(alice, b.eventId)).status).toBe(404);
    expect((await f.target(carol, a.eventId)).status).toBe(404);
    await f.db.delete(objects).where(eq(objects.apId, a.objectId));
    expect((await f.target(alice, a.eventId)).status).toBe(404);
  } finally {
    f.client.close();
  }
});

test("target ids are bounded exact single values and unknown ids do not fetch remote URLs", async () => {
  const f = await fixture();
  const originalFetch = globalThis.fetch;
  let remoteRequests = 0;
  globalThis.fetch = (async () => {
    remoteRequests += 1;
    throw new Error("Unexpected external request");
  }) as unknown as typeof fetch;
  try {
    for (const query of [
      "",
      "event_id=",
      "event_id=a&event_id=b",
      `event_id=${"x".repeat(2049)}`,
      "event_id=a&object_id=",
      "event_id=a&object_id=b&object_id=c",
    ]) {
      expect(
        (await f.request(alice, "/api/dm/notification-target?" + query)).status,
      ).toBe(400);
    }
    expect(
      (await f.target(alice, "https://unrelated.invalid/private-event")).status,
    ).toBe(404);
    expect(remoteRequests).toBe(0);
  } finally {
    globalThis.fetch = originalFetch;
    f.client.close();
  }
});
