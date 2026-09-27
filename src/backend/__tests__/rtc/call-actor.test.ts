import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { CallSignalingActor } from "../../runtime/call-signaling-actor.ts";
import type {
  ActorContext,
  ActorSocket,
  ActorSqlResult,
  ActorSqlValue,
} from "../../runtime/actor-context.ts";

const ACTOR = "https://local.example/ap/users/alice";
const PEER = "https://peer.example/ap/users/bob";
const turn = { signal: new AbortController().signal };
const invite = {
  t: "invite",
  callId: "one",
  to: PEER,
  media: { audio: true, video: false },
};
const req = (
  path: string,
  headers: Record<string, string> = {},
  method = "GET",
) => new Request(`https://call-actor${path}`, { method, headers });

function harness() {
  const db = new Database(":memory:");
  const calls: string[] = [];
  const frames: string[] = [];
  let pending: number | null = null;
  let failSql: ((sql: string) => boolean) | undefined;
  let pauseSql: (() => Promise<void>) | undefined;
  let send: (data: string | Uint8Array) => Promise<void> = async (data) => {
    frames.push(String(data));
  };
  let acceptError = false;
  const execute = async (
    sql: string,
    params: readonly ActorSqlValue[] = [],
  ): Promise<ActorSqlResult> => {
    calls.push(sql);
    if (failSql?.(sql)) throw new Error("private storage unavailable");
    await pauseSql?.();
    for (const value of params) {
      if (
        typeof value === "string" &&
        new TextEncoder().encode(value).length > 1_000_000
      )
        throw new Error("SQL text value too large");
    }
    const rows = db.query(sql).all(...(params as never[])) as Record<
      string,
      ActorSqlValue
    >[];
    return {
      rows,
      rowsWritten: (db.query("SELECT changes() AS n").get() as { n: number }).n,
    };
  };
  const socket: ActorSocket = {
    id: "opaque-connection",
    send: (data) => send(data),
    close: async () => {},
    getAttachment: async () => null,
    setAttachment: async () => {},
  };
  const sockets: ActorSocket[] = [socket];
  // This is a test of application adapters, not Host protocol qualification.
  // The response sentinel is never asserted to be a valid branded 101.
  const upgradeResponse = new Response(null, { status: 204 });
  const context: ActorContext = {
    id: "opaque-actor",
    storage: {
      execute,
      query: async (sql, params) => ({
        ...(await execute(sql, params)),
        rowsWritten: 0,
      }),
      transaction: async (statements) => {
        expect(statements.length).toBeGreaterThan(0);
        expect(statements.length).toBeLessThanOrEqual(100);
        db.exec("BEGIN");
        try {
          const results = [];
          for (const statement of statements)
            results.push(await execute(statement.sql, statement.params));
          db.exec("COMMIT");
          return { results };
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      },
    },
    alarm: {
      get: async () => pending,
      set: async (at) => {
        pending = at;
      },
      clear: async () => {
        pending = null;
      },
    },
    sockets: {
      list: async () => sockets,
      get: async (id) => sockets.find((s) => s.id === id) ?? null,
      accept: async () => {
        if (acceptError) throw new Error("accept failed");
        return { response: upgradeResponse, socket };
      },
    },
  };
  const sharedWrites: string[] = [];
  const env = {
    APP_URL: "https://local.example",
    DB: {
      execute: async (sql: string) => {
        sharedWrites.push(sql);
        return { rows: [], rowsWritten: 1 };
      },
      query: async () => ({ rows: [], rowsWritten: 0 }),
      transaction: async () => ({ results: [] }),
    },
  };
  const construct = () => new CallSignalingActor(context, env);
  const wake = async () => {
    const actor = construct();
    await actor.start(turn);
    return actor;
  };
  const mint = async (actor: CallSignalingActor) => {
    const response = await actor.fetch(
      req("/_ticket", { "X-Call-Actor": ACTOR }, "POST"),
      turn,
    );
    return ((await response.json()) as { ticket: string }).ticket;
  };
  const upgrade = (actor: CallSignalingActor, ticket: string, who = ACTOR) =>
    actor.fetch(
      req("/_ws", {
        Upgrade: "websocket",
        "X-Call-Auth": "ticket",
        "X-Call-Ticket": ticket,
        "X-Call-Actor": who,
      }),
      turn,
    );
  return {
    db,
    calls,
    frames,
    sharedWrites,
    context,
    env,
    socket,
    sockets,
    wake,
    construct,
    mint,
    upgrade,
    upgradeResponse,
    send: (next: typeof send) => {
      send = next;
    },
    fail: (next?: typeof failSql) => {
      failSql = next;
    },
    pause: (next?: typeof pauseSql) => {
      pauseSql = next;
    },
    rejectAccept: () => {
      acceptError = true;
    },
    pending: () => pending,
    admitAlarm: () => {
      pending = null;
    },
    close: () => db.close(),
  };
}

test("Actor constructor captures only, start is idempotent, required handlers are on prototype", async () => {
  const h = harness();
  try {
    const actor = h.construct();
    expect(h.calls).toEqual([]);
    for (const name of [
      "fetch",
      "alarm",
      "socketMessage",
      "socketClose",
      "start",
    ])
      expect(
        typeof Object.getOwnPropertyDescriptor(
          CallSignalingActor.prototype,
          name,
        )?.value,
      ).toBe("function");
    await actor.start(turn);
    const count = h.calls.length;
    await actor.start(turn);
    expect(h.calls.length).toBe(count);
    expect(h.pending()).toBeNull();
  } finally {
    h.close();
  }
});

test("Actor ticket hashes survive eviction and burn before upgrade failure or wrong audience", async () => {
  const h = harness();
  try {
    const first = await h.wake();
    const ticket = await h.mint(first);
    expect(
      JSON.stringify(h.db.query("SELECT * FROM call_signaling_state").all()),
    ).not.toContain(ticket);
    const second = await h.wake();
    expect(await h.upgrade(second, ticket)).toBe(h.upgradeResponse);
    expect((await h.upgrade(await h.wake(), ticket)).status).toBe(401);
    const wrong = await h.mint(second);
    expect((await h.upgrade(second, wrong, PEER)).status).toBe(409);
    expect((await h.upgrade(second, wrong)).status).toBe(401);
    const failed = await h.mint(second);
    h.rejectAccept();
    await expect(h.upgrade(second, failed)).rejects.toThrow("accept failed");
    expect((await h.upgrade(await h.wake(), failed)).status).toBe(401);
  } finally {
    h.close();
  }
});

test("Actor call state survives eviction and asynchronous sends settle before the message", async () => {
  const h = harness();
  try {
    const actor = await h.wake();
    await h.mint(actor);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.send(async (data) => {
      await blocked;
      h.frames.push(String(data));
    });
    let settled = false;
    const event = actor
      .socketMessage(h.socket, JSON.stringify(invite), turn)
      .then(() => {
        settled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
    release();
    await event;
    const next = await h.wake();
    await next.socketMessage(h.socket, '{"t":"resume","callId":"one"}', turn);
    expect(JSON.parse(h.frames.at(-1)!)).toEqual({
      t: "call-state",
      callId: "one",
      state: "ringing",
    });
    expect(h.sharedWrites.length).toBeGreaterThan(0);
  } finally {
    h.close();
  }
});

test("Actor failed send propagates after durable state and other sockets' acceptance", async () => {
  const h = harness();
  try {
    const actor = await h.wake();
    await h.mint(actor);
    const other: string[] = [];
    h.sockets.push({
      ...h.socket,
      id: "other",
      send: async (data) => {
        other.push(String(data));
      },
    });
    h.send(async () => {
      throw new Error("transport_overloaded");
    });
    await expect(
      actor.socketMessage(h.socket, JSON.stringify(invite), turn),
    ).rejects.toThrow("transport_overloaded");
    expect(other.map((raw) => JSON.parse(raw).t)).toContain("call-state");
    h.send(async (data) => {
      h.frames.push(String(data));
    });
    await (
      await h.wake()
    ).socketMessage(h.socket, '{"t":"resume","callId":"one"}', turn);
    expect(JSON.parse(h.frames.at(-1)!).state).toBe("ringing");
  } finally {
    h.close();
  }
});

test("Actor alarm sets successor before a failed durable timeout and retry rehydrates", async () => {
  const h = harness();
  const realNow = Date.now;
  try {
    let now = 1000;
    Date.now = () => now;
    const actor = await h.wake();
    await h.mint(actor);
    await actor.socketMessage(h.socket, JSON.stringify(invite), turn);
    now = 100_000;
    h.admitAlarm();
    h.fail((sql) => sql.startsWith("DELETE"));
    const frameCount = h.frames.length;
    await expect((await h.wake()).alarm(turn)).rejects.toThrow(
      "private storage unavailable",
    );
    expect(h.frames.length).toBe(frameCount);
    expect(h.pending()).toBe(115_000);
    h.fail();
    await (await h.wake()).alarm(turn);
    expect(h.pending()).toBe(115_000);
    await (
      await h.wake()
    ).socketMessage(h.socket, '{"t":"resume","callId":"one"}', turn);
    expect(JSON.parse(h.frames.at(-1)!).state).toBe("ended");
  } finally {
    Date.now = realNow;
    h.close();
  }
});

test("Actor frame and SDP boundaries reject before storage/media/transport effects", async () => {
  const h = harness();
  try {
    const actor = await h.wake();
    await h.mint(actor);
    const count = h.calls.length;
    for (const raw of [
      new TextEncoder().encode('{"t":"ping"}'),
      "{",
      '{"t":"invite"}',
      JSON.stringify({ t: "ping", pad: "界".repeat(350000) }),
      JSON.stringify({ t: "offer", callId: "one", sdp: "界".repeat(33334) }),
    ])
      await actor.socketMessage(h.socket, raw, turn);
    expect(h.calls.length).toBe(count);
    expect(h.frames).toEqual([]);
    expect(h.sharedWrites).toEqual([]);
  } finally {
    h.close();
  }
});

test("Actor preserves a valid near-1MiB invite across private SQL TEXT limits and eviction", async () => {
  const h = harness();
  try {
    const actor = await h.wake();
    await h.mint(actor);
    const large = { ...invite, to: "界".repeat(340000) };
    expect(new TextEncoder().encode(JSON.stringify(large)).length).toBeLessThan(
      1024 * 1024,
    );
    await actor.socketMessage(h.socket, JSON.stringify(large), turn);
    const next = await h.wake();
    await next.socketMessage(h.socket, '{"t":"resume","callId":"one"}', turn);
    expect(JSON.parse(h.frames.at(-1)!).state).toBe("ringing");
  } finally {
    h.close();
  }
});

test("Actor chunk replacement is atomic and preserves supplementary Unicode", async () => {
  const h = harness();
  try {
    const actor = await h.wake();
    await h.mint(actor);
    const large = { ...invite, to: "😀".repeat(250000) };
    await actor.socketMessage(h.socket, JSON.stringify(large), turn);
    const readStored = () =>
      JSON.parse(
        (
          h.db
            .query(
              "SELECT value FROM call_signaling_state WHERE key = 'call:one' ORDER BY part",
            )
            .all() as { value: string }[]
        )
          .map((row) => row.value)
          .join(""),
      );
    expect(readStored().peerApId).toBe(large.to);
    let inserts = 0;
    h.fail((sql) => sql.startsWith("INSERT") && ++inserts === 2);
    const signal = new Request("https://call-actor/_ingest", {
      method: "POST",
      body: JSON.stringify({
        v: 1,
        type: "accept",
        callId: "one",
        from: large.to,
        to: ACTOR,
        ts: Date.now(),
        ttlMs: 30000,
      }),
    });
    await expect(actor.fetch(signal, turn)).rejects.toThrow(
      "private storage unavailable",
    );
    expect(readStored().state).toBe("ringing");
    expect(readStored().peerApId).toBe(large.to);
    h.fail();
    await (
      await h.wake()
    ).socketMessage(h.socket, '{"t":"resume","callId":"one"}', turn);
    expect(JSON.parse(h.frames.at(-1)!).state).toBe("ringing");
  } finally {
    h.close();
  }
});

test("Actor retries do not erase a pending successor after timeout send failure", async () => {
  const h = harness();
  const realNow = Date.now;
  try {
    let now = 1000;
    Date.now = () => now;
    const actor = await h.wake();
    await h.mint(actor);
    await actor.socketMessage(h.socket, JSON.stringify(invite), turn);
    now = 100_000;
    h.admitAlarm();
    h.send(async () => {
      throw new Error("backend_unavailable");
    });
    await expect((await h.wake()).alarm(turn)).rejects.toThrow(
      "backend_unavailable",
    );
    expect(h.pending()).toBe(115_000);
    h.send(async (data) => {
      h.frames.push(String(data));
    });
    h.sockets.length = 0;
    await (await h.wake()).alarm(turn);
    expect(h.pending()).toBe(115_000);
  } finally {
    Date.now = realNow;
    h.close();
  }
});

test("Actor start failure performs no private writes and can be retried", async () => {
  const h = harness();
  try {
    const invalid = new CallSignalingActor(h.context, {
      APP_URL: "https://local.example",
    });
    await expect(invalid.start(turn)).rejects.toThrow("edge.sql");
    expect(h.calls).toEqual([]);
    const actor = h.construct();
    h.fail(() => true);
    await expect(actor.start(turn)).rejects.toThrow(
      "private storage unavailable",
    );
    h.fail();
    await actor.start(turn);
    expect(
      (
        await actor.fetch(
          req("/_ticket", { "X-Call-Actor": ACTOR }, "POST"),
          turn,
        )
      ).status,
    ).toBe(200);
  } finally {
    h.close();
  }
});
