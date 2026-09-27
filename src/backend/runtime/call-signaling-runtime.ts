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
import { CallRelayJournal } from "./call-relay-journal.ts";
import {
  callIngressDigest,
  parseCallRelayResult,
  type CallRelayJob,
  type CallService,
} from "./call-relay.ts";

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
    private readonly relay?: {
      journal: CallRelayJournal;
      dispatcher: CallService;
    },
  ) {}
  private turn<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.catch(() => {});
    return result;
  }
  fetch(request: Request): Promise<Response> {
    return this.turn(async () => {
      const path = new URL(request.url).pathname;
      if (path === "/_relay-result" || path === "/_continue") {
        if (!this.relay || request.method !== "POST")
          return new Response("not found", { status: 404 });
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response("bad json", { status: 400 });
        }
        const continuation = path === "/_continue";
        const input = body as { result?: unknown; envelope?: unknown } | null;
        const result = parseCallRelayResult(
          continuation ? input?.result : body,
        );
        if (!result) return new Response("bad result", { status: 400 });
        const effect = await this.relay.journal.lookup(result);
        if (!effect)
          return new Response(null, { status: continuation ? 409 : 204 });
        // Glare belongs to the outer request, never the asynchronous callback.
        if ((effect.continuation === "glare") !== continuation)
          return new Response("wrong continuation", { status: 409 });
        const envelope = continuation
          ? parseRtcSignalEnvelope(input?.envelope)
          : null;
        if (
          continuation &&
          (!envelope ||
            (await callIngressDigest(envelope)) !== effect.ingressDigest ||
            envelope.to !== (await this.storage.get<string>("actor")))
        )
          return new Response("wrong ingress", { status: 409 });
        let matched = false;
        const prepared: { jobs: CallRelayJob[]; ingressDigest?: string } = {
          jobs: [],
          ingressDigest: effect.ingressDigest,
        };
        await this.withHub(
          async (hub, effects) => {
            const call = hub
              ?.activeCalls()
              .find((candidate) => candidate.callId === effect.callId);
            if (!hub || call?.generation !== effect.generation) return;
            matched = true;
            hub.completeDeferredRelay(
              effect.callId,
              effect.generation,
              effect.continuation,
              result.outcome === "peer_ack",
            );
            await effects.drain();
            if (envelope) await hub.handleInboundSignal(envelope);
          },
          false,
          prepared,
        );
        await this.relay.journal.remove(effect);
        if (continuation && !matched)
          return new Response("obsolete continuation", { status: 409 });
        return prepared.jobs.length
          ? Response.json({ job: prepared.jobs[0] }, { status: 202 })
          : new Response(null, { status: 204 });
      }
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
        const prepared: { jobs: CallRelayJob[]; ingressDigest?: string } = {
          jobs: [],
          ...(this.relay
            ? { ingressDigest: await callIngressDigest(envelope) }
            : {}),
        };
        await this.withHub(
          async (hub) => {
            await hub?.handleInboundSignal(envelope);
          },
          false,
          prepared,
        );
        return prepared.jobs.length
          ? Response.json({ job: prepared.jobs[0] }, { status: 202 })
          : new Response(null, { status: 204 });
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
    prepared?: { jobs: CallRelayJob[]; ingressDigest?: string },
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
        ...(this.relay
          ? {
              newCallGeneration: () => crypto.randomUUID(),
              deferToPeer: async (
                relay: import("./call-hub-core.ts").DeferredCallRelay,
              ) => {
                await effects.drain();
                const job = await this.relay!.journal.prepare(
                  relay,
                  prepared?.ingressDigest,
                );
                if (prepared) {
                  prepared.jobs.push(job);
                  return;
                }
                try {
                  const response = await this.relay!.dispatcher.fetch(
                    new Request("https://call-dispatcher/_dispatch", {
                      method: "POST",
                      body: JSON.stringify(job),
                    }),
                  );
                  // Acceptance is not a peer result; only the correlated callback
                  // can execute a deferred continuation or report actual failure.
                  if (response.status !== 202)
                    throw new Error("RTC dispatcher refused acceptance");
                  await response.body?.cancel();
                } catch (error) {
                  // Admission may be ambiguous. Never retry this external action.
                  await this.relay!.journal.remove(job.effect);
                  throw error;
                }
              },
            }
          : {}),
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
    if (this.relay && hub) {
      for (const pending of await this.relay.journal.pending()) {
        if (pending.deadline > Date.now()) continue;
        hub.completeDeferredRelay(
          pending.callId,
          pending.generation,
          pending.continuation,
          false,
        );
        await effects.drain();
        await this.relay.journal.remove(pending);
      }
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
