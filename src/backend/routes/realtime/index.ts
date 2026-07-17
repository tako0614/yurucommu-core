/**
 * Realtime stream routes.
 *
 *   GET  /api/realtime/config   capability probe ({ available }) — clients
 *                               gate their fallback polling on this
 *   POST /api/realtime/ticket   mint a one-time short-lived WS ticket
 *   GET  /api/realtime/socket   browser WebSocket upgrade -> per-user stream
 *
 * Two upgrade auth paths, both terminating in the worker BEFORE the DO is
 * reached (the DO binding is the trust boundary):
 *   - session: the same-origin browser sends its session cookie; the /api/*
 *     middleware resolved the actor already.
 *   - ticket: a cross-origin or bearer-auth client (the browser WebSocket API
 *     cannot set an Authorization header) first POSTs /ticket over the normal
 *     authenticated fetch path, then connects with ?actor=&ticket=. The ticket
 *     is minted inside — and re-verified + consumed by — the target user's own
 *     stream DO, so it is single-use, expires in ~60s, and never carries the
 *     raw session credential in a URL.
 */

import { Hono } from "hono";
import type { Env, Variables } from "../../types.ts";
import {
  getRealtimeHub,
  isRealtimeAvailable,
} from "../../runtime/realtime-hub.ts";

const realtime = new Hono<{ Bindings: Env; Variables: Variables }>();

realtime.get("/config", (c) => {
  return c.json({ available: isRealtimeAvailable(c.env) });
});

realtime.post("/ticket", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "unauthorized" }, 401);
  if (!isRealtimeAvailable(c.env)) {
    return c.json({ error: "realtime_unavailable" }, 503);
  }
  const ticket = await getRealtimeHub(c.env).mintTicket(actor.ap_id);
  if (!ticket) return c.json({ error: "ticket_mint_failed" }, 500);
  return c.json({ ticket, actor_ap_id: actor.ap_id });
});

realtime.get("/socket", async (c) => {
  if (!isRealtimeAvailable(c.env)) {
    return c.json({ error: "realtime_unavailable" }, 503);
  }
  const hub = getRealtimeHub(c.env);

  const sessionActor = c.get("actor");
  if (sessionActor) {
    return hub.upgrade(c.req.raw, sessionActor.ap_id, "session");
  }

  const actorParam = c.req.query("actor")?.trim();
  const ticket = c.req.query("ticket")?.trim();
  if (actorParam && ticket) {
    // The actor param only selects WHICH stream DO verifies the ticket; a
    // forged actor value fails inside that DO (it never minted the ticket).
    return hub.upgrade(c.req.raw, actorParam, "ticket", ticket);
  }

  return c.json({ error: "unauthorized" }, 401);
});

export default realtime;
