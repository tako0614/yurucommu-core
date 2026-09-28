/** Unpublished Actor 2 candidate adapter. Not an installation/support claim. */
import type {
  ActorContext,
  ActorSocket,
  ActorSocketCloseEvent,
  ActorTurn,
  ActorSqlStatement,
} from "./actor-context.ts";
import type { EnvVars } from "../types.ts";
import { isEdgeSqlBinding } from "./edge-facades.ts";
import { createEdgeSqlDatabase } from "./edge-sql.ts";
import { createCallHubPort } from "./call-hub-port.ts";
import { CallSignalingRuntime } from "./call-signaling-runtime.ts";
import type { OneTimeTicketStorage } from "./one-time-ticket.ts";
import { CallRelayJournal } from "./call-relay-journal.ts";
import type { CallService } from "./call-relay.ts";

/** Private to this Actor namespace; no shared DB or old DO data migration. */
class CallActorStorage implements OneTimeTicketStorage {
  constructor(private readonly sql: ActorContext["storage"]) {}
  async initialize(): Promise<void> {
    await this.sql.execute(
      "CREATE TABLE IF NOT EXISTS call_signaling_state (key TEXT NOT NULL, part INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY (key, part))",
    );
  }
  async get<T>(key: string): Promise<T | undefined> {
    let value = "";
    let offset = 0;
    while (true) {
      const result = await this.sql.query(
        "SELECT part, value FROM call_signaling_state WHERE key = ? AND part >= ? ORDER BY part LIMIT 16",
        [key, offset],
      );
      for (const row of result.rows) {
        if (row.part !== offset || typeof row.value !== "string")
          throw new Error("invalid call state chunk");
        value += row.value;
        offset++;
      }
      if (result.rows.length < 16) break;
    }
    return offset ? (JSON.parse(value) as T) : undefined;
  }
  async put(key: string, value: unknown): Promise<void> {
    const encoded = JSON.stringify(value);
    const statements: ActorSqlStatement[] = [
      { sql: "DELETE FROM call_signaling_state WHERE key = ?", params: [key] },
    ];
    // A valid 1MiB invite can carry a peer ID above the SQL TEXT value limit.
    // Keep each chunk below 64KiB UTF-8, without splitting surrogate pairs.
    for (let offset = 0, part = 0; offset < encoded.length; part++) {
      let end = Math.min(offset + 16_384, encoded.length);
      const last = encoded.charCodeAt(end - 1);
      if (end < encoded.length && last >= 0xd800 && last <= 0xdbff) end--;
      statements.push({
        sql: "INSERT INTO call_signaling_state (key, part, value) VALUES (?, ?, ?)",
        params: [key, part, encoded.slice(offset, end)],
      });
      offset = end;
    }
    // Explicit refusal preserves the previous record; never truncate or commit
    // a partial replacement. Existing app-sized frames fit in one transaction.
    if (statements.length > 100)
      throw new Error("call state exceeds atomic storage capacity");
    await this.sql.transaction(statements);
  }
  async delete(key: string): Promise<boolean> {
    return (
      (
        await this.sql.execute(
          "DELETE FROM call_signaling_state WHERE key = ?",
          [key],
        )
      ).rowsWritten > 0
    );
  }
  async list<T>(options?: { prefix?: string }): Promise<Map<string, T>> {
    const values = new Map<string, T>();
    let after = "";
    while (true) {
      const result = await this.sql.query(
        "SELECT key FROM call_signaling_state WHERE part = 0 AND instr(key, ?) = 1 AND key > ? ORDER BY key LIMIT 100",
        [options?.prefix ?? "", after],
      );
      for (const row of result.rows) {
        if (typeof row.key !== "string")
          throw new Error("invalid call state key");
        const value = await this.get<T>(row.key);
        if (value === undefined) throw new Error("missing call state chunks");
        values.set(row.key, value);
        after = row.key;
      }
      if (result.rows.length < 100) return values;
    }
  }
}

export class CallSignalingActor {
  private runtime: CallSignalingRuntime | undefined;
  // Capture only: construction starts no asynchronous work.
  constructor(
    private readonly context: ActorContext,
    private readonly env: Readonly<Record<string, unknown>>,
  ) {}
  async start(_turn: ActorTurn): Promise<void> {
    if (this.runtime) return;
    if (!isEdgeSqlBinding(this.env.DB))
      throw new Error("call Actor requires edge.sql DB binding");
    if (typeof this.env.APP_URL !== "string" || !this.env.APP_URL)
      throw new Error("call Actor requires APP_URL");
    const dispatcher = this.env.CALL_DISPATCHER as CallService | undefined;
    if (!dispatcher || typeof dispatcher.fetch !== "function")
      throw new Error(
        "call Actor requires private CALL_DISPATCHER service binding",
      );
    const db = createEdgeSqlDatabase(this.env.DB);
    const env: EnvVars = { ...this.env, APP_URL: this.env.APP_URL };
    const storage = new CallActorStorage(this.context.storage);
    await storage.initialize();
    this.runtime = new CallSignalingRuntime(
      storage,
      {
        list: () => this.context.sockets.list(),
        accept: async (request) =>
          (await this.context.sockets.accept(request)).response,
        getAlarm: () => this.context.alarm.get(),
        setAlarm: (at) => this.context.alarm.set(at),
      },
      (actor, clients) =>
        createCallHubPort({ localActorApId: actor, db, env, ...clients }),
      { journal: new CallRelayJournal(storage), dispatcher },
    );
  }
  fetch(request: Request, _turn: ActorTurn): Promise<Response> {
    return this.ready().fetch(request);
  }
  alarm(_turn: ActorTurn): Promise<void> {
    return this.ready().alarm();
  }
  socketMessage(
    socket: ActorSocket,
    data: string | Uint8Array,
    _turn: ActorTurn,
  ): Promise<void> {
    return this.ready().message(socket, data);
  }
  async socketClose(
    _socket: ActorSocket,
    _event: ActorSocketCloseEvent,
    _turn: ActorTurn,
  ): Promise<void> {
    // No per-socket heap state. Host list() excludes this closed connection.
  }
  private ready(): CallSignalingRuntime {
    if (!this.runtime) throw new Error("call Actor start was not awaited");
    return this.runtime;
  }
}
