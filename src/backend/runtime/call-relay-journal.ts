import type { DeferredCallRelay } from "./call-hub-core.ts";
import type { OneTimeTicketStorage } from "./one-time-ticket.ts";
import {
  CALL_RELAY_JOB_MAX_BYTES,
  CALL_RELAY_MAX_PENDING,
  CALL_RELAY_TIMEOUT_MS,
  parseCallRelayEffect,
  type CallRelayEffect,
  type CallRelayJob,
  type CallRelayResult,
} from "./call-relay.ts";

/** Bounded correlation metadata, never a durable signal outbox or retry queue. */
export class CallRelayJournal {
  constructor(private readonly storage: OneTimeTicketStorage) {}
  async pending(): Promise<CallRelayEffect[]> {
    const records = await this.storage.list<unknown>({ prefix: "relay:" });
    const effects: CallRelayEffect[] = [];
    for (const [key, value] of records) {
      const effect = parseCallRelayEffect(value);
      if (!effect || key !== `relay:${effect.effectId}`)
        throw new Error("invalid RTC relay metadata");
      effects.push(effect);
    }
    if (effects.length > CALL_RELAY_MAX_PENDING)
      throw new Error("RTC relay metadata capacity exceeded");
    return effects;
  }
  async prepare(
    relay: DeferredCallRelay,
    ingressDigest?: string,
  ): Promise<CallRelayJob> {
    const effect = parseCallRelayEffect({
      effectId: crypto.randomUUID(),
      callId: relay.call.callId,
      generation: relay.call.generation,
      deadline: Math.min(
        Date.now() + CALL_RELAY_TIMEOUT_MS,
        relay.envelope.ts + relay.envelope.ttlMs,
      ),
      signalType: relay.envelope.type,
      continuation: relay.continuation,
      ...(ingressDigest ? { ingressDigest } : {}),
    });
    if (!effect || effect.deadline <= Date.now())
      throw new Error("invalid RTC relay deadline or generation");
    const job = {
      effect,
      envelope: relay.envelope,
      ...(relay.call.peerSignalEndpoint
        ? { peerSignalEndpoint: relay.call.peerSignalEndpoint }
        : {}),
    };
    if (
      new TextEncoder().encode(JSON.stringify(job)).length >
      CALL_RELAY_JOB_MAX_BYTES
    )
      throw new Error("RTC relay job capacity exceeded");
    if ((await this.pending()).length >= CALL_RELAY_MAX_PENDING)
      throw new Error("RTC relay metadata capacity exceeded");
    await this.storage.put(`relay:${effect.effectId}`, effect);
    return job;
  }
  async lookup(result: CallRelayResult): Promise<CallRelayEffect | null> {
    const effect = parseCallRelayEffect(
      await this.storage.get(`relay:${result.effectId}`),
    );
    if (
      !effect ||
      effect.effectId !== result.effectId ||
      effect.callId !== result.callId ||
      effect.generation !== result.generation ||
      effect.deadline !== result.deadline ||
      effect.deadline <= Date.now()
    )
      return null;
    return effect;
  }
  async remove(effect: CallRelayEffect): Promise<void> {
    await this.storage.delete(`relay:${effect.effectId}`);
  }
}
