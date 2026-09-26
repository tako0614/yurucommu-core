/**
 * Realtime stream tests: the RealtimeStreamDO event buffer/ticket logic (run
 * against an in-memory fake of the DO state surface) and the /api/realtime
 * routes' capability gating.
 */

import { describe, expect, spyOn, test } from "bun:test";
import { RealtimeStreamDO } from "../runtime/realtime-stream-do.ts";
import { getRealtimeHub } from "../runtime/realtime-hub.ts";
import {
  MAX_REALTIME_CONTROL_BYTES,
  MAX_REALTIME_EVENT_BYTES,
  parseRealtimeServerFrame,
} from "../../../packages/api/src/types/realtime.ts";

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

function paddedJson(value: Record<string, unknown>, bytes: number): string {
  const overhead = new TextEncoder().encode(
    JSON.stringify({ ...value, padding: "" }),
  ).byteLength;
  const remaining = bytes - overhead;
  return JSON.stringify({
    ...value,
    padding: "あ".repeat(Math.floor(remaining / 3)) + "a".repeat(remaining % 3),
  });
}

describe("RealtimeStreamDO", () => {
  test("rejects malformed event envelopes before storage or fanout", async () => {
    for (const body of [
      "null",
      "[]",
      "42",
      '"unread"',
      "{",
      JSON.stringify({ type: "unknown", data: {} }),
      ...[undefined, null, [], "text", 1, false].map((data) =>
        JSON.stringify({ type: "unread", data }),
      ),
    ]) {
      const { streamDo, state, sockets } = makeDo();
      const socket = new FakeSocket();
      sockets.push(socket);
      const get = spyOn(state.storage, "get");
      const response = await streamDo.fetch(
        new Request("https://realtime-do/_emit", { method: "POST", body }),
      );
      expect(response.status).toBe(400);
      expect(get).not.toHaveBeenCalled();
      expect(await state.storage.list()).toEqual(new Map());
      expect(socket.frames).toEqual([]);
    }
  });

  test("bounds the actual streamed bytes without trusting Content-Length", async () => {
    for (const declaredLength of [undefined, "1"]) {
      const { streamDo, state, sockets } = makeDo();
      const socket = new FakeSocket();
      sockets.push(socket);
      let pulls = 0;
      let cancelled = false;
      // Valid JSON would exceed 1 MiB. Chunks after the limit must not be read.
      const chunks = [
        new TextEncoder().encode('{"type":"unread","data":{"padding":"'),
        new Uint8Array(1024 * 1024).fill(97),
        new TextEncoder().encode('"}}'),
      ];
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (pulls < chunks.length) controller.enqueue(chunks[pulls++]);
            else controller.close();
          },
          cancel() {
            cancelled = true;
          },
        },
        { highWaterMark: 0 },
      );
      const parse = spyOn(JSON, "parse");
      try {
        const response = await streamDo.fetch(
          new Request("https://realtime-do/_emit", {
            method: "POST",
            body,
            headers: declaredLength ? { "Content-Length": declaredLength } : {},
          }),
        );
        expect(response.status).toBe(413);
        expect(parse).not.toHaveBeenCalled();
      } finally {
        parse.mockRestore();
      }
      expect(pulls).toBe(2);
      expect(cancelled).toBe(true);
      expect(await state.storage.list()).toEqual(new Map());
      expect(socket.frames).toEqual([]);
    }
  });

  test("rejects an oversized declared body before reading or parsing it", async () => {
    const { streamDo, state } = makeDo();
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls++;
          controller.close();
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const parse = spyOn(JSON, "parse");
    try {
      const response = await streamDo.fetch(
        new Request("https://realtime-do/_emit", {
          method: "POST",
          body,
          headers: { "Content-Length": String(MAX_REALTIME_EVENT_BYTES + 1) },
        }),
      );
      expect(response.status).toBe(413);
      expect(parse).not.toHaveBeenCalled();
      expect(pulls).toBe(0);
      expect(cancelled).toBe(true);
      expect(await state.storage.list()).toEqual(new Map());
    } finally {
      parse.mockRestore();
    }
  });

  test("accepts exact UTF-8 event budget across split chunks but rejects one byte more", async () => {
    const raw = paddedJson(
      { type: "talk.message", data: { kind: "dm" } },
      MAX_REALTIME_EVENT_BYTES,
    );
    const bytes = new TextEncoder().encode(raw);
    expect(bytes.byteLength).toBe(MAX_REALTIME_EVENT_BYTES);
    const { streamDo, state, sockets } = makeDo();
    const socket = new FakeSocket();
    sockets.push(socket);
    // Split within the UTF-8 padding rather than at a code point boundary.
    const split = bytes.indexOf(0xe3) + 1;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, split));
        controller.enqueue(bytes.slice(split));
        controller.close();
      },
    });
    expect(
      (
        await streamDo.fetch(
          new Request("https://realtime-do/_emit", { method: "POST", body }),
        )
      ).status,
    ).toBe(200);
    expect(await state.storage.get<number>("seq")).toBe(1);
    expect(socket.frames).toHaveLength(1);
    expect(
      (
        await streamDo.fetch(
          new Request("https://realtime-do/_emit", {
            method: "POST",
            body: raw + " ",
          }),
        )
      ).status,
    ).toBe(413);
    expect(await state.storage.get<number>("seq")).toBe(1);
    expect(socket.frames).toHaveLength(1);
  });

  test("rejects malformed UTF-8 and interrupted streams without side effects", async () => {
    for (const body of [
      new Uint8Array([0x7b, 0x22, 0xc3, 0x28]),
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(new Error("broken stream"));
        },
      }),
    ]) {
      const { streamDo, state } = makeDo();
      expect(
        (
          await streamDo.fetch(
            new Request("https://realtime-do/_emit", { method: "POST", body }),
          )
        ).status,
      ).toBe(400);
      expect(await state.storage.list()).toEqual(new Map());
    }
  });

  test("caps UTF-8 control bytes before JSON parsing and ignores invalid cursors", async () => {
    const { streamDo, state } = makeDo();
    const socket = new FakeSocket();
    const parse = spyOn(JSON, "parse");
    const get = spyOn(state.storage, "get");
    try {
      await streamDo.webSocketMessage(
        socket,
        JSON.stringify({ t: "hello", padding: "あ".repeat(400) }),
      );
      expect(parse).not.toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
      expect(socket.frames).toEqual([]);
    } finally {
      parse.mockRestore();
    }
    for (const lastEventId of [
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      "1",
      null,
    ]) {
      await streamDo.webSocketMessage(
        socket,
        JSON.stringify({ t: "hello", lastEventId }),
      );
    }
    expect(get).not.toHaveBeenCalled();
    expect(socket.frames).toEqual([]);
  });

  test("accepts exact UTF-8 control budget, preserves hello/ping/pong, ignores malformed and binary", async () => {
    const { streamDo } = makeDo();
    const socket = new FakeSocket();
    const raw = paddedJson(
      { t: "hello", lastEventId: 0 },
      MAX_REALTIME_CONTROL_BYTES,
    );
    expect(new TextEncoder().encode(raw).byteLength).toBe(
      MAX_REALTIME_CONTROL_BYTES,
    );
    await streamDo.webSocketMessage(socket, raw);
    await streamDo.webSocketMessage(socket, '{"t":"ping"}');
    await streamDo.webSocketMessage(socket, '{"t":"pong"}');
    await streamDo.webSocketMessage(socket, raw + " ");
    await streamDo.webSocketMessage(socket, "{");
    await streamDo.webSocketMessage(socket, "null");
    await streamDo.webSocketMessage(socket, new ArrayBuffer(2));
    expect(socket.frames).toEqual([
      { t: "hello_ok", lastEventId: 0 },
      { t: "pong" },
    ]);
    await streamDo.webSocketMessage(socket, '{"t":"hello"}');
    await streamDo.webSocketMessage(
      socket,
      JSON.stringify({ t: "hello", lastEventId: Number.MAX_SAFE_INTEGER }),
    );
    expect(socket.frames).toHaveLength(4);
  });

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

describe("realtime hub ingress policy", () => {
  test("keeps all existing event types and producer-shaped message payloads unchanged", async () => {
    const { streamDo, sockets } = makeDo();
    const socket = new FakeSocket();
    sockets.push(socket);
    const hub = getRealtimeHub({
      REALTIME_STREAM: {
        idFromName: (actor: string) => actor,
        get: () => ({
          fetch: (url: string, init: RequestInit) =>
            streamDo.fetch(new Request(url, init)),
        }),
      },
    } as never);
    const message = {
      id: "https://test.local/objects/1",
      sender: {
        ap_id: "https://test.local/users/alice",
        username: "alice",
        preferred_username: "alice",
        name: "Alice",
        icon_url: null,
      },
      content: "あ".repeat(5000),
      attachments: Array.from({ length: 8 }, (_, i) => ({
        type: "image",
        url: `/media/${i}.png`,
        name: "あ".repeat(1000),
      })),
      created_at: "2026-09-26T00:00:00.000Z",
    };
    const events = [
      {
        type: "talk.message",
        data: {
          kind: "dm",
          other_ap_id: "https://test.local/users/bob",
          conversation_id: "conversation",
          message,
        },
      },
      {
        type: "talk.message",
        data: {
          kind: "community",
          community_ap_id: "https://test.local/communities/1",
          message,
        },
      },
      {
        type: "talk.typing",
        data: {
          other_ap_id: "https://test.local/users/alice",
          is_typing: true,
          typed_at: message.created_at,
        },
      },
      {
        type: "talk.read",
        data: {
          other_ap_id: "https://test.local/users/alice",
          conversation_id: "conversation",
          last_read_at: message.created_at,
        },
      },
      { type: "talk.contacts_changed", data: {} },
      { type: "notification.new", data: {} },
      {
        type: "unread",
        data: { dm: 1, community: 2, talk_total: 3, notifications: 4 },
      },
    ];
    for (const event of events) await hub.emit("alice", event.type, event.data);
    expect(socket.frames).toEqual(
      events.map((event, i) => ({
        t: "event",
        event: { id: i + 1, ...event },
      })),
    );
  });

  test("accepts exact serialized UTF-8 event budget and preserves Null hub no-op", async () => {
    const forwarded: string[] = [];
    const hub = getRealtimeHub({
      REALTIME_STREAM: {
        idFromName: (actor: string) => actor,
        get: () => ({
          fetch: async (_url: string, init: RequestInit) => {
            forwarded.push(init.body as string);
            return Response.json({ id: 1 });
          },
        }),
      },
    } as never);
    const data = { padding: "" };
    const overhead = new TextEncoder().encode(
      JSON.stringify({ type: "unread", data }),
    ).byteLength;
    const remaining = MAX_REALTIME_EVENT_BYTES - overhead;
    data.padding =
      "あ".repeat(Math.floor(remaining / 3)) + "a".repeat(remaining % 3);
    await hub.emit("alice", "unread", data);
    expect(new TextEncoder().encode(forwarded[0]).byteLength).toBe(
      MAX_REALTIME_EVENT_BYTES,
    );
    await expect(
      hub.emit("alice", "unread", { padding: data.padding + "a" }),
    ).rejects.toThrow();
    expect(forwarded).toHaveLength(1);
    await expect(
      getRealtimeHub({} as never).emit("alice", "unknown", {}),
    ).resolves.toBeUndefined();
  });

  test("rejects invalid or oversized events before contacting the DO", async () => {
    const forwarded: unknown[] = [];
    const hub = getRealtimeHub({
      REALTIME_STREAM: {
        idFromName: (actor: string) => actor,
        get: () => ({
          fetch: async (...args: unknown[]) => {
            forwarded.push(args);
            return Response.json({ id: 1 });
          },
        }),
      },
    } as never);
    for (const [type, data] of [
      ["unknown", {}],
      ["unread", []],
      ["unread", null],
      ["talk.message", { content: "あ".repeat(400_000) }],
    ] as const) {
      await expect(hub.emit("alice", type, data as never)).rejects.toThrow();
    }
    expect(forwarded).toEqual([]);
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
