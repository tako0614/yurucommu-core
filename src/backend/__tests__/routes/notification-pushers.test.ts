import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";

import * as schema from "../../../db/schema.ts";
import {
  actors,
  activities,
  blocks,
  communities,
  communityMembers,
  dmArchivedConversations,
  inbox,
  notificationPushers,
  notificationPushJobs,
  objectRecipients,
  objects,
  type Database,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import pusherRoutes from "../../routes/notification-pushers.ts";
import communityMessageRoutes from "../../routes/communities/messages.ts";
import {
  buildNotificationPushMessage,
  enqueuePendingNotificationPushJobs,
  MAX_NOTIFICATION_PUSH_ATTEMPTS,
  MAX_NOTIFICATION_PUSH_JOB_PURGE,
  processNotificationPushJob,
  recoverDeadLetteredNotificationPushJob,
} from "../../lib/notification-push.ts";
import { handleDeliveryDlqBatch } from "../../lib/delivery/queue.ts";
import type {
  DeliveryNotificationPushMessageV1,
  DeliveryQueueMessageV1,
} from "../../lib/delivery/types.ts";

const APP_URL = "https://yuru.test";
const GATEWAY_URL = "https://push.example/_matrix/push/v1/notify";

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  await client.execute("PRAGMA foreign_keys = OFF");
  const root = new URL("../../../../migrations/", import.meta.url);
  const files = (await readdir(root))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await client.executeMultiple(await readFile(new URL(file, root), "utf8"));
  }
  return drizzle(client, { schema }) as unknown as Database;
}

function actor(username: string): Actor {
  const apId = `${APP_URL}/ap/users/${username}`;
  return {
    ap_id: apId,
    type: "Person",
    preferred_username: username,
    name: username,
    summary: null,
    icon_url: null,
    header_url: null,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followers_url: `${apId}/followers`,
    following_url: `${apId}/following`,
    public_key_pem: "public",
    private_key_pem: "private",
    takos_user_id: `takos:${username}`,
    follower_count: 0,
    following_count: 0,
    post_count: 0,
    is_private: 0,
    role: "owner",
    created_at: "2026-07-01T00:00:00.000Z",
  };
}

async function seedActor(db: Database, value: Actor): Promise<void> {
  await db.insert(actors).values({
    apId: value.ap_id,
    type: value.type,
    preferredUsername: value.preferred_username,
    name: value.name,
    summary: value.summary,
    iconUrl: value.icon_url,
    headerUrl: value.header_url,
    inbox: value.inbox,
    outbox: value.outbox,
    followersUrl: value.followers_url,
    followingUrl: value.following_url,
    publicKeyPem: value.public_key_pem,
    privateKeyPem: value.private_key_pem,
    takosUserId: value.takos_user_id,
    followerCount: value.follower_count,
    followingCount: value.following_count,
    postCount: value.post_count,
    isPrivate: value.is_private,
    role: value.role,
    createdAt: value.created_at,
  });
}

function appFor(db: Database, current: Actor) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", current);
    await next();
  });
  app.route("/api/notifications/pushers", pusherRoutes);
  return app;
}

function pusherBody(product: "yurucommu" | "yurume", pushkey: string) {
  return {
    product,
    scope: `client:${product}`,
    pusher: {
      kind: "http",
      app_id: product === "yurume" ? "jp.takos.yurume" : "jp.takos.yurucommu",
      pushkey,
      app_display_name: product === "yurume" ? "Yurumeet" : "Yurucommu",
      data: {
        url: GATEWAY_URL,
        format: "event_id_only",
        provider: "fcm",
      },
    },
  } as const;
}

async function register(
  app: ReturnType<typeof appFor>,
  body: ReturnType<typeof pusherBody>,
  allowedHosts = "push.example",
): Promise<Response> {
  return app.fetch(
    new Request(`${APP_URL}/api/notifications/pushers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    {
      APP_URL,
      YURUCOMMU_NOTIFICATION_PUSH_GATEWAY_ALLOWED_HOSTS: allowedHosts,
    } as unknown as Env,
  );
}

test("pusher registration is fail-closed, hides the pushkey, and reassigns one app install between actors", async () => {
  const db = await freshDb();
  const alice = actor("alice");
  const bob = actor("bob");
  await seedActor(db, alice);
  await seedActor(db, bob);

  const denied = await register(
    appFor(db, alice),
    pusherBody("yurucommu", "fid-1"),
    "",
  );
  expect(denied.status).toBe(400);

  const first = await register(
    appFor(db, alice),
    pusherBody("yurucommu", "fid-1"),
  );
  expect(first.status).toBe(200);
  expect(JSON.stringify(await first.json())).not.toContain("fid-1");

  const moved = await register(
    appFor(db, bob),
    pusherBody("yurucommu", "fid-1"),
  );
  expect(moved.status).toBe(200);
  const rows = await db
    .select({ actorApId: notificationPushers.actorApId })
    .from(notificationPushers);
  expect(rows).toEqual([{ actorApId: bob.ap_id }]);
});

test("pusher registration defaults an omitted format to event_id_only", async () => {
  const db = await freshDb();
  const alice = actor("alice");
  await seedActor(db, alice);
  const body = pusherBody("yurucommu", "default-format-fid");
  const { format: _format, ...dataWithoutFormat } = body.pusher.data;

  const response = await appFor(db, alice).fetch(
    new Request(`${APP_URL}/api/notifications/pushers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...body,
        pusher: { ...body.pusher, data: dataWithoutFormat },
      }),
    }),
    {
      APP_URL,
      YURUCOMMU_NOTIFICATION_PUSH_GATEWAY_ALLOWED_HOSTS: "push.example",
    } as unknown as Env,
  );

  expect(response.status).toBe(200);
  const payload = (await response.json()) as {
    pusher: { data: { format?: string } };
  };
  expect(payload.pusher.data.format).toBe("event_id_only");
  const rows = await db
    .select({ dataJson: notificationPushers.dataJson })
    .from(notificationPushers);
  expect(JSON.parse(rows[0]?.dataJson ?? "{}").format).toBe("event_id_only");
});

test("authenticated runtime config exposes only an allowed gateway and public Web Push key", async () => {
  const db = await freshDb();
  const alice = actor("alice");
  await seedActor(db, alice);
  const publicKeyBytes = new Uint8Array(65).fill(7);
  publicKeyBytes[0] = 0x04;
  const publicKey = Buffer.from(publicKeyBytes).toString("base64url");
  const response = await appFor(db, alice).fetch(
    new Request(`${APP_URL}/api/notifications/pushers/config`),
    {
      APP_URL,
      YURUCOMMU_NOTIFICATION_PUSH_GATEWAY_ALLOWED_HOSTS: "push.example",
      YURUCOMMU_NOTIFICATION_PUSH_GATEWAY_URL: GATEWAY_URL,
      YURUCOMMU_NOTIFICATION_PUSH_GATEWAY_TOKEN: "must-not-leak",
      YURUCOMMU_NOTIFICATION_PUSH_WEB_PUSH_PUBLIC_KEY: `  ${publicKey}  `,
    } as unknown as Env,
  );

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toEqual({
    gateway_url: GATEWAY_URL,
    web_push_public_key: publicKey,
  });
  expect(JSON.stringify(body)).not.toContain("must-not-leak");

  const failClosed = await appFor(db, alice).fetch(
    new Request(`${APP_URL}/api/notifications/pushers/config`),
    {
      APP_URL,
      YURUCOMMU_NOTIFICATION_PUSH_GATEWAY_ALLOWED_HOSTS: "",
      YURUCOMMU_NOTIFICATION_PUSH_GATEWAY_URL: GATEWAY_URL,
      YURUCOMMU_NOTIFICATION_PUSH_WEB_PUSH_PUBLIC_KEY:
        "invalid key with spaces",
    } as unknown as Env,
  );
  expect(await failClosed.json()).toEqual({
    gateway_url: null,
    web_push_public_key: null,
  });

  const anonymous = new Hono<{ Bindings: Env; Variables: Variables }>();
  anonymous.use("*", async (c, next) => {
    c.set("db", db);
    await next();
  });
  anonymous.route("/api/notifications/pushers", pusherRoutes);
  const denied = await anonymous.fetch(
    new Request(`${APP_URL}/api/notifications/pushers/config`),
    { APP_URL } as unknown as Env,
  );
  expect(denied.status).toBe(401);
});

test("public HTTPS registration rejects IP literals and single-label hosts even if allowlisted", async () => {
  const db = await freshDb();
  const alice = actor("alice");
  await seedActor(db, alice);
  const app = appFor(db, alice);
  for (const url of [
    "https://127.0.0.1/_matrix/push/v1/notify",
    "https://10.0.0.1/_matrix/push/v1/notify",
    "https://203.0.113.10/_matrix/push/v1/notify",
    "https://push/_matrix/push/v1/notify",
    "https://[::1]/_matrix/push/v1/notify",
  ]) {
    const body = pusherBody("yurucommu", `device-${url}`);
    const response = await app.fetch(
      new Request(`${APP_URL}/api/notifications/pushers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...body,
          pusher: { ...body.pusher, data: { ...body.pusher.data, url } },
        }),
      }),
      {
        APP_URL,
        YURUCOMMU_NOTIFICATION_PUSH_GATEWAY_ALLOWED_HOSTS: new URL(url)
          .hostname,
      } as unknown as Env,
    );
    expect(response.status).toBe(400);
  }
});

test("DELETE /api/notifications/pushers revokes only the selected product/app/pushkey", async () => {
  const db = await freshDb();
  const alice = actor("alice");
  await seedActor(db, alice);
  const app = appFor(db, alice);
  await register(app, pusherBody("yurucommu", "same-device"));
  await register(app, pusherBody("yurume", "same-device"));

  const response = await app.fetch(
    new Request(`${APP_URL}/api/notifications/pushers`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product: "yurucommu",
        scope: "client:yurucommu",
        app_id: "jp.takos.yurucommu",
        pushkey: "same-device",
      }),
    }),
    { APP_URL } as unknown as Env,
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ deleted: true });
  const rows = await db
    .select({ product: notificationPushers.product })
    .from(notificationPushers);
  expect(rows).toEqual([{ product: "yurume" }]);
});

test("registration bounds one app to eight devices and evicts the oldest row", async () => {
  const db = await freshDb();
  const alice = actor("alice");
  await seedActor(db, alice);
  const app = appFor(db, alice);
  for (let index = 0; index < 8; index += 1) {
    const response = await register(
      app,
      pusherBody("yurucommu", `device-${index}`),
    );
    expect(response.status).toBe(200);
  }
  const seeded = await db
    .select({
      id: notificationPushers.id,
      pushkey: notificationPushers.pushkey,
    })
    .from(notificationPushers);
  for (const row of seeded) {
    const index = Number(row.pushkey.replace("device-", ""));
    await db
      .update(notificationPushers)
      .set({ createdAt: `2026-07-01T00:00:0${index}.000Z` })
      .where(eq(notificationPushers.id, row.id));
  }
  expect(
    (await register(app, pusherBody("yurucommu", "device-8"))).status,
  ).toBe(200);
  const rows = await db
    .select({ pushkey: notificationPushers.pushkey })
    .from(notificationPushers);
  expect(rows).toHaveLength(8);
  expect(rows.map((row) => row.pushkey)).not.toContain("device-0");
});

function queueEnv(db: Database) {
  const sent: DeliveryQueueMessageV1[] = [];
  const queue = {
    send: async (body: DeliveryQueueMessageV1) => {
      sent.push(body);
    },
    sendBatch: async (batch: Array<{ body: DeliveryQueueMessageV1 }>) => {
      sent.push(...batch.map((entry) => entry.body));
    },
  };
  return {
    sent,
    env: {
      APP_URL,
      DB_INSTANCE: db,
      DELIVERY_QUEUE: queue,
      DELIVERY_DLQ: queue,
      YURUCOMMU_NOTIFICATION_PUSH_GATEWAY_ALLOWED_HOSTS: "push.example",
      YURUCOMMU_NOTIFICATION_PUSH_GATEWAY_URL: GATEWAY_URL,
      YURUCOMMU_NOTIFICATION_PUSH_GATEWAY_TOKEN: "host-secret",
    } as unknown as Env,
  };
}

test("outbox recovery purges only one bounded batch of terminal jobs older than the idempotency window", async () => {
  const db = await freshDb();
  const alice = actor("alice");
  await seedActor(db, alice);
  const expiredAt = new Date(Date.now() - 91 * 86_400_000).toISOString();
  const recentAt = new Date().toISOString();

  await db.insert(notificationPushJobs).values([
    ...Array.from(
      { length: MAX_NOTIFICATION_PUSH_JOB_PURGE + 3 },
      (_, index) => ({
        id: `expired-terminal-${index}`,
        actorApId: alice.ap_id,
        activityApId: `${APP_URL}/ap/activities/expired-terminal-${index}`,
        status: index % 2 === 0 ? "delivered" : "failed",
        attempts: 0,
        nextAttemptAt: expiredAt,
        createdAt: expiredAt,
        updatedAt: expiredAt,
        deliveredAt: index % 2 === 0 ? expiredAt : null,
      }),
    ),
    {
      id: "recent-terminal",
      actorApId: alice.ap_id,
      activityApId: `${APP_URL}/ap/activities/recent-terminal`,
      status: "delivered",
      attempts: 0,
      nextAttemptAt: recentAt,
      createdAt: recentAt,
      updatedAt: recentAt,
      deliveredAt: recentAt,
    },
    {
      // A FRESH in-flight row: not past the retention window, so it must be
      // retained (a genuinely stuck row is reclaimed by the queue-bound sweep,
      // not by this retention purge).
      id: "recent-active",
      actorApId: alice.ap_id,
      activityApId: `${APP_URL}/ap/activities/recent-active`,
      status: "processing",
      attempts: 1,
      nextAttemptAt: recentAt,
      createdAt: recentAt,
      updatedAt: recentAt,
    },
  ]);

  const env = {
    APP_URL,
    DB_INSTANCE: db,
  } as unknown as Env;
  expect(await enqueuePendingNotificationPushJobs(env)).toBe(0);
  expect(await db.select().from(notificationPushJobs)).toHaveLength(5);

  expect(await enqueuePendingNotificationPushJobs(env)).toBe(0);
  const retained = await db
    .select({ id: notificationPushJobs.id })
    .from(notificationPushJobs);
  expect(retained.map((row) => row.id).sort()).toEqual([
    "recent-active",
    "recent-terminal",
  ]);
});

test("the sweep reclaims an in-flight row whose queue message was lost", async () => {
  const db = await freshDb();
  const alice = actor("alice");
  await seedActor(db, alice);
  const staleAt = new Date(Date.now() - 16 * 60 * 1000).toISOString();

  // A 'queued'/'processing' row whose queue message vanished (auto-dead-letter
  // with the raw body, queue retention). No pusher, so after reclaim it stays
  // 'pending' (not re-enqueued) — isolating the reclaim transition.
  await db.insert(notificationPushJobs).values([
    {
      id: "stale-queued",
      actorApId: alice.ap_id,
      activityApId: `${APP_URL}/ap/activities/stale-queued`,
      status: "queued",
      attempts: 0,
      nextAttemptAt: staleAt,
      createdAt: staleAt,
      updatedAt: staleAt,
    },
    {
      id: "stale-exhausted",
      actorApId: alice.ap_id,
      activityApId: `${APP_URL}/ap/activities/stale-exhausted`,
      status: "processing",
      attempts: MAX_NOTIFICATION_PUSH_ATTEMPTS - 1,
      nextAttemptAt: staleAt,
      createdAt: staleAt,
      updatedAt: staleAt,
    },
  ]);

  const { env } = queueEnv(db);
  await enqueuePendingNotificationPushJobs(env);

  const rows = Object.fromEntries(
    (await db.select().from(notificationPushJobs)).map((row) => [row.id, row]),
  );
  // Reclaimed to a retryable state, one attempt consumed, lease cleared.
  expect(rows["stale-queued"].status).toBe("pending");
  expect(rows["stale-queued"].attempts).toBe(1);
  expect(rows["stale-queued"].processingToken).toBeNull();
  // A reclaim that would exceed the attempt budget terminates as 'failed'.
  expect(rows["stale-exhausted"].status).toBe("failed");
  expect(rows["stale-exhausted"].attempts).toBe(MAX_NOTIFICATION_PUSH_ATTEMPTS);
});

test("a dead-lettered notification_push raw body resets its durable outbox row", async () => {
  const db = await freshDb();
  const alice = actor("alice");
  await seedActor(db, alice);
  await db.insert(notificationPushJobs).values({
    id: "dlq-job",
    actorApId: alice.ap_id,
    activityApId: `${APP_URL}/ap/activities/dlq-job`,
    status: "queued",
    attempts: 1,
    nextAttemptAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Direct recovery helper.
  expect(await recoverDeadLetteredNotificationPushJob(db, "dlq-job")).toBe(
    true,
  );
  let row = await db
    .select()
    .from(notificationPushJobs)
    .where(eq(notificationPushJobs.id, "dlq-job"))
    .get();
  expect(row?.status).toBe("retry_wait");
  expect(row?.attempts).toBe(2);

  // End-to-end: the DLQ consumer must recognize the RAW auto-dead-lettered
  // body (not an app-built `dlq` message) and route it through recovery, not
  // silently ack it as "invalid".
  const acked: boolean[] = [];
  const message = {
    body: buildNotificationPushMessage("dlq-job"),
    id: "m1",
    timestamp: new Date(),
    attempts: 1,
    ack: () => acked.push(true),
    retry: () => acked.push(false),
  };
  const { env } = queueEnv(db);
  await handleDeliveryDlqBatch(
    { messages: [message], queue: "dlq", ackAll() {}, retryAll() {} } as never,
    env,
  );
  expect(acked).toEqual([true]);
  row = await db
    .select()
    .from(notificationPushJobs)
    .where(eq(notificationPushJobs.id, "dlq-job"))
    .get();
  expect(row?.status).toBe("retry_wait");
  expect(row?.attempts).toBe(3);
});

async function seedNotification(
  db: Database,
  recipient: Actor,
  visibility: "public" | "direct",
): Promise<string> {
  const senderApId = `${APP_URL}/ap/users/bob`;
  const objectApId = `${APP_URL}/ap/objects/${visibility}`;
  const activityApId = `${APP_URL}/ap/activities/${visibility}`;
  await db.insert(objects).values({
    apId: objectApId,
    type: "Note",
    attributedTo: senderApId,
    content: "private body must never enter the queue payload",
    toJson: visibility === "direct" ? JSON.stringify([recipient.ap_id]) : "[]",
    ccJson: "[]",
    visibility,
    conversation:
      visibility === "direct" ? `${APP_URL}/conversations/bob-alice` : null,
    published: new Date().toISOString(),
  });
  if (visibility === "direct") {
    await db.insert(objectRecipients).values({
      objectApId,
      recipientApId: recipient.ap_id,
      type: "to",
    });
  }
  await db.insert(activities).values({
    apId: activityApId,
    type: "Create",
    actorApId: senderApId,
    objectApId,
    rawJson: "{}",
  });
  await db.insert(inbox).values({
    actorApId: recipient.ap_id,
    activityApId,
    read: 0,
  });
  return activityApId;
}

test("the inbox trigger enqueues id-only delivery and rejected pushkeys are compare-safely removed", async () => {
  const db = await freshDb();
  const alice = actor("alice");
  await seedActor(db, alice);
  await register(appFor(db, alice), pusherBody("yurucommu", "rejected-fid"));
  const activityApId = await seedNotification(db, alice, "public");
  const { sent, env } = queueEnv(db);

  expect(await enqueuePendingNotificationPushJobs(env)).toBe(1);
  expect(sent).toHaveLength(1);
  expect(JSON.stringify(sent[0])).not.toContain("rejected-fid");
  expect(JSON.stringify(sent[0])).not.toContain("private body");

  // A later Yurume DM must not inflate the Yurucommu social-app badge that is
  // computed when this already-queued public event is delivered.
  await seedNotification(db, alice, "direct");

  const requests: Array<{ authorization: string | null; body: unknown }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    requests.push({
      authorization: new Headers(init?.headers).get("Authorization"),
      body: JSON.parse(String(init?.body)),
    });
    return Response.json({ rejected: ["rejected-fid"] });
  }) as typeof fetch;
  let acked = false;
  try {
    await processNotificationPushJob(
      env,
      sent[0] as DeliveryNotificationPushMessageV1,
      {
        ack() {
          acked = true;
        },
        retry() {
          throw new Error("unexpected retry");
        },
      } as never,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  expect(acked).toBe(true);
  expect(requests[0]?.authorization).toBe("Bearer host-secret");
  expect(requests[0]?.body).toEqual({
    notification: {
      event_id: activityApId,
      room_id: `${APP_URL}/ap/objects/public`,
      counts: { unread: 1 },
      devices: [
        {
          app_id: "jp.takos.yurucommu",
          pushkey: "rejected-fid",
          pushkey_ts: expect.any(Number),
          data: { format: "event_id_only", provider: "fcm" },
        },
      ],
    },
  });
  expect(await db.select().from(notificationPushers)).toHaveLength(0);
  const jobs = await db.select().from(notificationPushJobs);
  expect(jobs[0]?.status).toBe("delivered");
});

test("one gateway receives separate event-id-only and full privacy batches", async () => {
  const db = await freshDb();
  const alice = actor("alice");
  await seedActor(db, alice);
  const app = appFor(db, alice);
  await register(app, pusherBody("yurucommu", "id-only-fid"));
  const full = pusherBody("yurucommu", "full-fid");
  const fullResponse = await app.fetch(
    new Request(`${APP_URL}/api/notifications/pushers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...full,
        pusher: {
          ...full.pusher,
          data: { ...full.pusher.data, format: "full" },
        },
      }),
    }),
    {
      APP_URL,
      YURUCOMMU_NOTIFICATION_PUSH_GATEWAY_ALLOWED_HOSTS: "push.example",
    } as unknown as Env,
  );
  expect(fullResponse.status).toBe(200);

  const activityApId = await seedNotification(db, alice, "public");
  const { sent, env } = queueEnv(db);
  await enqueuePendingNotificationPushJobs(env);
  const payloads: Array<{
    notification: Record<string, unknown> & {
      devices: Array<{ data: { format?: string } }>;
    };
  }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => {
    payloads.push(JSON.parse(String(init?.body)));
    return Response.json({ rejected: [] });
  }) as typeof fetch;
  try {
    await processNotificationPushJob(
      env,
      sent[0] as DeliveryNotificationPushMessageV1,
      { ack() {}, retry() {} } as never,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  expect(payloads).toHaveLength(2);
  const idOnlyPayload = payloads.find(
    ({ notification }) =>
      notification.devices[0]?.data.format === "event_id_only",
  );
  const fullPayload = payloads.find(
    ({ notification }) => notification.devices[0]?.data.format === "full",
  );
  expect(idOnlyPayload?.notification.event_id).toBe(activityApId);
  expect("type" in (idOnlyPayload?.notification ?? {})).toBe(false);
  expect("sender" in (idOnlyPayload?.notification ?? {})).toBe(false);
  expect(fullPayload?.notification).toMatchObject({
    event_id: activityApId,
    type: "create",
    sender: `${APP_URL}/ap/users/bob`,
  });
});

test("delivery rechecks block visibility after an inbox job was queued", async () => {
  const db = await freshDb();
  const alice = actor("alice");
  await seedActor(db, alice);
  await register(appFor(db, alice), pusherBody("yurucommu", "blocked-fid"));
  await seedNotification(db, alice, "public");
  const { sent, env } = queueEnv(db);
  expect(await enqueuePendingNotificationPushJobs(env)).toBe(1);

  // The recipient can block the sender after the durable outbox row exists but
  // before the Queue delivery runs. That late moderation decision must win.
  await db.insert(blocks).values({
    blockerApId: alice.ap_id,
    blockedApId: `${APP_URL}/ap/users/bob`,
  });

  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = (async (_input, _init) => {
    fetchCount += 1;
    return Response.json({ rejected: [] });
  }) as typeof fetch;
  let acked = false;
  try {
    await processNotificationPushJob(
      env,
      sent[0] as DeliveryNotificationPushMessageV1,
      {
        ack() {
          acked = true;
        },
        retry() {
          throw new Error("unexpected retry");
        },
      } as never,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  expect(acked).toBe(true);
  expect(fetchCount).toBe(0);
  const jobs = await db.select().from(notificationPushJobs);
  expect(jobs[0]).toMatchObject({
    status: "delivered",
    lastError: "notification is no longer eligible",
  });
});

test("delivery suppresses a direct message archived after enqueue", async () => {
  const db = await freshDb();
  const alice = actor("alice");
  await seedActor(db, alice);
  await register(appFor(db, alice), pusherBody("yurume", "archived-dm-fid"));
  await seedNotification(db, alice, "direct");
  const { sent, env } = queueEnv(db);
  expect(await enqueuePendingNotificationPushJobs(env)).toBe(1);

  await db.insert(dmArchivedConversations).values({
    actorApId: alice.ap_id,
    conversationId: `${APP_URL}/conversations/bob-alice`,
    archivedAt: new Date().toISOString(),
  });

  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = (async () => {
    fetchCount += 1;
    return Response.json({ rejected: [] });
  }) as unknown as typeof fetch;
  let acked = false;
  try {
    await processNotificationPushJob(
      env,
      sent[0] as DeliveryNotificationPushMessageV1,
      {
        ack() {
          acked = true;
        },
        retry() {
          throw new Error("unexpected retry");
        },
      } as never,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  expect(acked).toBe(true);
  expect(fetchCount).toBe(0);
  const jobs = await db.select().from(notificationPushJobs);
  expect(jobs[0]).toMatchObject({
    status: "delivered",
    lastError: "notification is no longer eligible",
    processingToken: null,
  });
});

test("direct messages dispatch only to the yurume client and transient failures retain the pusher", async () => {
  const db = await freshDb();
  const alice = actor("alice");
  await seedActor(db, alice);
  const app = appFor(db, alice);
  await register(app, pusherBody("yurucommu", "social-fid"));
  await register(app, pusherBody("yurume", "talk-fid"));
  await seedNotification(db, alice, "direct");
  const { sent, env } = queueEnv(db);
  await enqueuePendingNotificationPushJobs(env);
  // A later social event belongs to Yurucommu and must not inflate Yurume's
  // DM/community unread badge.
  await seedNotification(db, alice, "public");

  const originalFetch = globalThis.fetch;
  const devicePushkeys: string[] = [];
  const unreadCounts: number[] = [];
  globalThis.fetch = (async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as {
      notification: {
        counts: { unread: number };
        devices: Array<{ pushkey: string }>;
      };
    };
    devicePushkeys.push(...payload.notification.devices.map((d) => d.pushkey));
    unreadCounts.push(payload.notification.counts.unread);
    return new Response("busy", {
      status: 503,
      headers: { "Retry-After": "60" },
    });
  }) as typeof fetch;
  let retryDelay = 0;
  try {
    await processNotificationPushJob(
      env,
      sent[0] as DeliveryNotificationPushMessageV1,
      {
        ack() {
          throw new Error("unexpected ack");
        },
        retry(options: { delaySeconds?: number }) {
          retryDelay = options.delaySeconds ?? 0;
        },
      } as never,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  expect(devicePushkeys).toEqual(["talk-fid"]);
  expect(unreadCounts).toEqual([1]);
  expect(retryDelay).toBeGreaterThanOrEqual(60);
  expect(await db.select().from(notificationPushers)).toHaveLength(2);
  const jobs = await db.select().from(notificationPushJobs);
  expect(jobs[0]?.status).toBe("retry_wait");
  expect(jobs[0]?.pendingPusherIdsJson).not.toContain("social-fid");
});

test("the explicit HTTP loopback development exception never receives the operator bearer", async () => {
  const db = await freshDb();
  const alice = actor("alice");
  await seedActor(db, alice);
  const loopbackUrl = "http://127.0.0.1:8787/_matrix/push/v1/notify";
  const body = pusherBody("yurucommu", "loopback-device");
  const app = appFor(db, alice);
  const registered = await app.fetch(
    new Request(`${APP_URL}/api/notifications/pushers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...body,
        pusher: {
          ...body.pusher,
          data: { ...body.pusher.data, url: loopbackUrl },
        },
      }),
    }),
    {
      APP_URL,
      YURUCOMMU_NOTIFICATION_PUSH_ALLOW_INSECURE_LOOPBACK: "true",
    } as unknown as Env,
  );
  expect(registered.status).toBe(200);
  await seedNotification(db, alice, "public");
  const { sent, env } = queueEnv(db);
  env.YURUCOMMU_NOTIFICATION_PUSH_GATEWAY_URL = loopbackUrl;
  env.YURUCOMMU_NOTIFICATION_PUSH_ALLOW_INSECURE_LOOPBACK = "true";
  await enqueuePendingNotificationPushJobs(env);

  const authorizations: Array<string | null> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => {
    authorizations.push(new Headers(init?.headers).get("Authorization"));
    return Response.json({ rejected: [] });
  }) as typeof fetch;
  try {
    await processNotificationPushJob(
      env,
      sent[0] as DeliveryNotificationPushMessageV1,
      { ack() {}, retry() {} } as never,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  expect(authorizations).toEqual([null]);
});

test("partial gateway results retry only transient pushers and delete only rejected registrations", async () => {
  const db = await freshDb();
  const alice = actor("alice");
  await seedActor(db, alice);
  const app = appFor(db, alice);
  for (const pushkey of ["ok-fid", "retry-fid", "reject-fid"]) {
    await register(app, pusherBody("yurucommu", pushkey));
  }
  await seedNotification(db, alice, "public");
  const { sent, env } = queueEnv(db);
  await enqueuePendingNotificationPushJobs(env);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    Response.json({
      rejected: ["reject-fid"],
      retryable: ["retry-fid"],
      failed: [],
    })) as unknown as typeof fetch;
  let retryDelay = 0;
  try {
    await processNotificationPushJob(
      env,
      sent[0] as DeliveryNotificationPushMessageV1,
      {
        ack() {
          throw new Error("unexpected ack");
        },
        retry(options: { delaySeconds?: number }) {
          retryDelay = options.delaySeconds ?? 0;
        },
      } as never,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  expect(retryDelay).toBeGreaterThan(0);
  const rows = await db
    .select({
      id: notificationPushers.id,
      pushkey: notificationPushers.pushkey,
    })
    .from(notificationPushers);
  expect(rows.map((row) => row.pushkey).sort()).toEqual([
    "ok-fid",
    "retry-fid",
  ]);
  const jobs = await db.select().from(notificationPushJobs);
  const retryPusher = rows.find((row) => row.pushkey === "retry-fid");
  expect(JSON.parse(jobs[0]?.pendingPusherIdsJson ?? "[]")).toEqual([
    retryPusher?.id,
  ]);
});

test("a reclaimed job fences the expired worker from overwriting terminal state", async () => {
  const db = await freshDb();
  const alice = actor("alice");
  await seedActor(db, alice);
  await register(appFor(db, alice), pusherBody("yurucommu", "lease-fid"));
  await seedNotification(db, alice, "public");
  const { sent, env } = queueEnv(db);
  await enqueuePendingNotificationPushJobs(env);
  const queued = sent[0] as DeliveryNotificationPushMessageV1;

  let markFirstStarted: () => void = () => {};
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  let resolveFirst: (response: Response) => void = () => {};
  const firstResponse = new Promise<Response>((resolve) => {
    resolveFirst = resolve;
  });
  const originalFetch = globalThis.fetch;
  let gatewayCalls = 0;
  globalThis.fetch = (async () => {
    gatewayCalls += 1;
    if (gatewayCalls === 1) {
      markFirstStarted();
      return firstResponse;
    }
    return Response.json({ rejected: [] });
  }) as unknown as typeof fetch;

  let firstAcked = false;
  let firstRetried = false;
  let secondAcked = false;
  try {
    const firstWorker = processNotificationPushJob(env, queued, {
      ack() {
        firstAcked = true;
      },
      retry() {
        firstRetried = true;
      },
    } as never);
    await firstStarted;

    const firstClaim = await db
      .select({ processingToken: notificationPushJobs.processingToken })
      .from(notificationPushJobs)
      .where(eq(notificationPushJobs.id, queued.jobId))
      .get();
    expect(typeof firstClaim?.processingToken).toBe("string");
    await db
      .update(notificationPushJobs)
      .set({ updatedAt: "2000-01-01T00:00:00.000Z" })
      .where(eq(notificationPushJobs.id, queued.jobId));

    await processNotificationPushJob(env, queued, {
      ack() {
        secondAcked = true;
      },
      retry() {
        throw new Error("reclaiming worker unexpectedly retried");
      },
    } as never);

    const afterReclaim = await db
      .select()
      .from(notificationPushJobs)
      .where(eq(notificationPushJobs.id, queued.jobId))
      .get();
    expect(afterReclaim).toMatchObject({
      status: "delivered",
      attempts: 0,
      processingToken: null,
    });
    expect(afterReclaim?.processingToken).not.toBe(firstClaim?.processingToken);

    // The expired worker reports a transient failure after the new owner has
    // committed success. Its old token must not turn the job back into retry.
    resolveFirst(new Response("busy", { status: 503 }));
    await firstWorker;
  } finally {
    globalThis.fetch = originalFetch;
  }

  expect(gatewayCalls).toBe(2);
  expect(firstAcked).toBe(true);
  expect(firstRetried).toBe(false);
  expect(secondAcked).toBe(true);
  const terminal = await db
    .select()
    .from(notificationPushJobs)
    .where(eq(notificationPushJobs.id, queued.jobId))
    .get();
  expect(terminal).toMatchObject({
    status: "delivered",
    attempts: 0,
    processingToken: null,
  });
});

test("gateway fanout heartbeats the processing lease before each network call", async () => {
  const db = await freshDb();
  const alice = actor("alice");
  await seedActor(db, alice);
  const app = appFor(db, alice);
  await register(app, pusherBody("yurucommu", "heartbeat-one"));
  const second = pusherBody("yurucommu", "heartbeat-two");
  const secondGateway = "https://push-two.example/_matrix/push/v1/notify";
  const registered = await app.fetch(
    new Request(`${APP_URL}/api/notifications/pushers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...second,
        pusher: {
          ...second.pusher,
          data: { ...second.pusher.data, url: secondGateway },
        },
      }),
    }),
    {
      APP_URL,
      YURUCOMMU_NOTIFICATION_PUSH_GATEWAY_ALLOWED_HOSTS:
        "push.example,push-two.example",
    } as unknown as Env,
  );
  expect(registered.status).toBe(200);
  await seedNotification(db, alice, "public");
  const queued = queueEnv(db);
  const env = {
    ...queued.env,
    YURUCOMMU_NOTIFICATION_PUSH_GATEWAY_ALLOWED_HOSTS:
      "push.example,push-two.example",
  } as Env;
  await enqueuePendingNotificationPushJobs(env);
  const body = queued.sent[0] as DeliveryNotificationPushMessageV1;

  const artificiallyStale = "2000-01-01T00:00:00.000Z";
  let calls = 0;
  let secondCallUpdatedAt: string | null = null;
  let secondCallToken: string | null = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) {
      await db
        .update(notificationPushJobs)
        .set({ updatedAt: artificiallyStale })
        .where(eq(notificationPushJobs.id, body.jobId));
    } else {
      const row = await db
        .select({
          updatedAt: notificationPushJobs.updatedAt,
          processingToken: notificationPushJobs.processingToken,
        })
        .from(notificationPushJobs)
        .where(eq(notificationPushJobs.id, body.jobId))
        .get();
      secondCallUpdatedAt = row?.updatedAt ?? null;
      secondCallToken = row?.processingToken ?? null;
    }
    return Response.json({ rejected: [] });
  }) as unknown as typeof fetch;
  try {
    await processNotificationPushJob(env, body, {
      ack() {},
      retry() {},
    } as never);
  } finally {
    globalThis.fetch = originalFetch;
  }

  expect(calls).toBe(2);
  expect(secondCallUpdatedAt).not.toBe(artificiallyStale);
  expect(typeof secondCallToken).toBe("string");
});

async function communityTalkFixture() {
  const db = await freshDb();
  const alice = actor("alice");
  const bob = actor("bob");
  await seedActor(db, alice);
  await seedActor(db, bob);
  const communityApId = `${APP_URL}/ap/groups/town`;
  await db.insert(communities).values({
    apId: communityApId,
    preferredUsername: "town",
    name: "Town",
    inbox: `${communityApId}/inbox`,
    outbox: `${communityApId}/outbox`,
    followersUrl: `${communityApId}/followers`,
    visibility: "private",
    postPolicy: "members",
    publicKeyPem: "public",
    privateKeyPem: "private",
    createdBy: alice.ap_id,
  });
  await db.insert(communityMembers).values([
    { communityApId, actorApId: alice.ap_id, role: "member" },
    { communityApId, actorApId: bob.ap_id, role: "member" },
  ]);
  await register(appFor(db, bob), pusherBody("yurume", "bob-talk-fid"));

  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", alice);
    await next();
  });
  app.route("/", communityMessageRoutes);
  return { db, alice, bob, communityApId, app };
}

async function postCommunityMessage(
  fixture: Awaited<ReturnType<typeof communityTalkFixture>>,
  content: string,
): Promise<Response> {
  return fixture.app.fetch(
    new Request(`${APP_URL}/town/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }),
    { APP_URL, DB_INSTANCE: fixture.db } as unknown as Env,
  );
}

test("community talk creates explicit yurume outbox jobs without polluting the social inbox", async () => {
  const fixture = await communityTalkFixture();
  const { db, bob } = fixture;
  const response = await postCommunityMessage(fixture, "hello town");
  expect(response.status).toBe(201);
  expect(
    await db.select().from(inbox).where(eq(inbox.actorApId, bob.ap_id)),
  ).toHaveLength(0);
  const jobs = await db.select().from(notificationPushJobs);
  expect(jobs).toHaveLength(1);
  expect(jobs[0]).toMatchObject({ actorApId: bob.ap_id, product: "yurume" });

  const { sent, env } = queueEnv(db);
  await enqueuePendingNotificationPushJobs(env);
  const delivered: string[] = [];
  const unreadCounts: number[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as {
      notification: {
        counts: { unread: number };
        devices: Array<{ pushkey: string }>;
      };
    };
    delivered.push(...payload.notification.devices.map((item) => item.pushkey));
    unreadCounts.push(payload.notification.counts.unread);
    return Response.json({ rejected: [] });
  }) as typeof fetch;
  try {
    await processNotificationPushJob(
      env,
      sent[0] as DeliveryNotificationPushMessageV1,
      { ack() {}, retry() {} } as never,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  expect(delivered).toEqual(["bob-talk-fid"]);
  expect(unreadCounts).toEqual([1]);
});

test("community talk delivery rechecks current membership after enqueue", async () => {
  const fixture = await communityTalkFixture();
  const { db, bob } = fixture;
  expect(
    (await postCommunityMessage(fixture, "membership changes")).status,
  ).toBe(201);
  const { sent, env } = queueEnv(db);
  expect(await enqueuePendingNotificationPushJobs(env)).toBe(1);
  await db
    .delete(communityMembers)
    .where(eq(communityMembers.actorApId, bob.ap_id));

  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = (async () => {
    fetchCount += 1;
    return Response.json({ rejected: [] });
  }) as unknown as typeof fetch;
  let acked = false;
  try {
    await processNotificationPushJob(
      env,
      sent[0] as DeliveryNotificationPushMessageV1,
      {
        ack() {
          acked = true;
        },
        retry() {
          throw new Error("unexpected retry");
        },
      } as never,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  expect(acked).toBe(true);
  expect(fetchCount).toBe(0);
  const jobs = await db.select().from(notificationPushJobs);
  expect(jobs[0]).toMatchObject({
    status: "delivered",
    lastError: "notification is no longer eligible",
    processingToken: null,
  });
});

test("community message and push outbox roll back as one atomic batch", async () => {
  const fixture = await communityTalkFixture();
  const { db, communityApId } = fixture;
  await db.run(
    sql.raw(`
      CREATE TRIGGER reject_notification_push_job
      BEFORE INSERT ON notification_push_jobs
      BEGIN
        SELECT RAISE(ABORT, 'forced push outbox failure');
      END
    `),
  );

  const response = await postCommunityMessage(fixture, "must roll back");
  expect(response.status).toBe(500);
  expect(
    await db
      .select()
      .from(objects)
      .where(eq(objects.content, "must roll back")),
  ).toHaveLength(0);
  expect(await db.select().from(activities)).toHaveLength(0);
  expect(await db.select().from(notificationPushJobs)).toHaveLength(0);
  const community = await db
    .select({ lastMessageAt: communities.lastMessageAt })
    .from(communities)
    .where(eq(communities.apId, communityApId))
    .get();
  expect(community?.lastMessageAt).toBeNull();
});
