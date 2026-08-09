import { expect, test } from "bun:test";
import { Hono } from "hono";

import type { Actor, Env, Variables } from "../../types.ts";
import rtcRoutes from "../../routes/rtc/index.ts";
import { CallSignalingDurableObject } from "../../runtime/call-signaling-do.ts";

class FakeStorage {
  private readonly values = new Map<string, unknown>();
  private alarmAt: number | null = null;

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    return this.values.delete(key);
  }

  async list<T>(options?: { prefix?: string }): Promise<Map<string, T>> {
    const result = new Map<string, T>();
    for (const [key, value] of this.values) {
      if (!options?.prefix || key.startsWith(options.prefix)) {
        result.set(key, value as T);
      }
    }
    return result;
  }

  async setAlarm(scheduledTime: number): Promise<void> {
    this.alarmAt = scheduledTime;
  }

  async getAlarm(): Promise<number | null> {
    return this.alarmAt;
  }
}

function makeCallDo() {
  const sockets: unknown[] = [];
  const state = {
    storage: new FakeStorage(),
    acceptWebSocket(socket: unknown) {
      sockets.push(socket);
    },
    getWebSockets() {
      return sockets;
    },
  };
  const callDo = new CallSignalingDurableObject(
    state as unknown as ConstructorParameters<
      typeof CallSignalingDurableObject
    >[0],
    {} as ConstructorParameters<typeof CallSignalingDurableObject>[1],
  );
  return { callDo, state };
}

function makeRoutes() {
  const { callDo } = makeCallDo();
  const stub = {
    fetch(input: RequestInfo | URL, init?: RequestInit) {
      const request =
        input instanceof Request ? input : new Request(input, init);
      return callDo.fetch(request);
    },
  };
  const namespace = {
    idFromName() {
      return {};
    },
    get() {
      return stub;
    },
  };
  const env = {
    APP_URL: "https://server.example",
    CALL_SIGNALING: namespace,
  } as unknown as Env;
  const actor = {
    ap_id: "https://server.example/ap/users/owner",
    preferred_username: "owner",
  } as Actor;
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", {} as never);
    c.set("actor", c.req.header("x-test-auth") ? actor : null);
    await next();
  });
  app.route("/", rtcRoutes);
  return { app, env, actor, callDo };
}

test("cross-origin call sockets authenticate with a one-time ticket", async () => {
  const { app, env, actor, callDo } = makeRoutes();

  const unauthenticatedMint = await app.fetch(
    new Request("https://server.example/api/rtc/ticket", { method: "POST" }),
    env,
  );
  expect(unauthenticatedMint.status).toBe(401);

  const minted = await app.fetch(
    new Request("https://server.example/api/rtc/ticket", {
      method: "POST",
      headers: { "x-test-auth": "owner" },
    }),
    env,
  );
  expect(minted.status).toBe(200);
  const body = (await minted.json()) as {
    ticket?: string;
    actor_ap_id?: string;
  };
  expect(body.ticket?.length).toBeGreaterThanOrEqual(32);
  expect(body.actor_ap_id).toBe(actor.ap_id);

  const sessionOnly = await app.fetch(
    new Request("https://server.example/api/rtc/socket", {
      headers: { Upgrade: "websocket", "x-test-auth": "owner" },
    }),
    env,
  );
  expect(sessionOnly.status).toBe(401);

  const socketRequest = (ticket: string) =>
    new Request(
      `https://server.example/api/rtc/socket?actor=${encodeURIComponent(actor.ap_id)}&ticket=${encodeURIComponent(ticket)}`,
      { headers: { Upgrade: "websocket" } },
    );

  const unknown = await app.fetch(socketRequest("not-a-ticket"), env);
  expect(unknown.status).toBe(401);

  const trustedUpgrade = (ticket: string) =>
    callDo.fetch(
      new Request("https://call-do/_ws", {
        headers: {
          Upgrade: "websocket",
          "X-Call-Actor": actor.ap_id,
          "X-Call-Auth": "ticket",
          "X-Call-Ticket": ticket,
        },
      }),
    );

  // A valid ticket reaches WebSocketPair construction. Bun does not expose the
  // Cloudflare global, so that point throws after authentication succeeds.
  await expect(trustedUpgrade(body.ticket!)).rejects.toThrow();

  // The ticket was consumed before the upgrade and cannot be replayed.
  const replay = await trustedUpgrade(body.ticket!);
  expect(replay.status).toBe(401);
});

test("Call DO refuses actor-header-only upgrades from an untrusted caller", async () => {
  const { callDo } = makeCallDo();
  const response = await callDo.fetch(
    new Request("https://call-do/_ws", {
      headers: {
        Upgrade: "websocket",
        "X-Call-Actor": "https://server.example/ap/users/owner",
      },
    }),
  );
  expect(response.status).toBe(401);
});
