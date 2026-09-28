/**
 * CallSignalingDurableObject — per-local-user signaling hub (call feature).
 *
 * One DO instance per local actor (`idFromName(actorApId)`). It is the standing
 * presence socket the browser connects to (so an incoming ring can arrive before
 * any call object exists), the fan-in point for cross-instance signals delivered
 * to `/ap/rtc/signal`, and the owner of the per-call state machine (via the
 * runtime-neutral `CallHub`).
 *
 * Uses Hibernatable WebSockets: idle presence sockets can be evicted and the DO
 * reconstructs its `CallHub` from durable storage (`call:*` records) on wake.
 * The CF/DO + Hibernatable-WebSocket surface is typed file-locally so this file
 * does not depend on a specific `@cloudflare/workers-types` version.
 */

import { getDb } from "../../db/index.ts";
import type { EnvVars } from "../types.ts";
import { CallHub, type CallRecord } from "./call-hub-core.ts";
import { createCallHubPort } from "./call-hub-port.ts";
import type {
  HubToClientFrame,
  RtcSignalEnvelopeV1,
} from "../../../packages/api/src/types/call.ts";
import {
  isTerminalCallState,
  parseClientToHubFrame,
  parseRtcSignalEnvelope,
} from "../../../packages/api/src/types/call.ts";
import { consumeOneTimeTicket, mintOneTimeTicket } from "./one-time-ticket.ts";

// --- Minimal Cloudflare DO + Hibernatable WebSocket surface ----------------
interface DoWebSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}
interface DoStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>>;
  setAlarm(scheduledTime: number): Promise<void>;
  getAlarm(): Promise<number | null>;
}
interface DoState {
  acceptWebSocket(ws: DoWebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): DoWebSocket[];
  readonly storage: DoStorage;
}
declare const WebSocketPair: {
  new (): { 0: DoWebSocket; 1: DoWebSocket };
};

type CallDoEnv = EnvVars & {
  DB: D1Database;
  CALL_SIGNALING?: DurableObjectNamespace;
};

const ALARM_INTERVAL_MS = 15_000;
const ACTOR_KEY = "actor";
const CALL_PREFIX = "call:";
const TICKET_PREFIX = "ticket:";

export class CallSignalingDurableObject {
  private hub: CallHub | null = null;
  private actorApId: string | null = null;
  private loadingHub: Promise<CallHub | null> | null = null;
  private identityTail: Promise<unknown> = Promise.resolve();
  private writeTail: Promise<void> = Promise.resolve();
  private readonly pendingWrites = new Map<
    number,
    Promise<{ error?: unknown }>
  >();
  private nextWrite = 0;
  private readonly activeEvents = new Set<{ firstWrite: number }>();
  private refreshHub = false;

  constructor(
    private readonly state: DoState,
    private readonly env: CallDoEnv,
  ) {}

  // -------------------------------------------------------------------------
  // HTTP entry (from the CloudflareSignalingHub adapter)
  // -------------------------------------------------------------------------
  async fetch(request: Request): Promise<Response> {
    const event = this.startEvent();
    try {
      const url = new URL(request.url);
      if (url.pathname === "/_ws") {
        return await this.withIdentity(() => this.handleUpgrade(request));
      }
      if (url.pathname === "/_ingest") {
        return await this.handleIngest(request);
      }
      if (url.pathname === "/_ticket") {
        return await this.withIdentity(() => this.handleMintTicket(request));
      }
      return new Response("not found", { status: 404 });
    } finally {
      await this.finishEvent(event);
    }
  }

  private async handleUpgrade(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const authMode = request.headers.get("X-Call-Auth");
    if (authMode !== "ticket") {
      return new Response("unauthorized", { status: 401 });
    }
    const ticket = request.headers.get("X-Call-Ticket") ?? "";
    if (
      !ticket ||
      !(await consumeOneTimeTicket(this.state.storage, ticket, {
        prefix: TICKET_PREFIX,
      }))
    ) {
      return new Response("invalid ticket", { status: 401 });
    }

    const actor = request.headers.get("X-Call-Actor");
    if (!actor) return new Response("missing actor", { status: 400 });
    if (!(await this.setActor(actor)))
      return new Response("wrong actor", { status: 409 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.state.acceptWebSocket(server);
    await this.scheduleAlarm();
    return new Response(null, {
      status: 101,
      // `webSocket` is a Cloudflare-specific ResponseInit field.
      webSocket: client,
    } as unknown as ResponseInit);
  }

  private async handleMintTicket(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }
    const actor = request.headers.get("X-Call-Actor");
    if (!actor) return new Response("missing actor", { status: 400 });
    if (!(await this.setActor(actor)))
      return new Response("wrong actor", { status: 409 });
    const ticket = await mintOneTimeTicket(this.state.storage, {
      prefix: TICKET_PREFIX,
    });
    return Response.json({ ticket });
  }

  private async handleIngest(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response("bad json", { status: 400 });
    }
    const envelope = parseRtcSignalEnvelope(body);
    if (!envelope) return new Response("bad envelope", { status: 400 });
    if (!(await this.withIdentity(() => this.setActor(envelope.to))))
      return new Response("wrong actor", { status: 409 });
    const hub = await this.ensureHub();
    if (!hub) return new Response("no actor", { status: 409 });
    await hub.handleInboundSignal(envelope);
    await this.scheduleAlarm();
    return new Response(null, { status: 204 });
  }

  // -------------------------------------------------------------------------
  // Hibernatable WebSocket events
  // -------------------------------------------------------------------------
  async webSocketMessage(
    ws: DoWebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const frame = parseClientToHubFrame(message);
    if (!frame) return;
    const event = this.startEvent();
    try {
      const hub = await this.ensureHub();
      if (!hub) {
        this.send(ws, { t: "error", code: "no_session" });
        return;
      }
      await hub.handleClientFrame(this.wrap(ws), frame);
      await this.scheduleAlarm();
    } finally {
      await this.finishEvent(event);
    }
  }

  async webSocketClose(ws: DoWebSocket): Promise<void> {
    try {
      ws.close();
    } catch {
      // already closing
    }
  }

  async webSocketError(): Promise<void> {
    // getWebSockets() excludes the errored socket automatically.
  }

  async alarm(): Promise<void> {
    const event = this.startEvent();
    try {
      const hub = await this.ensureHub();
      hub?.tick();
      const active = (hub?.activeCalls().length ?? 0) > 0;
      const connected = this.state.getWebSockets().length > 0;
      if (active || connected) await this.scheduleAlarm(true);
    } finally {
      await this.finishEvent(event);
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------
  /** Only credential/identity state is serialized, never peer network I/O. */
  private withIdentity<T>(work: () => Promise<T>): Promise<T> {
    const result = this.identityTail.then(work);
    this.identityTail = result.catch(() => {});
    return result;
  }

  private async setActor(actor: string): Promise<boolean> {
    const stored =
      this.actorApId ?? (await this.state.storage.get<string>(ACTOR_KEY));
    if (stored !== undefined && stored !== null) {
      this.actorApId = stored;
      return stored === actor;
    }
    await this.state.storage.put(ACTOR_KEY, actor);
    this.actorApId = actor;
    return true;
  }

  private async ensureHub(): Promise<CallHub | null> {
    if (this.hub) return this.hub;
    if (!this.loadingHub) this.loadingHub = this.loadHub();
    try {
      return await this.loadingHub;
    } finally {
      this.loadingHub = null;
    }
  }

  private async loadHub(): Promise<CallHub | null> {
    const actor =
      this.actorApId ?? (await this.state.storage.get<string>(ACTOR_KEY));
    if (!actor) return null;
    this.actorApId = actor;

    const db = getDb(this.env.DB);
    const storage = this.state.storage;
    const base = createCallHubPort({
      localActorApId: actor,
      db,
      env: this.env,
      broadcast: (frame: HubToClientFrame) => {
        for (const ws of this.state.getWebSockets()) this.send(ws, frame);
      },
      hasClients: () => this.state.getWebSockets().length > 0,
    });
    // Layer durable DO storage on top of the D1 persist so the in-memory call
    // map survives hibernation.
    const hub = new CallHub({
      ...base,
      persist: (call: CallRecord) => {
        // CallHub mutates records in place. Capture this exact transition before
        // another reentrant event can update it, and keep writes in that order.
        const snapshot = structuredClone(call);
        this.trackWrite(async () => {
          if (isTerminalCallState(snapshot.state)) {
            await storage.delete(`${CALL_PREFIX}${snapshot.callId}`);
          } else {
            await storage.put(`${CALL_PREFIX}${snapshot.callId}`, snapshot);
          }
          await base.persist?.(snapshot);
        });
      },
    });
    const stored = await storage.list<CallRecord>({ prefix: CALL_PREFIX });
    hub.hydrate([...stored.values()]);
    this.hub = hub;
    return hub;
  }

  private trackWrite(work: () => Promise<void>): void {
    const write = this.writeTail.then(work);
    // Attach a rejection handler immediately: CallHub intentionally has a
    // synchronous persist callback. The enclosing native handler awaits it.
    const tracked = write.then(
      () => ({}),
      (error) => {
        this.refreshHub = true;
        return { error };
      },
    );
    this.pendingWrites.set(this.nextWrite++, tracked);
    this.writeTail = tracked.then(() => {});
  }

  private async flushWrites(firstWrite: number): Promise<void> {
    // Do not remove in-flight work before awaiting: overlapping native events
    // must each wait for all writes already issued when that event ends.
    const pending = [...this.pendingWrites]
      .filter(([sequence]) => sequence >= firstWrite)
      .map(([, write]) => write);
    const outcomes = await Promise.all(pending);
    const failed = outcomes.find((outcome) => "error" in outcome);
    if (failed) throw failed.error;
  }

  private startEvent(): { firstWrite: number } {
    const event = { firstWrite: this.nextWrite };
    this.activeEvents.add(event);
    return event;
  }

  private async finishEvent(event: { firstWrite: number }): Promise<void> {
    try {
      await this.flushWrites(event.firstWrite);
    } finally {
      this.activeEvents.delete(event);
      let firstNeeded = this.nextWrite;
      for (const active of this.activeEvents)
        firstNeeded = Math.min(firstNeeded, active.firstWrite);
      // Keep failures visible to every overlapping handler that may own that
      // write, even if another handler finished and observed it first.
      for (const sequence of this.pendingWrites.keys())
        if (sequence < firstNeeded) this.pendingWrites.delete(sequence);
      // Never replace a shared hub while another native event still owns a
      // continuation after peer I/O. Once quiescent, retry from durable state.
      if (this.activeEvents.size === 0 && this.refreshHub) {
        this.hub = null;
        this.refreshHub = false;
      }
    }
  }

  private wrap(ws: DoWebSocket) {
    return {
      send: (frame: HubToClientFrame) => this.send(ws, frame),
      close: (code?: number, reason?: string) => {
        try {
          ws.close(code, reason);
        } catch {
          // ignore
        }
      },
    };
  }

  private send(ws: DoWebSocket, frame: HubToClientFrame): void {
    try {
      ws.send(JSON.stringify(frame));
    } catch {
      // socket gone; getWebSockets() will drop it
    }
  }

  private async scheduleAlarm(force = false): Promise<void> {
    const existing = await this.state.storage.getAlarm();
    if (existing !== null && !force) return;
    await this.state.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
  }
}

// Re-exported here so the type is available to callers that only import the DO.
export type { RtcSignalEnvelopeV1 };
