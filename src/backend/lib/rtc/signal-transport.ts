/**
 * Cross-instance call signaling transport (server-to-server).
 *
 * Signaling for a call between two self-hosted instances travels as an
 * HTTP-Signature-signed POST to the peer instance's `/ap/rtc/signal` endpoint.
 * This deliberately does NOT use the queued federation delivery path
 * (`enqueueDeliveryToActor`, with its circuit-breaker + retry/backoff): an SDP
 * offer or ICE candidate is ephemeral and latency-sensitive, so a stale retry is
 * useless. We reuse the same low-level signing (`signRequest`) + SSRF-guarded
 * fetch (`fetchWithTimeout`) primitives the delivery worker uses, but send
 * synchronously and directly. It also does NOT go through the inbox activity
 * pipeline (`claimActivityForDispatch` / `parseActivity`), which would both strip
 * the SDP/ICE fields and pollute the `activities` ledger with ephemeral frames.
 */

import { eq } from "drizzle-orm";
import type { Database } from "../../../db/index.ts";
import { actorCache } from "../../../db/index.ts";
import type { RtcSignalEnvelopeV1 } from "../../../../packages/api/src/types/call.ts";
import { signRequest } from "../ap-signing.ts";
import { fetchWithTimeout } from "../federation-fetch.ts";
import { fetchAndUpsertActorCache } from "../activitypub-actor-cache.ts";
import { isSafeRemoteUrl } from "../ssrf.ts";
import { logger } from "../logger.ts";

const log = logger.child({ component: "rtc.signal-transport" });

const SIGNAL_PATH = "/ap/rtc/signal";
const SIGNAL_TIMEOUT_MS = 8000;

export interface CallSigner {
  apId: string;
  privateKeyPem: string;
}

/** Derive a peer's signaling endpoint from a cached actor row. */
function endpointFromActorRow(row: {
  inbox: string;
  rawJson: string;
}): string | null {
  // Prefer an explicitly advertised endpoint (actor `endpoints.rtcSignal`).
  try {
    const doc = JSON.parse(row.rawJson) as {
      endpoints?: { rtcSignal?: unknown };
    };
    const advertised = doc.endpoints?.rtcSignal;
    if (typeof advertised === "string" && isSafeRemoteUrl(advertised)) {
      return advertised;
    }
  } catch {
    // fall through to inbox-origin derivation
  }
  // Fall back to `<inbox-origin>/ap/rtc/signal` (every yurucommu instance
  // serves this path). Peers that are not yurucommu simply won't answer.
  try {
    const origin = new URL(row.inbox).origin;
    const endpoint = `${origin}${SIGNAL_PATH}`;
    return isSafeRemoteUrl(endpoint) ? endpoint : null;
  } catch {
    return null;
  }
}

/** Resolve (and cache) the peer instance's signaling endpoint URL. */
export async function resolvePeerSignalEndpoint(
  db: Database,
  peerApId: string,
): Promise<string | null> {
  let row = await db.query.actorCache.findFirst({
    where: eq(actorCache.apId, peerApId),
    columns: { inbox: true, rawJson: true },
  });
  if (!row) {
    const result = await fetchAndUpsertActorCache(db, peerApId, {});
    if (result.ok) {
      row = { inbox: result.row.inbox, rawJson: result.row.rawJson };
    }
  }
  if (!row) return null;
  return endpointFromActorRow(row);
}

/**
 * Sign + POST a signaling envelope to the peer instance. Throws on any
 * unreachable / non-2xx outcome so the caller can fail the call fast.
 */
export async function sendCallSignal(
  db: Database,
  signer: CallSigner,
  envelope: RtcSignalEnvelopeV1,
  peerSignalEndpoint?: string,
): Promise<void> {
  const endpoint =
    peerSignalEndpoint ?? (await resolvePeerSignalEndpoint(db, envelope.to));
  if (!endpoint) {
    throw new Error(`no signaling endpoint for ${envelope.to}`);
  }
  const body = JSON.stringify(envelope);
  const keyId = `${signer.apId}#main-key`;
  const signed = await signRequest(
    signer.privateKeyPem,
    keyId,
    "POST",
    endpoint,
    body,
  );
  const res = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: {
      ...signed,
      "Content-Type": "application/activity+json",
      Accept: "application/json",
    },
    body,
    timeout: SIGNAL_TIMEOUT_MS,
  });
  if (!res.ok) {
    log.warn("Signaling POST rejected", {
      callId: envelope.callId,
      type: envelope.type,
      status: res.status,
    });
    throw new Error(`signal POST ${res.status}`);
  }
}
