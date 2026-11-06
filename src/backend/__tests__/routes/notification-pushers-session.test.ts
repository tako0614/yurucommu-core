import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { createTestDb } from "../helpers/d1-semantics.ts";
import {
  activities,
  inbox,
  notificationPushers,
  objects,
  sessions,
} from "../../../db/index.ts";
import type { Env, Variables } from "../../types.ts";
import { hashSessionIdForEnv } from "../../lib/crypto.ts";
import { extractActorFromSession } from "../../lib/session-actor.ts";
import { MemoryKV } from "../../runtime/memory-kv.ts";
import { createActor } from "../../routes/auth-helpers.ts";
import authRoutes from "../../routes/auth.ts";
import pusherRoutes from "../../routes/notification-pushers.ts";
import {
  enqueuePendingNotificationPushJobs,
  processNotificationPushJob,
} from "../../lib/notification-push.ts";
import type { DeliveryNotificationPushMessageV1 } from "../../lib/delivery/types.ts";

const APP_URL = "https://native-session.test";
const GATEWAY = "https://push.example/_matrix/push/v1/notify";
const NEXT_GATEWAY = "https://push2.example/_matrix/push/v1/notify";

async function fixture() {
  const { db, client } = await createTestDb();
  try {
    const queued: DeliveryNotificationPushMessageV1[] = [];
    const env = {
      APP_URL,
      AUTH_PASSWORD_HASH: "native-push-fixture-password",
      YURUCOMMU_SESSION_HASH_SALT: "native-push-fixture-salt",
      ENCRYPTION_KEY: "00".repeat(32),
      KV: new MemoryKV(),
      DB_INSTANCE: db,
      YURUCOMMU_NOTIFICATION_PUSH_GATEWAY_ALLOWED_HOSTS:
        "push.example,push2.example",
      DELIVERY_QUEUE: {
        send: async (body: DeliveryNotificationPushMessageV1) => {
          queued.push(body);
        },
        sendBatch: async (
          batch: Array<{ body: DeliveryNotificationPushMessageV1 }>,
        ) => {
          queued.push(...batch.map((entry) => entry.body));
        },
      },
    } as unknown as Env;
    const owner = await createActor(db, env, {
      username: "owner",
      name: "Owner",
      takosUserId: "password:owner",
      role: "owner",
    });
    const sender = await createActor(db, env, {
      username: "sender",
      name: "Sender",
      takosUserId: "local:sender",
      role: "member",
    });
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use("*", async (c, next) => {
      c.set("db", db);
      c.set("actor", null);
      await extractActorFromSession(c);
      await next();
    });
    app.route("/api/auth", authRoutes);
    app.route("/api/notifications/pushers", pusherRoutes);
    const request = (
      path: string,
      method: string,
      token?: string,
      body?: unknown,
    ) =>
      app.request(
        path,
        {
          method,
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        env,
      );
    const login = async () => {
      const response = await request(
        "/api/auth/mobile/login",
        "POST",
        undefined,
        { password: "native-push-fixture-password" },
      );
      expect(response.status).toBe(200);
      return ((await response.json()) as { access_token: string }).access_token;
    };
    const register = async (
      token: string,
      key = "fixture-native-device",
      data: Record<string, unknown> = {},
    ) => {
      const response = await request(
        "/api/notifications/pushers",
        "POST",
        token,
        {
          product: "yurucommu",
          pusher: {
            kind: "http",
            app_id: "com.yurucommu",
            pushkey: key,
            data: {
              url: GATEWAY,
              format: "event_id_only",
              provider: "fcm",
              environment: "production",
              ...data,
            },
          },
        },
      );
      expect(response.status).toBe(200);
      return await response.json();
    };
    const notify = async (
      suffix = "event",
      beforeDispatch?: () => Promise<void>,
      gatewayReply?: () => Promise<Response>,
    ) => {
      const objectId = `${APP_URL}/ap/objects/${suffix}`,
        activityId = `${APP_URL}/ap/activities/${suffix}`;
      await db.insert(objects).values({
        apId: objectId,
        type: "Note",
        attributedTo: sender.apId,
        content: "fixture body",
        visibility: "public",
      });
      await db.insert(activities).values({
        apId: activityId,
        type: "Create",
        actorApId: sender.apId,
        objectApId: objectId,
        rawJson: "{}",
      });
      await db
        .insert(inbox)
        .values({ actorApId: owner.apId, activityApId: activityId, read: 0 });
      expect(await enqueuePendingNotificationPushJobs(env)).toBe(1);
      const message = queued.shift();
      expect(message).toBeDefined();
      await beforeDispatch?.();
      const requests: unknown[] = [],
        originalFetch = globalThis.fetch;
      globalThis.fetch = (async (input, init) => {
        expect([GATEWAY, NEXT_GATEWAY]).toContain(String(input));
        requests.push(JSON.parse(String(init?.body)));
        return gatewayReply
          ? await gatewayReply()
          : Response.json({ rejected: [] });
      }) as typeof fetch;
      let acked = false;
      try {
        await processNotificationPushJob(env, message!, {
          ack() {
            acked = true;
          },
          retry() {
            throw new Error("unexpected retry");
          },
        } as never);
        expect(acked).toBe(true);
        return requests;
      } finally {
        globalThis.fetch = originalFetch;
      }
    };
    return { db, client, env, owner, sender, request, login, register, notify };
  } catch (error) {
    client.close();
    throw error;
  }
}

test("native push stops after logout even when the concurrent unregister loses authentication", async () => {
  const f = await fixture();
  try {
    const token = await f.login();
    await f.register(token);
    expect((await f.request("/api/auth/logout", "POST", token)).status).toBe(
      200,
    );
    expect(
      (
        await f.request("/api/notifications/pushers", "DELETE", token, {
          product: "yurucommu",
          app_id: "com.yurucommu",
          pushkey: "fixture-native-device",
        })
      ).status,
    ).toBe(401);
    expect(await f.notify()).toHaveLength(0);
    expect(await f.db.select().from(notificationPushers)).toHaveLength(0);
  } finally {
    f.client.close();
  }
});

for (const ended of [
  "expired",
  "malformed expiry",
  "different member",
] as const) {
  test(`native push stops for a registering session with ${ended}`, async () => {
    const f = await fixture();
    try {
      const token = await f.login();
      await f.register(token);
      const key = await hashSessionIdForEnv(f.env, token);
      await f.db
        .update(sessions)
        .set(
          ended === "different member"
            ? { memberId: f.sender.apId }
            : {
                expiresAt:
                  ended === "expired"
                    ? new Date(Date.now() - 1).toISOString()
                    : "invalid expiry",
              },
        )
        .where(eq(sessions.id, key));
      expect(await f.notify()).toHaveLength(0);
      expect(await f.db.select().from(notificationPushers)).toHaveLength(0);
    } finally {
      f.client.close();
    }
  });
}

test("live native delivery preserves client data without exposing its server-owned session binding", async () => {
  const f = await fixture();
  try {
    const token = await f.login(),
      key = await hashSessionIdForEnv(f.env, token);
    const response = await f.register(token, "fixture-native-device", {
      custom: "keep",
      session: "untrusted-client-session",
    });
    const row = await f.db.select().from(notificationPushers).get();
    expect(JSON.parse(row!.dataJson).session).toBe(key);
    expect(JSON.stringify(response)).not.toContain(key);
    expect(response.pusher.data.session).toBeUndefined();
    const requests = await f.notify();
    expect(requests).toHaveLength(1);
    const devices = (
      requests[0] as {
        notification: { devices: Array<{ data: Record<string, unknown> }> };
      }
    ).notification.devices;
    expect(devices[0]!.data).toEqual({
      format: "event_id_only",
      provider: "fcm",
      environment: "production",
      custom: "keep",
    });
    expect(JSON.stringify(requests)).not.toContain(token);
    expect(JSON.stringify(requests)).not.toContain(key);
  } finally {
    f.client.close();
  }
});

test("an already queued native push is suppressed when logout commits before dispatch", async () => {
  const f = await fixture();
  try {
    const token = await f.login();
    await f.register(token);
    expect(
      await f.notify("queued", async () => {
        expect(
          (await f.request("/api/auth/logout", "POST", token)).status,
        ).toBe(200);
      }),
    ).toHaveLength(0);
  } finally {
    f.client.close();
  }
});

test("stale session cleanup cannot delete a device rebound while the session lookup was in flight", async () => {
  const f = await fixture();
  const execute = f.client.execute.bind(f.client);
  try {
    const old = await f.login();
    await f.register(old);
    const next = await f.login();
    expect((await f.request("/api/auth/logout", "POST", old)).status).toBe(200);
    let rebound = false;
    f.client.execute = (async (...args: Parameters<typeof execute>) => {
      const result = await execute(...args);
      const statement: unknown = args[0],
        sql =
          typeof statement === "string"
            ? statement
            : (statement as { sql: string }).sql;
      if (!rebound && /select "expires_at" from "sessions"/i.test(sql)) {
        rebound = true;
        // Preserve the real stale lookup result, but renew through the actual
        // authenticated route before its caller attempts compare-safe cleanup.
        await f.register(next);
      }
      return result;
    }) as typeof f.client.execute;
    expect(await f.notify("stale")).toHaveLength(0);
    expect(rebound).toBe(true);
    expect(await f.db.select().from(notificationPushers)).toHaveLength(1);
    f.client.execute = execute;
    expect(await f.notify("renewed")).toHaveLength(1);
  } finally {
    f.client.execute = execute;
    f.client.close();
  }
});

test("logout preserves a sibling device and a same-device registration renewed by a later session", async () => {
  const f = await fixture();
  try {
    const first = await f.login();
    await f.register(first);
    const next = await f.login();
    await f.register(next);
    await f.register(next, "sibling-device");
    expect((await f.request("/api/auth/logout", "POST", first)).status).toBe(
      200,
    );
    const requests = await f.notify();
    expect(requests).toHaveLength(1);
    const devices = (
      requests[0] as { notification: { devices: Array<{ pushkey: string }> } }
    ).notification.devices;
    expect(devices.map((d) => d.pushkey).sort()).toEqual([
      "fixture-native-device",
      "sibling-device",
    ]);
    expect(await f.db.select().from(notificationPushers)).toHaveLength(2);
  } finally {
    f.client.close();
  }
});

test("a stale gateway rejection cannot delete the device renewed while its HTTP request was in flight", async () => {
  const f = await fixture();
  try {
    const old = await f.login();
    await f.register(old);
    const next = await f.login();
    expect(
      await f.notify("rejected", undefined, async () => {
        await f.register(next);
        return Response.json({ rejected: ["fixture-native-device"] });
      }),
    ).toHaveLength(1);
    expect(await f.db.select().from(notificationPushers)).toHaveLength(1);
    expect(await f.notify("renewed-after-rejection")).toHaveLength(1);
  } finally {
    f.client.close();
  }
});

test("one gateway batch drops a signed-out device while delivering to its live sibling session", async () => {
  const f = await fixture();
  try {
    const old = await f.login();
    await f.register(old);
    const next = await f.login();
    await f.register(next, "sibling-device");
    expect((await f.request("/api/auth/logout", "POST", old)).status).toBe(200);
    const requests = await f.notify();
    expect(requests).toHaveLength(1);
    const devices = (
      requests[0] as { notification: { devices: Array<{ pushkey: string }> } }
    ).notification.devices;
    expect(devices.map((device) => device.pushkey)).toEqual(["sibling-device"]);
    expect(await f.db.select().from(notificationPushers)).toHaveLength(1);
  } finally {
    f.client.close();
  }
});

test("a stale gateway rejection cannot delete a same-session device moved to a new gateway", async () => {
  const f = await fixture();
  try {
    const token = await f.login();
    await f.register(token);
    const before = await f.db.select().from(notificationPushers).get();
    expect(
      await f.notify("moved-gateway", undefined, async () => {
        await f.register(token, "fixture-native-device", { url: NEXT_GATEWAY });
        const moved = await f.db.select().from(notificationPushers).get();
        expect(moved!.dataJson).toBe(before!.dataJson);
        expect(moved!.gatewayUrl).toBe(NEXT_GATEWAY);
        return Response.json({ rejected: ["fixture-native-device"] });
      }),
    ).toHaveLength(1);
    expect(await f.db.select().from(notificationPushers)).toHaveLength(1);
    expect(await f.notify("after-gateway-move")).toHaveLength(1);
  } finally {
    f.client.close();
  }
});
