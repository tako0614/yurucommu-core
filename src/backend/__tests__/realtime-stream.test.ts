/**
 * Realtime stream tests: the RealtimeStreamDO event buffer/ticket logic (run
 * against an in-memory fake of the DO state surface) and the /api/realtime
 * routes' capability gating.
 */

import { describe, expect, test } from "bun:test";
import { RealtimeStreamDO } from "../runtime/realtime-stream-do.ts";
import { parseRealtimeServerFrame } from "../../../packages/api/src/types/realtime.ts";

// --- Fake DO state (KV storage + hibernatable socket registry) --------------

class FakeStorage {
  private readonly map = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined;
  }
  async put(key: string, value: unknown): Promise<void> {
    this.map.set(key, value);
  }
  async delete(key: string): Promise<boolean> {
    return this.map.delete(key);
  }
  async list<T>(options?: { prefix?: string }): Promise<Map<string, T>> {
    const out = new Map<string, T>();
    const keys = [...this.map.keys()].sort();
    for (const key of keys) {
      if (!options?.prefix || key.startsWith(options.prefix)) {
        out.set(key, this.map.get(key) as T);
      }
    }
    return out;
  }
}

class FakeSocket {
  readonly frames: unknown[] = [];
  closed = false;

  send(data: string): void {
    this.frames.push(JSON.parse(data));
  }
  close(): void {
    this.closed = true;
  }
}

function createFakeState() {
  const sockets: FakeSocket[] = [];
  return {
    state: {
      storage: new FakeStorage(),
      acceptWebSocket(ws: FakeSocket) {
        sockets.push(ws);
      },
      getWebSockets() {
        return sockets;
      },
    },
    sockets,
  };
}

function makeDo() {
  const { state, sockets } = createFakeState();
  const streamDo = new RealtimeStreamDO(
    state as unknown as ConstructorParameters<typeof RealtimeStreamDO>[0],
  );
  return { streamDo, state, sockets };
}

async function emit(
  streamDo: RealtimeStreamDO,
  type: string,
  data: Record<string, unknown> = {},
): Promise<Response> {
  return streamDo.fetch(
    new Request("https://realtime-do/_emit", {
      method: "POST",
      body: JSON.stringify({ type, data }),
    }),
  );
}

describe("RealtimeStreamDO", () => {
  test("emit assigns monotonic ids and broadcasts to connected sockets", async () => {
    const { streamDo, sockets } = makeDo();
    const socket = new FakeSocket();
    sockets.push(socket);

    const first = await emit(streamDo, "unread", { talk_total: 1 });
    const second = await emit(streamDo, "talk.message", { kind: "dm" });
    expect(((await first.json()) as { id: number }).id).toBe(1);
    expect(((await second.json()) as { id: number }).id).toBe(2);

    expect(socket.frames).toHaveLength(2);
    const frame = parseRealtimeServerFrame(socket.frames[1]);
    expect(frame?.t).toBe("event");
    if (frame?.t === "event") {
      expect(frame.event.id).toBe(2);
      expect(frame.event.type).toBe("talk.message");
    }
  });

  test("hello replays the missed gap from the ring buffer", async () => {
    const { streamDo, sockets } = makeDo();
    for (let i = 0; i < 5; i++) await emit(streamDo, "unread", { seq: i });

    const socket = new FakeSocket();
    sockets.push(socket);
    await streamDo.webSocketMessage(
      socket as never,
      JSON.stringify({ t: "hello", lastEventId: 3 }),
    );

    // Replays events 4 and 5, then hello_ok with the current head.
    const types = socket.frames.map((f) => (f as { t: string }).t);
    expect(types).toEqual(["event", "event", "hello_ok"]);
    const replayed = socket.frames
      .filter(
        (f): f is { t: "event"; event: { id: number } } =>
          (f as { t: string }).t === "event",
      )
      .map((f) => f.event.id);
    expect(replayed).toEqual([4, 5]);
    const helloOk = socket.frames.at(-1) as { lastEventId: number };
    expect(helloOk.lastEventId).toBe(5);
  });

  test("hello answers resync when the gap predates the ring buffer", async () => {
    const { streamDo, sockets } = makeDo();
    // Overflow the 200-event buffer so event 1 is pruned.
    for (let i = 0; i < 205; i++) await emit(streamDo, "unread", {});

    const socket = new FakeSocket();
    sockets.push(socket);
    await streamDo.webSocketMessage(
      socket as never,
      JSON.stringify({ t: "hello", lastEventId: 1 }),
    );

    const types = socket.frames.map((f) => (f as { t: string }).t);
    expect(types[0]).toBe("resync");
    expect(types.at(-1)).toBe("hello_ok");
  });

  test("tickets are single-use and reject unknown values", async () => {
    const { streamDo } = makeDo();
    const minted = await streamDo.fetch(
      new Request("https://realtime-do/_ticket", { method: "POST" }),
    );
    const { ticket } = (await minted.json()) as { ticket: string };
    expect(ticket.length).toBeGreaterThanOrEqual(32);

    const upgrade = (t: string, auth = "ticket") =>
      streamDo.fetch(
        new Request("https://realtime-do/_ws", {
          headers: {
            Upgrade: "websocket",
            "X-Realtime-Auth": auth,
            "X-Realtime-Ticket": t,
          },
        }),
      );

    // Wrong ticket refused; correct ticket consumed exactly once.
    expect((await upgrade("bogus")).status).toBe(401);
    // (The fake state cannot mint a real WebSocketPair, so a VALID ticket
    // throws past auth into the pair constructor — proving it was accepted.)
    await expect(upgrade(ticket)).rejects.toThrow();
    // Replay of the consumed ticket is refused before the pair constructor.
    expect((await upgrade(ticket)).status).toBe(401);
  });

  test("upgrade without a recognized auth mode is refused", async () => {
    const { streamDo } = makeDo();
    const response = await streamDo.fetch(
      new Request("https://realtime-do/_ws", {
        headers: { Upgrade: "websocket" },
      }),
    );
    expect(response.status).toBe(401);
  });
});

describe("/api/realtime routes", () => {
  test("config reports unavailable and socket 503 without the DO binding", async () => {
    const { createYurucommuBackendApp } = await import("../index.ts");
    const app = createYurucommuBackendApp();
    const env = { APP_URL: "https://test.local", DB_INSTANCE: {} };

    const config = await app.fetch(
      new Request("https://test.local/api/realtime/config"),
      env as never,
    );
    expect(config.status).toBe(200);
    expect(await config.json()).toEqual({ available: false });

    const socket = await app.fetch(
      new Request("https://test.local/api/realtime/socket"),
      env as never,
    );
    expect(socket.status).toBe(503);
  });
});
