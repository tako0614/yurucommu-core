import { expect, test } from "bun:test";
import { CallSignalingDurableObject } from "../../runtime/call-signaling-do.ts";
import type { CallRecord } from "../../runtime/call-hub-core.ts";

test("Cloudflare message awaits durable call write before eviction and rehydrates on wake", async () => {
  const values = new Map<string, unknown>([
    ["actor", "https://local.example/alice"],
  ]);
  const frames: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let pending: number | null = null;
  const socket = {
    send: (data: string) => {
      frames.push(data);
    },
    close: () => {},
  };
  const state = {
    storage: {
      get: async <T>(key: string) =>
        structuredClone(values.get(key)) as T | undefined,
      put: async (key: string, value: unknown) => {
        if (key.startsWith("call:")) await gate;
        values.set(key, structuredClone(value));
      },
      delete: async (key: string) => values.delete(key),
      list: async <T>(options?: { prefix?: string }) =>
        new Map(
          [...values].filter(([key]) => key.startsWith(options?.prefix ?? "")),
        ) as Map<string, T>,
      getAlarm: async () => pending,
      setAlarm: async (at: number) => {
        pending = at;
      },
    },
    acceptWebSocket: () => {},
    getWebSockets: () => [socket],
  };
  const statement = {
    bind: (..._params: unknown[]) => statement,
    run: async () => ({ success: true, meta: { changes: 1 } }),
  };
  const env = {
    APP_URL: "https://local.example",
    DB: { prepare: () => statement },
  } as unknown as ConstructorParameters<typeof CallSignalingDurableObject>[1];
  let settled = false;
  const event = new CallSignalingDurableObject(state, env)
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
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
  } finally {
    release();
    await event;
  }
  expect((values.get("call:one") as CallRecord).state).toBe("ringing");
  await new CallSignalingDurableObject(state, env).webSocketMessage(
    socket,
    '{"t":"resume","callId":"one"}',
  );
  expect(JSON.parse(frames.at(-1)!)).toEqual({
    t: "call-state",
    callId: "one",
    state: "ringing",
  });
});
