import { expect, test } from "bun:test";
import type { InArgs } from "@libsql/client";
import { actors } from "../../../db/index.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";
import { CallSignalingDurableObject } from "../../runtime/call-signaling-do.ts";
import type { CallRecord } from "../../runtime/call-hub-core.ts";

test("Cloudflare reentrant transitions await ordered snapshots before eviction", async () => {
  const fixture = await createTestDb();
  try {
    await fixture.db.insert(actors).values({
      apId: "https://local.example/alice",
      type: "Person",
      preferredUsername: "alice",
      inbox: "https://local.example/alice/inbox",
      outbox: "https://local.example/alice/outbox",
      followersUrl: "https://local.example/alice/followers",
      followingUrl: "https://local.example/alice/following",
      publicKeyPem: "unused-isolated-fixture",
      privateKeyPem: "unused-isolated-fixture",
    });
    const values = new Map<string, unknown>([
      ["actor", "https://local.example/alice"],
    ]);
    let writeStarted!: () => void;
    const firstWrite = new Promise<void>((resolve) => {
      writeStarted = resolve;
    });
    let connectingStarted!: () => void;
    const connecting = new Promise<void>((resolve) => {
      connectingStarted = resolve;
    });
    const frames: string[] = [];
    const writtenStates: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let pending: number | null = null;
    const socket = {
      send: (data: string) => {
        frames.push(data);
        const frame = JSON.parse(data);
        if (frame.t === "call-state" && frame.state === "connecting")
          connectingStarted();
      },
      close: () => {},
    };
    const state = {
      storage: {
        get: async <T>(key: string) =>
          structuredClone(values.get(key)) as T | undefined,
        put: async (key: string, value: unknown) => {
          if (key.startsWith("call:")) {
            writeStarted();
            await gate;
            writtenStates.push((value as CallRecord).state);
          }
          values.set(key, structuredClone(value));
        },
        delete: async (key: string) => values.delete(key),
        list: async <T>(options?: { prefix?: string }) =>
          new Map(
            [...values].filter(([key]) =>
              key.startsWith(options?.prefix ?? ""),
            ),
          ) as Map<string, T>,
        getAlarm: async () => pending,
        setAlarm: async (at: number) => {
          pending = at;
        },
      },
      acceptWebSocket: () => {},
      getWebSockets: () => [socket],
    };
    // The actual D1 driver reads moderation authority before creating a call.
    // Execute those statements against this sanctioned, migrated local database.
    function prepare(text: string, args: InArgs = []) {
      const execute = () => fixture.client.execute({ sql: text, args });
      return {
        bind: (...params: unknown[]) => prepare(text, params as InArgs),
        run: async () => {
          const result = await execute();
          return { success: true, meta: { changes: result.rowsAffected } };
        },
        all: async () => ({ results: (await execute()).rows }),
        raw: async () => {
          const result = await execute();
          return result.rows.map((row) =>
            result.columns.map((column) => row[column]),
          );
        },
      };
    }
    const env = {
      APP_URL: "https://local.example",
      DB: { prepare },
    } as unknown as ConstructorParameters<typeof CallSignalingDurableObject>[1];
    let settled = false;
    let inboundSettled = false;
    let inbound: Promise<unknown> = Promise.resolve();
    const object = new CallSignalingDurableObject(state, env);
    const event = object
      .webSocketMessage(
        socket,
        JSON.stringify({
          t: "invite",
          callId: "one",
          to: "https://peer.example/bob",
          media: { audio: true, video: false },
        }),
      )
      .then(() => {
        settled = true;
      });
    try {
      await firstWrite;
      expect(settled).toBe(false);
      inbound = object
        .fetch(
          new Request("https://call-do/_ingest", {
            method: "POST",
            body: JSON.stringify({
              v: 1,
              type: "accept",
              callId: "one",
              from: "https://peer.example/bob",
              to: "https://local.example/alice",
              ts: Date.now(),
              ttlMs: 30000,
            }),
          }),
        )
        .then(() => {
          inboundSettled = true;
        });
      await connecting;
      expect(inboundSettled).toBe(false);
    } finally {
      release();
      await Promise.all([event, inbound]);
    }
    expect(writtenStates).toEqual(["ringing", "connecting"]);
    expect((values.get("call:one") as CallRecord).state).toBe("connecting");
    await new CallSignalingDurableObject(state, env).webSocketMessage(
      socket,
      '{"t":"resume","callId":"one"}',
    );
    expect(JSON.parse(frames.at(-1)!)).toEqual({
      t: "call-state",
      callId: "one",
      state: "connecting",
    });
  } finally {
    fixture.client.close();
  }
});

test("Cloudflare overlapping native events cannot consume another event's write failure", async () => {
  const object = new CallSignalingDurableObject({} as never, {} as never);
  // Unit-test native event/write ownership independently of peer timing.
  const lifecycle = object as unknown as {
    startEvent(): { firstWrite: number };
    trackWrite(work: () => Promise<void>): void;
    finishEvent(event: { firstWrite: number }): Promise<void>;
    pendingWrites: Map<number, unknown>;
  };
  const first = lifecycle.startEvent();
  const second = lifecycle.startEvent();
  lifecycle.trackWrite(async () => {
    throw new Error("durable write failed");
  });
  await expect(lifecycle.finishEvent(first)).rejects.toThrow(
    "durable write failed",
  );
  await expect(lifecycle.finishEvent(second)).rejects.toThrow(
    "durable write failed",
  );
  expect(lifecycle.pendingWrites.size).toBe(0);
  await lifecycle.finishEvent(lifecycle.startEvent());
});
