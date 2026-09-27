/** Request-owned inbound RTC continuation; call only AFTER existing RTC auth. */
import type { RtcSignalEnvelopeV1 } from "../../../packages/api/src/types/call.ts";
import {
  callRelayResult,
  parseCallRelayJob,
  parseCallRelayResult,
  type CallService,
} from "./call-relay.ts";

/**
 * The outer Worker retains the authenticated inbound envelope in request memory
 * while a glare cancellation crosses the network OUTSIDE the Actor event. Only
 * completed Actor processing permits the caller to return the public 204.
 * No request/cancellation/continuation is retried on an ambiguous acknowledgement.
 */
export async function deliverCallSignalThroughActor(
  actor: CallService,
  dispatcher: CallService,
  envelope: RtcSignalEnvelopeV1,
): Promise<void> {
  let response = await actor.fetch(
    new Request("https://call-actor/_ingest", {
      method: "POST",
      body: JSON.stringify(envelope),
    }),
  );
  for (let step = 0; step < 4; step++) {
    if (response.status === 204) return;
    if (response.status !== 202)
      throw new Error("RTC Actor ingest did not complete");
    const body = (await response.json()) as { job?: unknown };
    const job = parseCallRelayJob(body.job);
    if (
      !job ||
      job.effect.continuation !== "glare" ||
      job.envelope.from !== envelope.to ||
      job.envelope.to !== envelope.from
    )
      throw new Error("invalid RTC glare continuation");
    let result = callRelayResult(job.effect, "failed");
    try {
      const dispatched = await dispatcher.fetch(
        new Request("https://call-dispatcher/_send", {
          method: "POST",
          body: JSON.stringify(job),
        }),
      );
      if (dispatched.ok) {
        const actual = parseCallRelayResult(await dispatched.json());
        if (
          !actual ||
          actual.effectId !== job.effect.effectId ||
          actual.callId !== job.effect.callId ||
          actual.generation !== job.effect.generation ||
          actual.deadline !== job.effect.deadline
        )
          throw new Error("invalid RTC transport result");
        result = actual;
      }
    } catch {
      // Unknown peer outcome is failure, never grounds for a second POST.
    }
    response = await actor.fetch(
      new Request("https://call-actor/_continue", {
        method: "POST",
        body: JSON.stringify({ result, envelope }),
      }),
    );
  }
  if (response.status !== 204)
    throw new Error("RTC glare continuation capacity exceeded");
}
