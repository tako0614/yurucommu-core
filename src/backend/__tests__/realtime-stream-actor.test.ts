import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import type {
  ActorContext,
  ActorSocket,
  ActorSqlResult,
  ActorSqlValue,
} from "../runtime/actor-context.ts";
import { RealtimeStreamActor } from "../runtime/realtime-stream-actor.ts";
import {
  MAX_REALTIME_CONTROL_BYTES,
  MAX_REALTIME_EVENT_BYTES,
} from "../../../packages/api/src/types/realtime.ts";

const databases: Database[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});
const turn = { signal: new AbortController().signal };

class Socket implements ActorSocket {
  readonly id = `opaque:broker/id?${crypto.randomUUID()}`;
  readonly frames: unknown[] = [];
  attachment: Uint8Array | null = new Uint8Array(8192).fill(193);
  failSend = false;
  failClose = false;
  closed = false;
  async send(data: string | Uint8Array): Promise<void> {
    await Promise.resolve();
    if (this.failSend) throw new Error("socket_closed");
    if (typeof data !== "string") throw new Error("expected text frame");
    this.frames.push(JSON.parse(data));
  }
  async close(): Promise<void> {
    await Promise.resolve();
    this.closed = true;
    if (this.failClose) throw new Error("socket_closed");
  }
  async getAttachment(): Promise<Uint8Array | null> {
    return this.attachment?.slice() ?? null;
  }
  async setAttachment(value: Uint8Array | null): Promise<void> {
    if (value && value.byteLength > 8192)
      throw new Error("attachment_too_large");
    this.attachment = value?.slice() ?? null;
  }
}

function harness() {
  const db = new Database(":memory:");
  databases.push(db);
  const sockets: Socket[] = [];
  let failAppend = false;
  let failPart: number | undefined;
  const execute = (
    sql: string,
    params: readonly ActorSqlValue[] = [],
  ): ActorSqlResult => {
    // Application emits only scalar values. Refuse coercion in this SQL seam.
    const values = params.map((value) => {
      if (
        typeof value === "string" &&
        new TextEncoder().encode(value).byteLength > 1_000_000
      ) {
        throw new Error("Actor SQL TEXT value exceeds contract limit");
      }
      if (typeof value === "object" && value !== null)
        throw new Error("unexpected blob");
      return value;
    });
    if (failAppend && sql.startsWith("UPDATE realtime_head"))
      throw new Error("write failed");
    if (
      sql.startsWith("INSERT INTO realtime_events") &&
      params[1] === failPart
    ) {
      throw new Error("chunk write failed");
    }
    const before = db.query("SELECT total_changes() AS n").get() as {
      n: number;
    };
    const rows = db.query(sql).all(...values) as ActorSqlResult["rows"];
    for (const row of rows) {
      if (new TextEncoder().encode(JSON.stringify(row)).byteLength > 2_000_000)
        throw new Error("SQL row too large");
    }
    if (
      new TextEncoder().encode(JSON.stringify({ rows, rowsWritten: 0 }))
        .byteLength > 8_388_608
    )
      throw new Error("SQL result too large");
    const after = db.query("SELECT total_changes() AS n").get() as {
      n: number;
    };
    return { rows, rowsWritten: after.n - before.n };
  };
  // This harness tests app SQL and callbacks, not Host Response authority.
  // A real Response sentinel proves exact pass-through; it is NOT a 101 shim.
  const acceptedResponse = new Response(null, { status: 204 });
  const context: ActorContext = {
    id: "opaque actor id",
    storage: {
      async execute(sql, params) {
        return execute(sql, params);
      },
      async query(sql, params) {
        db.exec("BEGIN");
        try {
          return { ...execute(sql, params), rowsWritten: 0 };
        } finally {
          db.exec("ROLLBACK");
        }
      },
      async transaction(statements) {
        if (!statements.length || statements.length > 100)
          throw new Error("invalid transaction size");
        return db.transaction(() => ({
          results: statements.map(({ sql, params }) => execute(sql, params)),
        }))();
      },
    },
    alarm: {
      async get() {
        return null;
      },
      async set() {
        throw new Error("realtime must not schedule alarms");
      },
      async clear() {
        throw new Error("realtime must not own an alarm");
      },
    },
    sockets: {
      async accept() {
        const socket = new Socket();
        sockets.push(socket);
        return { response: acceptedResponse, socket };
      },
      async list() {
        return sockets.filter((socket) => !socket.closed);
      },
      async get(id) {
        return (
          sockets.find((socket) => socket.id === id && !socket.closed) ?? null
        );
      },
    },
  };
  return {
    db,
    context,
    sockets,
    acceptedResponse,
    failAppend() {
      failAppend = true;
    },
    failPart(part: number) {
      failPart = part;
    },
    async instance() {
      const actor = new RealtimeStreamActor(context, {});
      await actor.start(turn);
      return actor;
    },
    async fetch(request: Request) {
      // Deliberately no instance cache: each delivered event follows eviction.
      return (await this.instance()).fetch(request, turn);
    },
  };
}

const request = (path: string, init?: RequestInit) =>
  new Request(`https://realtime/${path}`, init);
const emitRequest = () =>
  request("_emit", {
    method: "POST",
    body: JSON.stringify({ type: "unread", data: {} }),
  });
const upgrade = (ticket?: string) =>
  request("_ws", {
    headers: {
      Upgrade: "websocket",
      "X-Realtime-Auth": ticket === undefined ? "session" : "ticket",
      "X-Realtime-Ticket": ticket ?? "",
    },
  });
async function mint(h: ReturnType<typeof harness>) {
  const response = await h.fetch(request("_ticket", { method: "POST" }));
  return ((await response.json()) as { ticket: string }).ticket;
}

describe("RealtimeStreamActor candidate", () => {
  test("compact numeric input may expand during serialization without lowering the wire budget", async () => {
    const h = harness();
    const body =
      '{"type":"unread","data":{"values":[' +
      Array(200_000).fill("1e20").join(",") +
      "]}}";
    expect(new TextEncoder().encode(body).byteLength).toBeLessThan(
      MAX_REALTIME_EVENT_BYTES,
    );
    expect(
      (await h.fetch(request("_emit", { method: "POST", body }))).status,
    ).toBe(200);
    const socket = new Socket();
    await (
      await h.instance()
    ).socketMessage(socket, '{"t":"hello","lastEventId":0}', turn);
    const frame = socket.frames[0] as { event: { data: { values: number[] } } };
    expect(frame.event.data.values).toHaveLength(200_000);
    expect(frame.event.data.values[199_999]).toBe(1e20);
    expect(socket.frames.at(-1)).toEqual({ t: "hello_ok", lastEventId: 1 });
  });

  test("chunk boundaries retain surrogate pairs through SQL and partial insert failure rolls back", async () => {
    const h = harness();
    const prefix =
      JSON.stringify({ id: 1, type: "unread", data: { text: "" } }).indexOf(
        '"text":"',
      ) + 8;
    const text = "a".repeat(249_999 - prefix) + "😀" + "b".repeat(260_000);
    const body = JSON.stringify({ type: "unread", data: { text } });
    expect(
      (await h.fetch(request("_emit", { method: "POST", body }))).status,
    ).toBe(200);
    const socket = new Socket();
    await (
      await h.instance()
    ).socketMessage(socket, '{"t":"hello","lastEventId":0}', turn);
    expect(socket.frames[0]).toEqual({
      t: "event",
      event: { id: 1, type: "unread", data: { text } },
    });
    const fail = harness();
    fail.failPart(1);
    await expect(
      fail.fetch(request("_emit", { method: "POST", body })),
    ).rejects.toThrow("chunk write failed");
    expect(fail.db.query("SELECT * FROM realtime_events").all()).toEqual([]);
    expect(await (await fail.fetch(request("_state"))).json()).toEqual({
      seq: 0,
      sockets: 0,
    });
  });

  test("reassembly rejects oversized or noncontiguous durable parts", async () => {
    for (const oversized of [false, true]) {
      const h = harness();
      await h.fetch(emitRequest());
      h.db.exec("DELETE FROM realtime_events");
      if (oversized) {
        for (let part = 0; part < 7; part++)
          h.db
            .query("INSERT INTO realtime_events VALUES (1, ?, ?)")
            .run(part, "a".repeat(999_999));
      } else {
        h.db.query("INSERT INTO realtime_events VALUES (1, 1, ?)").run("{}");
      }
      const socket = new Socket();
      await expect(
        (await h.instance()).socketMessage(
          socket,
          '{"t":"hello","lastEventId":0}',
          turn,
        ),
      ).rejects.toThrow(
        oversized
          ? "realtime stored event too large"
          : "invalid realtime event parts",
      );
      expect(socket.frames).toEqual([]);
    }
  });

  test("exact realtime byte budget fits narrower SQL values and replays across eviction", async () => {
    const h = harness();
    const overhead = JSON.stringify({
      type: "unread",
      data: { text: "" },
    }).length;
    const remaining = MAX_REALTIME_EVENT_BYTES - overhead;
    const text =
      "あ".repeat(Math.floor(remaining / 3)) + "a".repeat(remaining % 3);
    const body = JSON.stringify({ type: "unread", data: { text } });
    expect(new TextEncoder().encode(body).byteLength).toBe(
      MAX_REALTIME_EVENT_BYTES,
    );
    expect(
      (await h.fetch(request("_emit", { method: "POST", body }))).status,
    ).toBe(200);
    const socket = new Socket();
    await (
      await h.instance()
    ).socketMessage(socket, '{"t":"hello","lastEventId":0}', turn);
    expect(socket.frames).toEqual([
      { t: "event", event: { id: 1, type: "unread", data: { text } } },
      { t: "hello_ok", lastEventId: 1 },
    ]);
  });

  test("actual Hono header middleware reconstructs the adapter's genuine Response", async () => {
    const h = harness();
    const app = new Hono();
    app.use("*", async (c, next) => {
      await next();
      c.header("X-Realtime-Test", "middleware");
    });
    app.get("/_ws", (c) => h.fetch(c.req.raw));
    const response = await app.fetch(upgrade());
    expect(response).toBeInstanceOf(Response);
    expect(response).not.toBe(h.acceptedResponse);
    expect(response.status).toBe(h.acceptedResponse.status);
    expect(response.body).toBeNull();
    expect(response.headers.get("X-Realtime-Test")).toBe("middleware");
    // Native 101 brand/alias authority belongs to the forward Host tests.
  });

  test("constructor is synchronous and all required handlers are prototype methods", () => {
    const h = harness();
    const transaction = spyOn(h.context.storage, "transaction");
    const actor = new RealtimeStreamActor(h.context, {});
    expect(transaction).not.toHaveBeenCalled();
    for (const name of [
      "start",
      "fetch",
      "alarm",
      "socketMessage",
      "socketClose",
    ]) {
      expect(
        typeof Object.getOwnPropertyDescriptor(
          RealtimeStreamActor.prototype,
          name,
        )?.value,
      ).toBe("function");
      expect(Object.hasOwn(actor, name)).toBe(false);
    }
  });

  test("private SQL head/ring survive every-event eviction and retain exact replay bound", async () => {
    const h = harness();
    for (let id = 1; id <= 205; id++)
      expect(await (await h.fetch(emitRequest())).json()).toEqual({
        id,
        sockets: 0,
      });
    expect(
      h.db.query("SELECT COUNT(*) AS count FROM realtime_events").get(),
    ).toEqual({ count: 200 });
    const socket = new Socket();
    await (
      await h.instance()
    ).socketMessage(
      socket,
      JSON.stringify({ t: "hello", lastEventId: 203 }),
      turn,
    );
    expect(socket.frames).toEqual([
      { t: "event", event: { id: 204, type: "unread", data: {} } },
      { t: "event", event: { id: 205, type: "unread", data: {} } },
      { t: "hello_ok", lastEventId: 205 },
    ]);
    socket.frames.length = 0;
    await (
      await h.instance()
    ).socketMessage(socket, '{"t":"hello","lastEventId":4}', turn);
    expect(socket.frames).toEqual([
      { t: "resync" },
      { t: "hello_ok", lastEventId: 205 },
    ]);
    socket.frames.length = 0;
    await (
      await h.instance()
    ).socketMessage(socket, '{"t":"hello","lastEventId":5}', turn);
    expect(socket.frames).toHaveLength(201);
    expect(await (await h.fetch(request("_state"))).json()).toEqual({
      seq: 205,
      sockets: 0,
    });
  });

  test("failed append rolls back event, head and pruning before broadcast", async () => {
    const h = harness();
    const socket = new Socket();
    h.sockets.push(socket);
    h.failAppend();
    await expect(h.fetch(emitRequest())).rejects.toThrow("write failed");
    expect(await (await h.fetch(request("_state"))).json()).toEqual({
      seq: 0,
      sockets: 1,
    });
    expect(h.db.query("SELECT * FROM realtime_events").all()).toEqual([]);
    expect(socket.frames).toEqual([]);
  });

  test("tickets remain hash-only, actor-bound and single-use after eviction", async () => {
    const h = harness();
    const ticket = await mint(h);
    expect(
      JSON.stringify(h.db.query("SELECT * FROM realtime_tickets").all()),
    ).not.toContain(ticket);
    expect((await harness().fetch(upgrade(ticket))).status).toBe(401);
    expect(await h.fetch(upgrade(ticket))).toBe(h.acceptedResponse);
    expect((await h.fetch(upgrade(ticket))).status).toBe(401);
    expect(h.db.query("SELECT * FROM realtime_tickets").all()).toEqual([]);
    expect(
      (await h.fetch(request("_ws", { headers: { Upgrade: "websocket" } })))
        .status,
    ).toBe(401);
    expect((await h.fetch(request("_ws"))).status).toBe(426);
  });

  test("ticket consume persists even if broker acceptance fails", async () => {
    const h = harness();
    const ticket = await mint(h);
    spyOn(h.context.sockets, "accept").mockRejectedValue(
      new Error("backend_unavailable"),
    );
    await expect(h.fetch(upgrade(ticket))).rejects.toThrow(
      "backend_unavailable",
    );
    expect((await h.fetch(upgrade(ticket))).status).toBe(401);
  });

  test("ticket expiry and outstanding cap reuse the existing shared policy", async () => {
    const h = harness();
    const now = spyOn(Date, "now").mockReturnValue(10_000);
    try {
      const first = await mint(h);
      for (let i = 0; i < 8; i++) {
        now.mockReturnValue(10_001 + i);
        await mint(h);
      }
      expect(
        h.db.query("SELECT COUNT(*) AS n FROM realtime_tickets").get(),
      ).toEqual({ n: 8 });
      expect((await h.fetch(upgrade(first))).status).toBe(401);
      const latest = await mint(h);
      now.mockReturnValue(70_008);
      expect((await h.fetch(upgrade(latest))).status).toBe(401);
      await mint(h);
      expect(
        h.db.query("SELECT COUNT(*) AS n FROM realtime_tickets").get(),
      ).toEqual({ n: 1 });
    } finally {
      now.mockRestore();
    }
  });

  test("awaits async sends, isolates rejection, and leaves opaque attachments untouched", async () => {
    const h = harness();
    const gone = new Socket();
    gone.failSend = true;
    const live = new Socket();
    const read = spyOn(live, "getAttachment");
    const write = spyOn(live, "setAttachment");
    h.sockets.push(gone, live);
    await h.fetch(emitRequest());
    await h.fetch(emitRequest());
    expect(live.frames).toEqual(
      [1, 2].map((id) => ({
        t: "event",
        event: { id, type: "unread", data: {} },
      })),
    );
    const restored = await h.context.sockets.get(live.id);
    // IDs are broker-owned opaque strings; no parsing or identity derivation.
    expect(restored).toBe(live);
    await (await h.instance()).socketMessage(live, '{"t":"ping"}', turn);
    expect(live.frames.at(-1)).toEqual({ t: "pong" });
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(live.attachment).toEqual(new Uint8Array(8192).fill(193));
    gone.failClose = true;
    await (
      await h.instance()
    ).socketClose(
      gone,
      { code: 1006, reason: "transport_error", wasClean: false },
      turn,
    );
    expect(gone.closed).toBe(true);
    await (await h.instance()).alarm(turn);
  });

  test("control bounds reject malformed/binary data without SQL or attachment reads", async () => {
    const h = harness();
    const actor = await h.instance();
    const query = spyOn(h.context.storage, "query");
    const socket = new Socket();
    for (const data of [
      new Uint8Array([1, 2]),
      "{",
      "null",
      " ".repeat(MAX_REALTIME_CONTROL_BYTES + 1),
      '{"t":"hello","lastEventId":-1}',
      '{"t":"hello","lastEventId":1.5}',
      '{"t":"hello","lastEventId":9007199254740992}',
    ]) {
      await actor.socketMessage(socket, data, turn);
    }
    expect(query).not.toHaveBeenCalled();
    expect(socket.frames).toEqual([]);
  });

  test("event budget rejects actual oversized stream and malformed data before persistence", async () => {
    const h = harness();
    for (const body of [
      JSON.stringify({ type: "unknown", data: {} }),
      " ".repeat(MAX_REALTIME_EVENT_BYTES + 1),
    ]) {
      const response = await h.fetch(
        request("_emit", {
          method: "POST",
          body,
          headers: { "Content-Length": "1" },
        }),
      );
      expect(response.status).toBe(
        body.length > MAX_REALTIME_EVENT_BYTES ? 413 : 400,
      );
    }
    expect(await (await h.fetch(request("_state"))).json()).toEqual({
      seq: 0,
      sockets: 0,
    });
    expect(h.db.query("SELECT * FROM realtime_events").all()).toEqual([]);
  });
});
