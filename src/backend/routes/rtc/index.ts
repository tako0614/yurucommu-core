/**
 * Call feature routes (WebRTC voice + video).
 *
 *   POST /ap/rtc/signal    server-to-server signaling ingest (HTTP-Signature)
 *   GET  /api/rtc/socket   browser WebSocket upgrade -> per-user signaling hub
 *   GET  /api/rtc/ice      mint short-lived ICE (STUN/TURN) servers
 *   POST /api/rtc/calls    start a call (block-list gate + callId + ICE)
 *   GET  /api/rtc/calls    call history (missed / recent)
 *   GET  /api/rtc/calls/:id current state of one call
 *
 * Signaling is intentionally OUTSIDE the ActivityPub inbox pipeline: the
 * `/ap/rtc/signal` endpoint bypasses `claimActivityForDispatch` /
 * `parseActivity` (which would strip SDP/ICE and persist ephemeral frames to the
 * `activities` ledger). It reuses the same HTTP-Signature auth every inbox uses.
 */

import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Env, Variables } from "../../types.ts";
import { actors } from "../../../db/index.ts";
import { verifyHttpSignature } from "../../lib/ap-verify.ts";
import {
  isActorMismatch,
  signingActorFromKeyId,
} from "../activitypub/inbox.ts";
import { isActorBlocked } from "../../lib/blocklist.ts";
import {
  getSignalingHub,
  isSignalingAvailable,
} from "../../runtime/signaling-hub.ts";
import { createRtcProvider } from "../../lib/rtc/provider.ts";
import { getCallSession, listCallSessions } from "../../lib/rtc/call-store.ts";
import type {
  CallMediaKind,
  StartCallRequest,
} from "../../../../packages/api/src/types/call.ts";
import { parseRtcSignalEnvelope } from "../../../../packages/api/src/types/call.ts";

const rtc = new Hono<{ Bindings: Env; Variables: Variables }>();

function normalizeMedia(input: unknown): CallMediaKind {
  if (input && typeof input === "object") {
    const m = input as Partial<CallMediaKind>;
    return { audio: m.audio !== false, video: Boolean(m.video) };
  }
  return { audio: true, video: false };
}

// --- Server-to-server signaling ingest -------------------------------------
rtc.post("/ap/rtc/signal", async (c) => {
  const db = c.get("db");
  const body = await c.req.text();
  const sig = await verifyHttpSignature(c.req.raw, db, body);
  if (!sig.valid) return c.json({ error: "invalid_signature" }, 401);

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return c.json({ error: "bad_json" }, 400);
  }
  const envelope = parseRtcSignalEnvelope(parsed);
  if (!envelope) return c.json({ error: "bad_envelope" }, 400);

  // The HTTP-Signature signer must own the claimed `from` actor.
  if (isActorMismatch(signingActorFromKeyId(sig.keyId), envelope.from)) {
    return c.json({ error: "signer_mismatch" }, 403);
  }

  // The recipient must be a local actor served by this instance.
  const local = await db.query.actors.findFirst({
    where: eq(actors.apId, envelope.to),
    columns: { apId: true },
  });
  if (!local) return c.json({ error: "unknown_recipient" }, 404);

  // Never ring for a sender the local owner has blocked; drop silently.
  if (await isActorBlocked(db, envelope.from)) return c.body(null, 204);

  await getSignalingHub(c.env).deliver(envelope.to, envelope);
  return c.body(null, 204);
});

// --- Browser WebSocket upgrade ---------------------------------------------
rtc.get("/api/rtc/socket", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "unauthorized" }, 401);
  if (!isSignalingAvailable(c.env)) {
    return c.json({ error: "signaling_unavailable" }, 503);
  }
  return getSignalingHub(c.env).upgrade(c.req.raw, actor.ap_id);
});

// --- ICE servers ------------------------------------------------------------
rtc.get("/api/rtc/ice", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "unauthorized" }, 401);
  const iceServers = await createRtcProvider(c.env).getIceServers();
  return c.json({ iceServers });
});

// --- Start a call -----------------------------------------------------------
rtc.post("/api/rtc/calls", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "unauthorized" }, 401);
  if (!isSignalingAvailable(c.env)) {
    return c.json({ error: "signaling_unavailable" }, 503);
  }
  const db = c.get("db");
  let payload: Partial<StartCallRequest>;
  try {
    payload = (await c.req.json()) as Partial<StartCallRequest>;
  } catch {
    return c.json({ error: "bad_json" }, 400);
  }
  const to = typeof payload.to === "string" ? payload.to.trim() : "";
  if (!to || to === actor.ap_id) return c.json({ error: "bad_target" }, 400);
  const media = normalizeMedia(payload.media);

  // Do not let the local owner place a call to a contact they have blocked.
  if (await isActorBlocked(db, to)) return c.json({ error: "blocked" }, 403);

  const provider = createRtcProvider(c.env);
  const [iceServers, sfuFocus] = await Promise.all([
    provider.getIceServers(),
    provider.getSfuFocus(media),
  ]);
  return c.json({ callId: crypto.randomUUID(), iceServers, sfuFocus });
});

// --- Call history + state ---------------------------------------------------
rtc.get("/api/rtc/calls", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "unauthorized" }, 401);
  const calls = await listCallSessions(c.get("db"), actor.ap_id);
  return c.json({ calls });
});

rtc.get("/api/rtc/calls/:id", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "unauthorized" }, 401);
  const call = await getCallSession(
    c.get("db"),
    actor.ap_id,
    c.req.param("id"),
  );
  if (!call) return c.json({ error: "not_found" }, 404);
  return c.json({ call });
});

export default rtc;
