import { expect, test } from "bun:test";
import { CallSignalingDurableObject } from "../../runtime/call-signaling-do.ts";
import {
  CallHub,
  type CallRecord,
  type HubPort,
} from "../../runtime/call-hub-core.ts";
import type { CallPortFactory } from "../../runtime/call-signaling-runtime.ts";

test("native DO concurrent peer candidates do not hold admission across signed transport waits", async () => {
  const frames: string[] = [];
  const ids = ["https://a.example/alice", "https://b.example/bob"];
  const objects: CallSignalingDurableObject[] = [];
  let timeouts = 0;
  const socket = {
    send: (data: string) => {
      frames.push(data);
    },
    close: () => {},
  };
  for (let index = 0; index < 2; index++) {
    const actor = ids[index]!;
    const peer = ids[1 - index]!;
    const call: CallRecord = {
      callId: "one",
      peerApId: peer,
      direction: "outgoing",
      state: "connecting",
      media: { audio: true, video: false },
      sfuFocus: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const records = new Map<string, unknown>([
      ["actor", actor],
      ["call:one", call],
    ]);
    const state = {
      storage: {
        get: async <T>(key: string) =>
          structuredClone(records.get(key)) as T | undefined,
        put: async (key: string, value: unknown) => {
          records.set(key, structuredClone(value));
        },
        delete: async (key: string) => records.delete(key),
        list: async <T>(options?: { prefix?: string }) =>
          new Map(
            [...records].filter(([key]) =>
              key.startsWith(options?.prefix ?? ""),
            ),
          ) as Map<string, T>,
        getAlarm: async () => null,
        setAlarm: async () => {},
      },
      getWebSockets: () => [socket],
      acceptWebSocket: () => {},
    };
    const port: HubPort = {
      localActorApId: actor,
      hasClients: () => true,
      broadcast: (frame) => socket.send(JSON.stringify(frame)),
      now: () => Date.now(),
      provisionMedia: async () => ({ iceServers: [], sfuFocus: null }),
      sendToPeer: async (envelope) => {
        // Same awaited peer/_ingest shape as signed sendCallSignal -> rtc route.
        // Short injected timeout models the production transport's 8s bound.
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const response = await Promise.race([
            objects[1 - index]!.fetch(
              new Request("https://peer/_ingest", {
                method: "POST",
                body: JSON.stringify(envelope),
              }),
            ),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                timeouts++;
                reject(new Error("peer transport timeout"));
              }, 50);
            }),
          ]);
          if (!response.ok) throw new Error(`peer status ${response.status}`);
        } finally {
          clearTimeout(timer);
        }
      },
    };
    const object = new CallSignalingDurableObject(state, {} as never);
    // Inject only the application media/signing/history port. Both shapes are
    // retained here so the regression executes against the faulty shared-queue
    // adapter as well as the restored native cached-hub implementation.
    const seam = object as unknown as {
      runtime?: { createPort: CallPortFactory };
      hub?: CallHub;
    };
    if (seam.runtime)
      seam.runtime.createPort = (_actor, clients) => ({ ...port, ...clients });
    else {
      seam.hub = new CallHub(port);
      seam.hub.hydrate([structuredClone(call)]);
    }
    objects.push(object);
  }
  const message = JSON.stringify({
    t: "candidates",
    callId: "one",
    candidates: [{ candidate: "candidate:test" }],
  });
  await Promise.all(
    objects.map((object) => object.webSocketMessage(socket, message)),
  );
  expect(timeouts).toBe(0);
  expect(frames.map((frame) => JSON.parse(frame).t)).toEqual([
    "candidates",
    "candidates",
  ]);
});
