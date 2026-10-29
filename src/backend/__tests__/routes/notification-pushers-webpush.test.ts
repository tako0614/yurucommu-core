import { beforeEach, expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

import * as schema from "../../../db/schema.ts";
import {
  actors,
  activities,
  inbox,
  notificationPushers,
  notificationPushJobs,
  objectRecipients,
  objects,
  type Database,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import pusherRoutes from "../../routes/notification-pushers.ts";
import {
  enqueuePendingNotificationPushJobs,
  processNotificationPushJob,
} from "../../lib/notification-push.ts";
import type {
  DeliveryNotificationPushMessageV1,
  DeliveryQueueMessageV1,
} from "../../lib/delivery/types.ts";
import {
  clearVapidJwtCache,
  deriveVapidKeyPair,
  parseVapidDerivationSecret,
} from "../../lib/web-push/vapid.ts";
import {
  createTestUserAgent,
  decryptWebPushBody,
  verifyVapidAuthorization,
  type TestUserAgent,
} from "../helpers/web-push-receiver.ts";

const APP_URL = "https://yuru.test";
const ENCRYPTION_KEY = "5e".repeat(32);
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/device-token-1";
const GATEWAY_URL = "https://push.example/_matrix/push/v1/notify";

beforeEach(() => clearVapidJwtCache());

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

function actor(username: string, name: string | null = username): Actor {
  const apId = `${APP_URL}/ap/users/${username}`;
  return {
    ap_id: apId,
    type: "Person",
    preferred_username: username,
    name,
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

function baseEnv(extra: Record<string, unknown> = {}): Env {
  return { APP_URL, ENCRYPTION_KEY, ...extra } as unknown as Env;
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

function webPushBody(
  agent: Pick<TestUserAgent, "p256dhBase64Url" | "authBase64Url">,
  overrides: {
    product?: "yurucommu" | "yurume";
    endpoint?: string;
    lang?: string;
    pushkey?: string;
    auth?: string;
  } = {},
) {
  const product = overrides.product ?? "yurucommu";
  return {
    product,
    pusher: {
      kind: "webpush",
      app_id:
        product === "yurume" ? "jp.takos.yurume.web" : "jp.takos.yurucommu.web",
      app_display_name: product === "yurume" ? "Yurumeet" : "Yurucommu",
      pushkey: overrides.pushkey ?? agent.p256dhBase64Url,
      ...(overrides.lang ? { lang: overrides.lang } : {}),
      data: {
        url: overrides.endpoint ?? ENDPOINT,
        auth: overrides.auth ?? agent.authBase64Url,
      },
    },
  };
}

async function post(
  app: ReturnType<typeof appFor>,
  body: unknown,
  env: Env = baseEnv(),
): Promise<Response> {
  return app.fetch(
    new Request(`${APP_URL}/api/notifications/pushers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
  );
}

function queueEnv(db: Database, extra: Record<string, unknown> = {}) {
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
      ENCRYPTION_KEY,
      DB_INSTANCE: db,
      DELIVERY_QUEUE: queue,
      DELIVERY_DLQ: queue,
      ...extra,
    } as unknown as Env,
  };
}

async function seedNotification(
  db: Database,
  recipient: Actor,
  sender: Actor,
  visibility: "public" | "direct",
): Promise<string> {
  const objectApId = `${APP_URL}/ap/objects/${visibility}`;
  const activityApId = `${APP_URL}/ap/activities/${visibility}`;
  await db.insert(objects).values({
    apId: objectApId,
    type: "Note",
    attributedTo: sender.ap_id,
    content: "private body must never enter the push payload",
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
    actorApId: sender.ap_id,
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

type CapturedRequest = {
  url: string;
  headers: Headers;
  body: Uint8Array;
  redirect: RequestRedirect | undefined;
};

async function runJob(
  env: Env,
  message: DeliveryQueueMessageV1,
  respond: (request: CapturedRequest) => Response | Promise<Response>,
) {
  const requests: CapturedRequest[] = [];
  const retries: number[] = [];
  let acked = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const request: CapturedRequest = {
      url: String(input),
      headers: new Headers(init?.headers),
      body:
        init?.body instanceof ArrayBuffer
          ? new Uint8Array(init.body)
          : new TextEncoder().encode(String(init?.body ?? "")),
      redirect: init?.redirect,
    };
    requests.push(request);
    return respond(request);
  }) as typeof fetch;
  try {
    await processNotificationPushJob(
      env,
      message as DeliveryNotificationPushMessageV1,
      {
        ack() {
          acked = true;
        },
        retry(options?: { delaySeconds?: number }) {
          retries.push(options?.delaySeconds ?? 0);
        },
      } as never,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  return { requests, retries, acked };
}

async function decodePayload(request: CapturedRequest, agent: TestUserAgent) {
  return JSON.parse(
    new TextDecoder().decode(await decryptWebPushBody(request.body, agent)),
  );
}

test("webpush registration takes MSC4174's layout, skips the gateway allowlist and never echoes the auth secret", async () => {
  const db = await freshDb();
  const alice = actor("alice");
  await seedActor(db, alice);
  const agent = await createTestUserAgent();

  const response = await post(
    appFor(db, alice),
    webPushBody(agent, { lang: "ja-JP" }),
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as { pusher: Record<string, unknown> };
  expect(body.pusher).toMatchObject({
    kind: "webpush",
    app_id: "jp.takos.yurucommu.web",
    lang: "ja-JP",
    data: { url: ENDPOINT },
    product: "yurucommu",
  });
  expect(JSON.stringify(body)).not.toContain(agent.authBase64Url);
  expect(JSON.stringify(body)).not.toContain(agent.p256dhBase64Url);

  const rows = await db.select().from(notificationPushers);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    kind: "webpush",
    pushkey: agent.p256dhBase64Url,
    gatewayUrl: ENDPOINT,
  });
  expect(JSON.parse(rows[0]!.dataJson)).toEqual({ auth: agent.authBase64Url });

  // Re-registering the same subscription with a moved endpoint updates the row.
  const moved = await post(
    appFor(db, alice),
    webPushBody(agent, {
      endpoint: "https://fcm.googleapis.com/fcm/send/device-token-2",
    }),
  );
  expect(moved.status).toBe(200);
  const after = await db.select().from(notificationPushers);
  expect(after).toHaveLength(1);
  expect(after[0]?.gatewayUrl).toBe(
    "https://fcm.googleapis.com/fcm/send/device-token-2",
  );

  // DELETE uses the same (app_id, pushkey = p256dh) identity.
  const deleted = await appFor(db, alice).fetch(
    new Request(`${APP_URL}/api/notifications/pushers`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product: "yurucommu",
        app_id: "jp.takos.yurucommu.web",
        pushkey: agent.p256dhBase64Url,
      }),
    }),
    baseEnv(),
  );
  expect(deleted.status).toBe(200);
  expect(await db.select().from(notificationPushers)).toHaveLength(0);
});

test("webpush endpoints must be public https: private, loopback and link-local targets are refused", async () => {
  const db = await freshDb();
  const alice = actor("alice");
  await seedActor(db, alice);
  const agent = await createTestUserAgent();
  const app = appFor(db, alice);
  for (const endpoint of [
    "http://push.example.net/push/abc",
    "https://127.0.0.1/push/abc",
    "https://10.0.0.8/push/abc",
    "https://192.168.1.2/push/abc",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/push/abc",
    "https://[fe80::1]/push/abc",
    "https://[fd00::1]/push/abc",
    "https://localhost/push/abc",
    "https://push.localhost/push/abc",
    "https://printer.local/push/abc",
    "https://metadata.internal/push/abc",
    "https://router.lan/push/abc",
    "https://push/abc",
    "https://push.example.net:8443/push/abc",
    "https://user:pass@push.example.net/push/abc",
    "https://push.example.net/push/abc#fragment",
    "ftp://push.example.net/push/abc",
    `https://push.example.net/${"a".repeat(2100)}`,
  ]) {
    const response = await post(app, webPushBody(agent, { endpoint }));
    expect({ endpoint, status: response.status }).toEqual({
      endpoint,
      status: 400,
    });
  }
  expect(await db.select().from(notificationPushers)).toHaveLength(0);
});

test("plain-HTTP loopback endpoints need the explicit development flag", async () => {
  const db = await freshDb();
  const alice = actor("alice");
  await seedActor(db, alice);
  const agent = await createTestUserAgent();
  const body = webPushBody(agent, {
    endpoint: "http://127.0.0.1:8790/push/abc",
  });
  expect((await post(appFor(db, alice), body)).status).toBe(400);
  const allowed = await post(
    appFor(db, alice),
    body,
    baseEnv({ YURUCOMMU_NOTIFICATION_PUSH_ALLOW_INSECURE_LOOPBACK: "1" }),
  );
  expect(allowed.status).toBe(200);
});

test("webpush keys are validated and registration needs the instance VAPID key", async () => {
  const db = await freshDb();
  const alice = actor("alice");
  await seedActor(db, alice);
  const agent = await createTestUserAgent();
  const app = appFor(db, alice);
  const offCurve = new Uint8Array(agent.p256dh);
  offCurve[64] ^= 1;
  for (const [field, overrides] of [
    ["pusher.pushkey", { pushkey: "not base64url!" }],
    ["pusher.pushkey", { pushkey: `${agent.p256dhBase64Url}=` }],
    [
      "pusher.pushkey",
      { pushkey: Buffer.from(offCurve).toString("base64url") },
    ],
    [
      "pusher.pushkey",
      {
        pushkey: Buffer.from(agent.p256dh.subarray(0, 33)).toString(
          "base64url",
        ),
      },
    ],
    [
      "pusher.data.auth",
      { auth: Buffer.from(new Uint8Array(15)).toString("base64url") },
    ],
    ["pusher.data.auth", { auth: `${agent.authBase64Url}==` }],
  ] as const) {
    const response = await post(app, webPushBody(agent, overrides));
    expect(response.status).toBe(400);
    expect(((await response.json()) as { field?: string }).field).toBe(field);
  }

  const unavailable = await post(
    app,
    webPushBody(agent),
    baseEnv({ ENCRYPTION_KEY: undefined }),
  );
  expect(unavailable.status).toBe(400);
  expect(await unavailable.json()).toMatchObject({ field: "pusher.kind" });
  expect(await db.select().from(notificationPushers)).toHaveLength(0);
});

test("an inbox notification reaches a webpush subscription as an encrypted Declarative Web Push message with valid VAPID", async () => {
  const db = await freshDb();
  const alice = actor("alice");
  const bob = actor("bob", "さくら");
  await seedActor(db, alice);
  await seedActor(db, bob);
  const agent = await createTestUserAgent();
  expect(
    (await post(appFor(db, alice), webPushBody(agent, { lang: "ja-JP" })))
      .status,
  ).toBe(200);
  await seedNotification(db, alice, bob, "public");
  const { sent, env } = queueEnv(db);
  expect(await enqueuePendingNotificationPushJobs(env)).toBe(1);

  const { requests, acked } = await runJob(
    env,
    sent[0]!,
    () => new Response(null, { status: 201 }),
  );
  expect(acked).toBe(true);
  expect(requests).toHaveLength(1);
  const request = requests[0]!;
  expect(request.url).toBe(ENDPOINT);
  expect(request.redirect).toBe("manual");
  expect(request.headers.get("Content-Encoding")).toBe("aes128gcm");
  expect(request.headers.get("TTL")).toBe("172800");
  expect(request.headers.get("Urgency")).toBe("normal");
  expect(request.headers.get("Topic")).toBeNull();

  const derived = await deriveVapidKeyPair(
    parseVapidDerivationSecret(ENCRYPTION_KEY)!,
  );
  const vapid = await verifyVapidAuthorization(
    request.headers.get("Authorization"),
  );
  expect(vapid.publicKey).toBe(derived.publicKeyBase64Url);
  expect(vapid.claims.aud).toBe("https://fcm.googleapis.com");
  expect(vapid.claims.sub).toBe(APP_URL);
  const lifetime = vapid.claims.exp - Math.floor(Date.now() / 1000);
  expect(lifetime).toBeGreaterThan(11 * 3600);
  expect(lifetime).toBeLessThanOrEqual(12 * 3600);

  const payload = await decodePayload(request, agent);
  expect(payload).toEqual({
    web_push: 8030,
    notification: {
      title: "Yurucommu",
      body: "さくらさんがあなた宛てに投稿しました",
      navigate: `${APP_URL}/notifications`,
      lang: "ja-JP",
      tag: "notifications",
      app_badge: "1",
    },
  });
  expect(JSON.stringify(payload)).not.toContain("private body");
  expect(request.body.byteLength - 103).toBeLessThanOrEqual(2048);

  const jobs = await db.select().from(notificationPushJobs);
  expect(jobs[0]).toMatchObject({ status: "delivered", lastError: null });
});

test("a direct message goes to the yurume subscription with high urgency and a per-conversation topic", async () => {
  const db = await freshDb();
  const alice = actor("alice");
  const bob = actor("bob", "Bob");
  await seedActor(db, alice);
  await seedActor(db, bob);
  const yurume = await createTestUserAgent();
  const yurucommu = await createTestUserAgent();
  await post(
    appFor(db, alice),
    webPushBody(yurume, { product: "yurume", lang: "en-US" }),
  );
  await post(
    appFor(db, alice),
    webPushBody(yurucommu, {
      endpoint: "https://updates.push.services.mozilla.com/wpush/v2/x",
    }),
  );
  await seedNotification(db, alice, bob, "direct");
  const { sent, env } = queueEnv(db);
  await enqueuePendingNotificationPushJobs(env);

  const { requests } = await runJob(
    env,
    sent[0]!,
    () => new Response(null, { status: 201 }),
  );
  expect(requests).toHaveLength(1);
  const request = requests[0]!;
  expect(request.headers.get("Urgency")).toBe("high");
  const topic = request.headers.get("Topic");
  expect(topic).toMatch(/^[A-Za-z0-9_-]{32}$/);
  const payload = await decodePayload(request, yurume);
  expect(payload.notification).toMatchObject({
    title: "Yurumeet",
    body: "Message from Bob",
    navigate: `${APP_URL}/`,
    lang: "en-US",
    tag: `dm-${topic}`,
  });
});

test("push service answers map to delete, retry and failed exactly as the design table says", async () => {
  const cases: Array<{
    name: string;
    respond: () => Response | Promise<Response>;
    pusherKept: boolean;
    jobStatus: "delivered" | "retry_wait";
    retried: boolean;
    minDelaySeconds?: number;
  }> = [
    {
      name: "201",
      respond: () => new Response(null, { status: 201 }),
      pusherKept: true,
      jobStatus: "delivered",
      retried: false,
    },
    {
      name: "404",
      respond: () => new Response(null, { status: 404 }),
      pusherKept: false,
      jobStatus: "delivered",
      retried: false,
    },
    {
      name: "410",
      respond: () => new Response(null, { status: 410 }),
      pusherKept: false,
      jobStatus: "delivered",
      retried: false,
    },
    {
      name: "429 Retry-After",
      respond: () =>
        new Response(null, { status: 429, headers: { "Retry-After": "600" } }),
      pusherKept: true,
      jobStatus: "retry_wait",
      retried: true,
      minDelaySeconds: 600,
    },
    {
      name: "408",
      respond: () => new Response(null, { status: 408 }),
      pusherKept: true,
      jobStatus: "retry_wait",
      retried: true,
    },
    {
      name: "503",
      respond: () => new Response(null, { status: 503 }),
      pusherKept: true,
      jobStatus: "retry_wait",
      retried: true,
    },
    {
      name: "transport error",
      respond: () => {
        throw new TypeError("network down");
      },
      pusherKept: true,
      jobStatus: "retry_wait",
      retried: true,
    },
    {
      name: "403",
      respond: () => new Response(null, { status: 403 }),
      pusherKept: true,
      jobStatus: "delivered",
      retried: false,
    },
    {
      name: "400",
      respond: () => new Response(null, { status: 400 }),
      pusherKept: true,
      jobStatus: "delivered",
      retried: false,
    },
    {
      name: "301",
      respond: () =>
        new Response(null, {
          status: 301,
          headers: { Location: "https://elsewhere.example/push" },
        }),
      pusherKept: true,
      jobStatus: "delivered",
      retried: false,
    },
  ];
  for (const testCase of cases) {
    const db = await freshDb();
    const alice = actor("alice");
    await seedActor(db, alice);
    await seedActor(db, actor("bob"));
    const agent = await createTestUserAgent();
    await post(appFor(db, alice), webPushBody(agent));
    await seedNotification(db, alice, actor("bob"), "public");
    const { sent, env } = queueEnv(db);
    await enqueuePendingNotificationPushJobs(env);
    const { requests, retries } = await runJob(env, sent[0]!, testCase.respond);

    const label = testCase.name;
    expect({ label, calls: requests.length }).toEqual({ label, calls: 1 });
    const pushers = await db.select().from(notificationPushers);
    expect({ label, kept: pushers.length === 1 }).toEqual({
      label,
      kept: testCase.pusherKept,
    });
    const job = (await db.select().from(notificationPushJobs))[0]!;
    expect({ label, status: job.status }).toEqual({
      label,
      status: testCase.jobStatus,
    });
    expect({ label, retried: retries.length > 0 }).toEqual({
      label,
      retried: testCase.retried,
    });
    if (testCase.minDelaySeconds !== undefined) {
      expect(retries[0]).toBeGreaterThanOrEqual(testCase.minDelaySeconds);
    }
    if (["403", "400", "301"].includes(label)) {
      expect(job.lastError).toContain("web push");
    }
  }
});

test("one job fans out to gateway pushers and webpush subscriptions separately", async () => {
  const db = await freshDb();
  const alice = actor("alice");
  await seedActor(db, alice);
  await seedActor(db, actor("bob"));
  const agent = await createTestUserAgent();
  const app = appFor(db, alice);
  await post(app, webPushBody(agent));
  await post(
    app,
    {
      product: "yurucommu",
      pusher: {
        kind: "http",
        app_id: "jp.takos.yurucommu",
        pushkey: "fcm-token",
        data: { url: GATEWAY_URL },
      },
    },
    baseEnv({
      YURUCOMMU_NOTIFICATION_PUSH_GATEWAY_ALLOWED_HOSTS: "push.example",
    }),
  );
  await seedNotification(db, alice, actor("bob"), "public");
  const { sent, env } = queueEnv(db, {
    YURUCOMMU_NOTIFICATION_PUSH_GATEWAY_ALLOWED_HOSTS: "push.example",
  });
  await enqueuePendingNotificationPushJobs(env);
  const { requests } = await runJob(env, sent[0]!, (request) =>
    request.url === GATEWAY_URL
      ? Response.json({ rejected: [] })
      : new Response(null, { status: 201 }),
  );
  expect(requests.map((request) => request.url).sort()).toEqual(
    [ENDPOINT, GATEWAY_URL].sort(),
  );
  const gateway = requests.find((request) => request.url === GATEWAY_URL)!;
  const envelope = JSON.parse(new TextDecoder().decode(gateway.body));
  expect(
    envelope.notification.devices.map((d: { pushkey: string }) => d.pushkey),
  ).toEqual(["fcm-token"]);
  const direct = requests.find((request) => request.url === ENDPOINT)!;
  expect((await decodePayload(direct, agent)).web_push).toBe(8030);
  const job = (await db.select().from(notificationPushJobs))[0]!;
  expect(job.status).toBe("delivered");
});

test("without a valid ENCRYPTION_KEY delivery records a failure and keeps the subscription", async () => {
  const db = await freshDb();
  const alice = actor("alice");
  await seedActor(db, alice);
  await seedActor(db, actor("bob"));
  const agent = await createTestUserAgent();
  await post(appFor(db, alice), webPushBody(agent));
  await seedNotification(db, alice, actor("bob"), "public");
  const { sent, env } = queueEnv(db, { ENCRYPTION_KEY: "rotated-away" });
  await enqueuePendingNotificationPushJobs(env);
  const { requests, retries } = await runJob(env, sent[0]!, () => {
    throw new Error("must not be called");
  });
  expect(requests).toHaveLength(0);
  expect(retries).toHaveLength(0);
  expect(await db.select().from(notificationPushers)).toHaveLength(1);
  const job = (
    await db
      .select()
      .from(notificationPushJobs)
      .where(eq(notificationPushJobs.actorApId, alice.ap_id))
  )[0]!;
  expect(job.status).toBe("delivered");
  expect(job.lastError).toContain("ENCRYPTION_KEY");
});
