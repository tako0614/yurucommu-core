import type { RealtimeEvent } from "../../../packages/api/src/types/realtime.ts";
import { MAX_REALTIME_EVENT_BYTES } from "../../../packages/api/src/types/realtime.ts";
import type {
  ActorContext,
  ActorSocket,
  ActorSocketCloseEvent,
  ActorTurn,
} from "./actor-context.ts";
import {
  consumeOneTimeTicket,
  mintOneTimeTicket,
  type OneTimeTicketStorage,
} from "./one-time-ticket.ts";
import { RealtimeStream, type RealtimeRepository } from "./realtime-stream.ts";

// JSON number normalization can expand short exponent notation (1e20 -> 21
// digits). Six times the admitted wire budget covers that expansion, escaped
// strings and the assigned id, without allowing unbounded corrupt SQL replay.
const MAX_STORED_EVENT_BYTES = MAX_REALTIME_EVENT_BYTES * 6 + 128;
const EVENT_PART_UNITS = 250_000;
const MAX_EVENT_PARTS = Math.ceil(MAX_STORED_EVENT_BYTES / EVENT_PART_UNITS);

/**
 * Actor SQL TEXT is at most 1,000,000 UTF-8 bytes, smaller than our 1 MiB
 * event budget. 250,000 UTF-16 units stay below that value bound and the
 * 2,000,000-byte encoded row bound, even after JSON escaping. Never split a
 * surrogate pair: a SQL carrier may replace an unpaired surrogate in transit.
 */
function eventParts(event: RealtimeEvent): string[] {
  const json = JSON.stringify(event);
  if (new TextEncoder().encode(json).byteLength > MAX_STORED_EVENT_BYTES) {
    throw new Error("realtime stored event too large");
  }
  const parts: string[] = [];
  for (let offset = 0; offset < json.length;) {
    let end = Math.min(offset + EVENT_PART_UNITS, json.length);
    const last = json.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) end--;
    parts.push(json.slice(offset, end));
    offset = end;
  }
  return parts;
}

/** Only the existing ticket primitive's storage seam, not a DO emulation. */
function ticketStorage(sql: ActorContext["storage"]): OneTimeTicketStorage {
  return {
    async get<T>(key: string): Promise<T | undefined> {
      const { rows } = await sql.query(
        "SELECT value FROM realtime_tickets WHERE key = ?",
        [key],
      );
      return rows.length
        ? (JSON.parse(String(rows[0]!.value)) as T)
        : undefined;
    },
    async put(key, value) {
      await sql.execute(
        "INSERT INTO realtime_tickets (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, JSON.stringify(value)],
      );
    },
    async delete(key) {
      const result = await sql.execute(
        "DELETE FROM realtime_tickets WHERE key = ?",
        [key],
      );
      return result.rowsWritten > 0;
    },
    async list<T>(options?: { prefix?: string }): Promise<Map<string, T>> {
      const { rows } = await sql.query(
        "SELECT key, value FROM realtime_tickets ORDER BY key",
      );
      return new Map(
        rows
          .filter((row) => String(row.key).startsWith(options?.prefix ?? ""))
          .map((row) => [String(row.key), JSON.parse(String(row.value)) as T]),
      );
    },
  };
}

function repository(sql: ActorContext["storage"]): RealtimeRepository {
  const tickets = ticketStorage(sql);
  return {
    async currentSeq() {
      const { rows } = await sql.query(
        "SELECT seq FROM realtime_head WHERE singleton = 1",
      );
      return Number(rows[0]!.seq);
    },
    async appendEvent(event, retain) {
      // Host serializes whole events. Commit head, replay payload and pruning
      // together so eviction/crash cannot leave a head with no matching event.
      await sql.transaction([
        ...eventParts(event).map((value, part) => ({
          sql: "INSERT INTO realtime_events (seq, part, value) VALUES (?, ?, ?)",
          params: [event.id, part, value],
        })),
        {
          sql: "UPDATE realtime_head SET seq = ? WHERE singleton = 1",
          params: [event.id],
        },
        {
          sql: "DELETE FROM realtime_events WHERE seq <= ?",
          params: [event.id - retain],
        },
      ]);
    },
    async eventAt(seq) {
      const { rows } = await sql.query(
        "SELECT part, value FROM realtime_events WHERE seq = ? ORDER BY part LIMIT ?",
        [seq, MAX_EVENT_PARTS + 1],
      );
      if (!rows.length) return undefined;
      let bytes = 0;
      if (rows.length > MAX_EVENT_PARTS)
        throw new Error("invalid realtime event parts");
      const parts = rows.map((row, part) => {
        if (row.part !== part || typeof row.value !== "string") {
          throw new Error("invalid realtime event parts");
        }
        bytes += new TextEncoder().encode(row.value).byteLength;
        if (bytes > MAX_STORED_EVENT_BYTES)
          throw new Error("realtime stored event too large");
        return row.value;
      });
      return JSON.parse(parts.join("")) as RealtimeEvent;
    },
    mintTicket: () => mintOneTimeTicket(tickets, { prefix: "ticket:" }),
    consumeTicket: (ticket) =>
      consumeOneTimeTicket(tickets, ticket, { prefix: "ticket:" }),
  };
}

/**
 * Unpublished Actor candidate. Binding invocation is the trusted entry point,
 * not a browser endpoint. The outer worker still owns Origin/session/audience
 * validation. This class does not select a Host or activate any deployment.
 */
export class RealtimeStreamActor {
  private readonly stream: RealtimeStream;

  constructor(
    private readonly context: ActorContext,
    _env: Readonly<Record<string, unknown>>,
  ) {
    // Synchronous capture only; every event may get a fresh instance.
    this.stream = new RealtimeStream(repository(context.storage), {
      list: () => context.sockets.list(),
      async accept(request) {
        const { response } = await context.sockets.accept(request);
        // Preserve the Host-branded response. Never construct a native pair or
        // mint status 101 here. No per-socket application state is needed.
        return response;
      },
    });
  }

  async start(_turn: ActorTurn): Promise<void> {
    // Private app schema, not the product SQL binding or its migration ledger.
    // Idempotent initialization is safe after every eviction.
    await this.context.storage.transaction([
      {
        sql: "CREATE TABLE IF NOT EXISTS realtime_head (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), seq INTEGER NOT NULL)",
      },
      {
        sql: "CREATE TABLE IF NOT EXISTS realtime_events (seq INTEGER NOT NULL, part INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(seq, part))",
      },
      {
        sql: "CREATE TABLE IF NOT EXISTS realtime_tickets (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
      },
      {
        sql: "INSERT INTO realtime_head (singleton, seq) VALUES (1, 0) ON CONFLICT(singleton) DO NOTHING",
      },
    ]);
  }

  fetch(request: Request, _turn: ActorTurn): Promise<Response> {
    return this.stream.fetch(request);
  }

  async alarm(_turn: ActorTurn): Promise<void> {
    // Realtime heartbeat is client-driven; no alarm is scheduled.
  }

  socketMessage(
    socket: ActorSocket,
    data: string | Uint8Array,
    _turn: ActorTurn,
  ): Promise<void> {
    return this.stream.socketMessage(socket, data);
  }

  socketClose(
    socket: ActorSocket,
    _event: ActorSocketCloseEvent,
    _turn: ActorTurn,
  ): Promise<void> {
    return this.stream.socketClose(socket);
  }
}
