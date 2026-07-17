/**
 * ISignalingHub — the seam that decouples call signaling from the Durable Object
 * runtime. The `/api/rtc/socket` and `/ap/rtc/signal` routes talk to this
 * interface; on Cloudflare it forwards to the per-user `CallSignalingDurable
 * Object`, and on a Bun/Node self-host it uses an in-process hub.
 *
 * The DO instance itself is addressed by `idFromName(actorApId)`, so signaling
 * for a given local user always lands on the same object regardless of which
 * edge handled the request.
 */

import type { Env } from "../types.ts";
import type { RtcSignalEnvelopeV1 } from "../../../packages/api/src/types/call.ts";
import type {
  ClientToHubFrame,
  HubToClientFrame,
} from "../../../packages/api/src/types/call.ts";
import { CallHub, type HubConnection } from "./call-hub-core.ts";
import { createCallHubPort } from "./call-hub-port.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ component: "rtc.hub" });

export interface ISignalingHub {
  /** Handle a browser WebSocket upgrade for `actorApId` (returns 101). */
  upgrade(request: Request, actorApId: string): Promise<Response>;
  /** Push an inbound cross-instance signal to `actorApId`'s live sockets. */
  deliver(actorApId: string, envelope: RtcSignalEnvelopeV1): Promise<void>;
}

// ---------------------------------------------------------------------------
// Cloudflare: forward to the per-user Durable Object
// ---------------------------------------------------------------------------
class CloudflareSignalingHub implements ISignalingHub {
  constructor(private readonly ns: DurableObjectNamespace) {}

  private stub(actorApId: string): DurableObjectStub {
    return this.ns.get(this.ns.idFromName(actorApId));
  }

  async upgrade(request: Request, actorApId: string): Promise<Response> {
    const headers = new Headers(request.headers);
    headers.set("X-Call-Actor", actorApId);
    const forwarded = new Request("https://call-do/_ws", {
      method: "GET",
      headers,
    });
    return this.stub(actorApId).fetch(
      forwarded as unknown as Parameters<DurableObjectStub["fetch"]>[0],
    ) as unknown as Promise<Response>;
  }

  async deliver(
    actorApId: string,
    envelope: RtcSignalEnvelopeV1,
  ): Promise<void> {
    await this.stub(actorApId).fetch("https://call-do/_ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(envelope),
    });
  }
}

// ---------------------------------------------------------------------------
// In-process (Bun/Node self-host): a per-actor CallHub + live socket set.
// The Bun server WebSocket wiring drives attach()/message()/detach(); the DO-
// less runtime therefore keeps calls working without Cloudflare.
// ---------------------------------------------------------------------------
export interface LocalSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

interface LocalUserHub {
  hub: CallHub;
  sockets: Set<LocalSocket>;
}

class LocalSignalingHub implements ISignalingHub {
  private readonly users = new Map<string, LocalUserHub>();

  constructor(private readonly env: Env) {}

  private getOrCreate(actorApId: string): LocalUserHub {
    let entry = this.users.get(actorApId);
    if (entry) return entry;
    const sockets = new Set<LocalSocket>();
    const port = createCallHubPort({
      localActorApId: actorApId,
      db: this.env.DB_INSTANCE,
      env: this.env,
      broadcast: (frame: HubToClientFrame) => {
        const data = JSON.stringify(frame);
        for (const s of sockets) {
          try {
            s.send(data);
          } catch {
            // drop dead socket on next detach
          }
        }
      },
      hasClients: () => sockets.size > 0,
    });
    entry = { hub: new CallHub(port), sockets };
    this.users.set(actorApId, entry);
    return entry;
  }

  private wrap(socket: LocalSocket): HubConnection {
    return {
      send: (frame) => socket.send(JSON.stringify(frame)),
      close: (code, reason) => socket.close(code, reason),
    };
  }

  /** Register a live browser socket (called by the Bun server WS handler). */
  attach(actorApId: string, socket: LocalSocket): void {
    this.getOrCreate(actorApId).sockets.add(socket);
  }

  detach(actorApId: string, socket: LocalSocket): void {
    this.users.get(actorApId)?.sockets.delete(socket);
  }

  /** Route a browser frame (called by the Bun server WS message handler). */
  async message(
    actorApId: string,
    socket: LocalSocket,
    raw: string,
  ): Promise<void> {
    let frame: ClientToHubFrame;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.t !== "string") return;
      frame = parsed as ClientToHubFrame;
    } catch {
      return;
    }
    await this.getOrCreate(actorApId).hub.handleClientFrame(
      this.wrap(socket),
      frame,
    );
  }

  async upgrade(_request: Request, _actorApId: string): Promise<Response> {
    // The Bun runtime upgrades WebSockets at the server boundary (server.upgrade)
    // and drives attach()/message()/detach() directly, so this Hono-level path is
    // never used there. Reaching it means a runtime without Durable Objects and
    // without the Bun WS wiring.
    return new Response(
      JSON.stringify({
        error: "signaling_unavailable",
        message: "Call signaling requires the Durable Objects runtime.",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  async deliver(
    actorApId: string,
    envelope: RtcSignalEnvelopeV1,
  ): Promise<void> {
    await this.getOrCreate(actorApId).hub.handleInboundSignal(envelope);
  }
}

// One in-process hub per worker process (Bun/Node path only).
let localHubSingleton: LocalSignalingHub | null = null;

/** Resolve the signaling hub for this runtime. */
export function getSignalingHub(env: Env): ISignalingHub {
  if (env.CALL_SIGNALING) {
    return new CloudflareSignalingHub(env.CALL_SIGNALING);
  }
  if (!localHubSingleton) localHubSingleton = new LocalSignalingHub(env);
  return localHubSingleton;
}

/** Whether calls can be served on this runtime (a signaling transport exists). */
export function isSignalingAvailable(env: Env): boolean {
  // Cloudflare DO binding is the supported production transport. (The in-process
  // Bun hub exists but its browser WS wiring is host-server-driven.)
  return Boolean(env.CALL_SIGNALING);
}

export { log as signalingLog };
