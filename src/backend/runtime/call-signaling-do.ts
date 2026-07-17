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
  ClientToHubFrame,
  HubToClientFrame,
  RtcSignalEnvelopeV1,
} from "../../../packages/api/src/types/call.ts";
import {
  isTerminalCallState,
  parseRtcSignalEnvelope,
} from "../../../packages/api/src/types/call.ts";

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

export class CallSignalingDurableObject {
  private hub: CallHub | null = null;
  private actorApId: string | null = null;

  constructor(
    private readonly state: DoState,
    private readonly env: CallDoEnv,
  ) {}

  // -------------------------------------------------------------------------
  // HTTP entry (from the CloudflareSignalingHub adapter)
  // -------------------------------------------------------------------------
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/_ws") {
      return this.handleUpgrade(request, url);
    }
    if (url.pathname === "/_ingest") {
      return this.handleIngest(request);
    }
    return new Response("not found", { status: 404 });
  }

  private async handleUpgrade(request: Request, url: URL): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const actor =
      request.headers.get("X-Call-Actor") ?? url.searchParams.get("actor");
    if (!actor) return new Response("missing actor", { status: 400 });
    await this.setActor(actor);

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

  private async handleIngest(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response("bad json", { status: 400 });
    }
    const envelope = parseRtcSignalEnvelope(body);
    if (!envelope) return new Response("bad envelope", { status: 400 });
    await this.setActor(envelope.to);
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
    if (typeof message !== "string") return;
    let frame: ClientToHubFrame;
    try {
      const parsed = JSON.parse(message);
      if (!parsed || typeof parsed.t !== "string") return;
      frame = parsed as ClientToHubFrame;
    } catch {
      return;
    }
    const hub = await this.ensureHub();
    if (!hub) {
      this.send(ws, { t: "error", code: "no_session" });
      return;
    }
    await hub.handleClientFrame(this.wrap(ws), frame);
    await this.scheduleAlarm();
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
    const hub = await this.ensureHub();
    hub?.tick();
    const active = (hub?.activeCalls().length ?? 0) > 0;
    const connected = this.state.getWebSockets().length > 0;
    if (active || connected) await this.scheduleAlarm(true);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------
  private async setActor(actor: string): Promise<void> {
    if (this.actorApId === actor) return;
    this.actorApId = actor;
    await this.state.storage.put(ACTOR_KEY, actor);
  }

  private async ensureHub(): Promise<CallHub | null> {
    if (this.hub) return this.hub;
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
      persist: async (call: CallRecord) => {
        if (isTerminalCallState(call.state)) {
          await storage.delete(`${CALL_PREFIX}${call.callId}`);
        } else {
          await storage.put(`${CALL_PREFIX}${call.callId}`, call);
        }
        await base.persist?.(call);
      },
    });
    const stored = await storage.list<CallRecord>({ prefix: CALL_PREFIX });
    hub.hydrate([...stored.values()]);
    this.hub = hub;
    return hub;
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
