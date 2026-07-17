/**
 * Shared HubPort construction. Both the Cloudflare DO and the in-process Bun
 * hub build their `HubPort` from these deps, so signer loading, media
 * provisioning, and durable persistence are single-sourced.
 */

import { eq } from "drizzle-orm";
import type { Database } from "../../db/index.ts";
import { actors } from "../../db/index.ts";
import type { EnvVars } from "../types.ts";
import type { RtcSignalEnvelopeV1 } from "../../../packages/api/src/types/call.ts";
import type { CallRecord, HubConnection, HubPort } from "./call-hub-core.ts";
import {
  type CallSigner,
  sendCallSignal,
} from "../lib/rtc/signal-transport.ts";
import { createRtcProvider } from "../lib/rtc/provider.ts";
import { upsertCallSession } from "../lib/rtc/call-store.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ component: "call.hub" });

export interface CallHubPortDeps {
  localActorApId: string;
  db: Database;
  env: EnvVars;
  broadcast(frame: Parameters<HubConnection["send"]>[0]): void;
  hasClients(): boolean;
  ring?(envelope: RtcSignalEnvelopeV1): Promise<void> | void;
}

export function createCallHubPort(deps: CallHubPortDeps): HubPort {
  const provider = createRtcProvider(deps.env);
  let signer: CallSigner | null = null;

  const loadSigner = async (): Promise<CallSigner> => {
    if (signer) return signer;
    const row = await deps.db.query.actors.findFirst({
      where: eq(actors.apId, deps.localActorApId),
      columns: { apId: true, privateKeyPem: true },
    });
    if (!row?.privateKeyPem) {
      throw new Error(`no signing key for local actor ${deps.localActorApId}`);
    }
    signer = { apId: row.apId, privateKeyPem: row.privateKeyPem };
    return signer;
  };

  return {
    localActorApId: deps.localActorApId,
    broadcast: deps.broadcast,
    hasClients: deps.hasClients,
    ring: deps.ring,
    now: () => Date.now(),
    log: (event, data) => log.info(event, data),
    async sendToPeer(envelope, peerSignalEndpoint) {
      const s = await loadSigner();
      await sendCallSignal(deps.db, s, envelope, peerSignalEndpoint);
    },
    async provisionMedia(media) {
      const [iceServers, sfuFocus] = await Promise.all([
        provider.getIceServers(),
        provider.getSfuFocus(media),
      ]);
      return { iceServers, sfuFocus };
    },
    async persist(call: CallRecord) {
      try {
        await upsertCallSession(deps.db, deps.localActorApId, call);
      } catch (err) {
        log.warn("call session persist failed", {
          callId: call.callId,
          error: String(err),
        });
      }
    },
  };
}
