/** Application-owned, unpublished RTC handoff. Never a federation wire format. */
import {
  parseRtcSignalEnvelope,
  type RtcSignalEnvelopeV1,
} from "../../../packages/api/src/types/call.ts";

export const CALL_RELAY_JOB_MAX_BYTES = 4 * 1024 * 1024;
export const CALL_RELAY_MAX_PENDING = 64;
export const CALL_RELAY_TIMEOUT_MS = 10_000;
export const CALL_RELAY_CALLBACK_TIMEOUT_MS = 5_000;
export const CALL_RELAY_METADATA_MAX_BYTES = 2_048;

export type CallRelayContinuation =
  "none" | "rejected" | "ended" | "cancelled" | "glare";

/** This is the ONLY durable handoff record. No SDP, ICE, body or signed headers. */
export interface CallRelayEffect {
  effectId: string;
  callId: string;
  generation: string;
  deadline: number;
  signalType: RtcSignalEnvelopeV1["type"];
  continuation: CallRelayContinuation;
  ingressDigest?: string;
}

/** Bounded memory only, released after one peer attempt. NEVER log/persist it. */
export interface CallRelayJob {
  effect: CallRelayEffect;
  envelope: RtcSignalEnvelopeV1;
  peerSignalEndpoint?: string;
}

export interface CallRelayResult {
  effectId: string;
  callId: string;
  generation: string;
  deadline: number;
  outcome: "peer_ack" | "failed";
}

export interface CallService {
  fetch(request: Request): Promise<Response>;
}

const types = new Set([
  "offer",
  "answer",
  "candidate",
  "accept",
  "reject",
  "hangup",
  "cancel",
]);
const continuations = new Set([
  "none",
  "rejected",
  "ended",
  "cancelled",
  "glare",
]);
const id = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function parseCallRelayEffect(value: unknown): CallRelayEffect | null {
  if (
    !object(value) ||
    !id(value.effectId) ||
    !id(value.generation) ||
    typeof value.callId !== "string" ||
    !value.callId.length ||
    value.callId.length > 200 ||
    typeof value.deadline !== "number" ||
    !Number.isSafeInteger(value.deadline) ||
    value.deadline < 0 ||
    typeof value.signalType !== "string" ||
    !types.has(value.signalType) ||
    typeof value.continuation !== "string" ||
    !continuations.has(value.continuation)
  )
    return null;
  if (
    value.ingressDigest !== undefined &&
    (typeof value.ingressDigest !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.ingressDigest))
  )
    return null;
  const effect = {
    effectId: value.effectId,
    callId: value.callId,
    generation: value.generation,
    deadline: value.deadline,
    signalType: value.signalType,
    continuation: value.continuation,
    ...(value.ingressDigest !== undefined
      ? { ingressDigest: value.ingressDigest }
      : {}),
  } as CallRelayEffect;
  return new TextEncoder().encode(JSON.stringify(effect)).length <=
    CALL_RELAY_METADATA_MAX_BYTES
    ? effect
    : null;
}

export function parseCallRelayJob(value: unknown): CallRelayJob | null {
  if (!object(value)) return null;
  const effect = parseCallRelayEffect(value.effect);
  const envelope = parseRtcSignalEnvelope(value.envelope);
  if (
    !effect ||
    !envelope ||
    effect.callId !== envelope.callId ||
    effect.signalType !== envelope.type ||
    (value.peerSignalEndpoint !== undefined &&
      typeof value.peerSignalEndpoint !== "string")
  )
    return null;
  return {
    effect,
    envelope,
    ...(typeof value.peerSignalEndpoint === "string"
      ? { peerSignalEndpoint: value.peerSignalEndpoint }
      : {}),
  };
}

export function parseCallRelayResult(value: unknown): CallRelayResult | null {
  if (
    !object(value) ||
    !id(value.effectId) ||
    !id(value.generation) ||
    typeof value.callId !== "string" ||
    !value.callId.length ||
    value.callId.length > 200 ||
    typeof value.deadline !== "number" ||
    !Number.isSafeInteger(value.deadline) ||
    value.deadline < 0 ||
    (value.outcome !== "peer_ack" && value.outcome !== "failed")
  )
    return null;
  return {
    effectId: value.effectId,
    callId: value.callId,
    generation: value.generation,
    deadline: value.deadline,
    outcome: value.outcome,
  };
}

export function callRelayResult(
  effect: CallRelayEffect,
  outcome: CallRelayResult["outcome"],
): CallRelayResult {
  return {
    effectId: effect.effectId,
    callId: effect.callId,
    generation: effect.generation,
    deadline: effect.deadline,
    outcome,
  };
}

export async function callIngressDigest(
  envelope: RtcSignalEnvelopeV1,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(envelope)),
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
