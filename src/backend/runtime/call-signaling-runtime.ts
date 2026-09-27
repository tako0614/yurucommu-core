/** Application-owned call lifecycle shared by native DO and candidate Actor. */
import { CallHub, type CallRecord, type HubPort } from "./call-hub-core.ts";
import {
  isTerminalCallState,
  parseClientToHubFrame,
  parseRtcSignalEnvelope,
  type HubToClientFrame,
} from "../../../packages/api/src/types/call.ts";
import {
  consumeOneTimeTicket,
  mintOneTimeTicket,
  type OneTimeTicketStorage,
} from "./one-time-ticket.ts";

export interface CallSocket {
  send(data: string): void | Promise<void>;
  close(code?: number, reason?: string): void | Promise<void>;
}
export interface CallSignalingTransport {
  list(): Promise<readonly CallSocket[]>;
  accept(request: Request): Promise<Response>;
  getAlarm(): Promise<number | null>;
  setAlarm(at: number): Promise<void>;
}
export type CallPortFactory = (
  actor: string,
  clients: Pick<HubPort, "broadcast" | "hasClients">,
) => HubPort;

/** Drain every synchronous HubPort callback before the hosting event settles. */
class CallEffects {
  private tail: Promise<void> = Promise.resolve();
  private failures: unknown[] = [];
  private storageFailed = false;
  add(effect: () => void | Promise<unknown>, durable = false): void {
    this.tail = this.tail
      .then(() => {
        // Do not announce a state whose required durable write failed. Transport
        // failure, in contrast, must not starve other sockets or later writes.
        if (!this.storageFailed) return effect();
      })
      .then(
        () => {},
        (error) => {
          this.failures.push(error);
          if (durable) this.storageFailed = true;
        },
      );
  }
  async drain(): Promise<void> {
    await this.tail;
    if (this.failures.length) throw this.failures[0];
  }
}

export class CallSignalingRuntime {
  // Native DO events can interleave on network awaits. Actor Host serialization
  // remains authoritative; this queue is not a Host lifetime implementation.
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly storage: OneTimeTicketStorage,
    private readonly transport: CallSignalingTransport,
    private readonly createPort: CallPortFactory,
  ) {}
  private turn<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.catch(() => {});
    return result;
  }
  fetch(request: Request): Promise<Response> {
    return this.turn(async () => {
      const path = new URL(request.url).pathname;
      if (path === "/_ticket") {
        if (request.method !== "POST")
          return new Response("method not allowed", { status: 405 });
        const actor = request.headers.get("X-Call-Actor");
        if (!actor) return new Response("missing actor", { status: 400 });
        if (!(await this.bindActor(actor)))
          return new Response("wrong actor", { status: 409 });
        return Response.json({
          ticket: await mintOneTimeTicket(this.storage, { prefix: "ticket:" }),
        });
      }
      if (path === "/_ws") {
        if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
          return new Response("expected websocket", { status: 426 });
        if (request.headers.get("X-Call-Auth") !== "ticket")
          return new Response("unauthorized", { status: 401 });
        const ticket = request.headers.get("X-Call-Ticket") ?? "";
        if (
          !ticket ||
          !(await consumeOneTimeTicket(this.storage, ticket, {
            prefix: "ticket:",
          }))
        )
          return new Response("invalid ticket", { status: 401 });
        const actor = request.headers.get("X-Call-Actor");
        if (!actor) return new Response("missing actor", { status: 400 });
        if (!(await this.bindActor(actor)))
          return new Response("wrong actor", { status: 409 });
        const response = await this.transport.accept(request);
        await this.scheduleAlarm();
        return response;
      }
      if (path === "/_ingest") {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response("bad json", { status: 400 });
        }
        const envelope = parseRtcSignalEnvelope(body);
        if (!envelope) return new Response("bad envelope", { status: 400 });
        if (!(await this.bindActor(envelope.to)))
          return new Response("wrong actor", { status: 409 });
        await this.withHub(async (hub) => {
          await hub?.handleInboundSignal(envelope);
        });
        return new Response(null, { status: 204 });
      }
      return new Response("not found", { status: 404 });
    });
  }
  message(socket: CallSocket, data: unknown): Promise<void> {
    const frame = parseClientToHubFrame(data);
    if (!frame) return Promise.resolve();
    return this.turn(() =>
      this.withHub(async (hub, effects) => {
        const send = (value: HubToClientFrame) => {
          const bytes = JSON.stringify(value);
          effects.add(() => socket.send(bytes));
        };
        if (!hub) {
          send({ t: "error", code: "no_session" });
          return;
        }
        await hub.handleClientFrame(
          {
            send,
            close: (code, reason) =>
              effects.add(() => socket.close(code, reason)),
          },
          frame,
        );
      }),
    );
  }
  alarm(): Promise<void> {
    return this.turn(() =>
      this.withHub(async (hub) => {
        hub?.tick();
      }, true),
    );
  }
  private async bindActor(actor: string): Promise<boolean> {
    const stored = await this.storage.get<string>("actor");
    if (stored !== undefined) return stored === actor;
    await this.storage.put("actor", actor);
    return true;
  }
  private async withHub(
    work: (hub: CallHub | null, effects: CallEffects) => Promise<void>,
    alarm = false,
  ): Promise<void> {
    const effects = new CallEffects();
    const actor = await this.storage.get<string>("actor");
    const sockets = await this.transport.list();
    let hub: CallHub | null = null;
    if (actor) {
      const base = this.createPort(actor, {
        hasClients: () => sockets.length > 0,
        broadcast: (frame) => {
          const bytes = JSON.stringify(frame);
          for (const socket of sockets) effects.add(() => socket.send(bytes));
        },
      });
      hub = new CallHub({
        ...base,
        persist: (call) => {
          const snapshot = structuredClone(call);
          effects.add(async () => {
            if (isTerminalCallState(snapshot.state))
              await this.storage.delete(`call:${snapshot.callId}`);
            else await this.storage.put(`call:${snapshot.callId}`, snapshot);
            await base.persist?.(snapshot);
          }, true);
        },
        ring: (envelope) => effects.add(() => base.ring?.(envelope)),
      });
      hub.hydrate([
        ...(await this.storage.list<CallRecord>({ prefix: "call:" })).values(),
      ]);
    }
    // Schedule before tick/drain: set-then-throw retains the Actor obligation
    // and successor. Never clear a successor on retry or impose a retry cap.
    if (!alarm || (hub?.activeCalls().length ?? 0) > 0 || sockets.length > 0)
      await this.scheduleAlarm();
    try {
      await work(hub, effects);
    } finally {
      await effects.drain();
    }
    // Rehydrate each event, including after a partially failed prior event.
  }
  private async scheduleAlarm(): Promise<void> {
    if ((await this.transport.getAlarm()) === null)
      await this.transport.setAlarm(Date.now() + 15_000);
  }
}
