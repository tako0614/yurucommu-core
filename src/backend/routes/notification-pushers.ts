import { Hono } from "hono";

import type { Env, Variables } from "../types.ts";
import { requireActor } from "./actors-helpers.ts";
import { parseJsonObject } from "../lib/parse-helpers.ts";
import {
  normalizeGatewayUrl,
  parseNotificationPusherDeleteRequest,
  parseNotificationPusherSetRequest,
} from "../lib/notification-pusher-contract.ts";
import {
  deleteNotificationPusher,
  isNotificationGatewayAllowed,
  isWebPushEndpointAllowed,
  NotificationPusherConflictError,
  registerNotificationPusher,
} from "../lib/notification-push.ts";
import { getInstanceVapidKeyPair } from "../lib/web-push/vapid.ts";
import { rawSessionCredential } from "../lib/session-actor.ts";
import { hashSessionIdForEnv } from "../lib/crypto.ts";

const pushers = new Hono<{ Bindings: Env; Variables: Variables }>();

pushers.get("/config", async (c) => {
  const actor = requireActor(c);
  if (actor instanceof Response) return actor;

  const configuredGateway = normalizeGatewayUrl(
    c.env.YURUCOMMU_NOTIFICATION_PUSH_GATEWAY_URL,
  );
  const gatewayUrl =
    configuredGateway && isNotificationGatewayAllowed(c.env, configuredGateway)
      ? configuredGateway
      : null;
  // The instance's own VAPID key, derived from ENCRYPTION_KEY. Browsers
  // subscribe with it and register `kind: "webpush"`; the instance sends.
  const vapid = await getInstanceVapidKeyPair(c.env);

  return c.json({
    gateway_url: gatewayUrl,
    // Gateway-era field (SDK < 4.2.0 subscribed with it and registered `http`
    // pushers through the gateway). Always null now: an old SDK still running
    // in an open tab compares it with the browser's subscription and, on a
    // mismatch, deletes the registration and unsubscribes. Null leaves it
    // "unconfigured", which touches nothing; its existing `http` rows keep
    // being delivered through the gateway until the new SDK migrates them.
    web_push_public_key: null,
    // The instance's own key: SDK >= 4.2.0 subscribes with it and registers
    // `kind: "webpush"`.
    web_push_instance_public_key: vapid?.publicKeyBase64Url ?? null,
  });
});

pushers.post("/", async (c) => {
  const actor = requireActor(c);
  if (actor instanceof Response) return actor;
  const body = await parseJsonObject(c);
  if (!body) {
    return c.json({ code: "BAD_REQUEST", error: "Invalid request body" }, 400);
  }
  const parsed = parseNotificationPusherSetRequest(body);
  if (!parsed.ok) return c.json(parsed.error, 400);
  if (parsed.value.pusher.kind === "webpush") {
    if (!isWebPushEndpointAllowed(c.env, parsed.value.gatewayUrl)) {
      return c.json(
        {
          code: "BAD_REQUEST",
          error: "pusher.data.url is not allowed by this server",
          field: "pusher.data.url",
        },
        400,
      );
    }
    if (!(await getInstanceVapidKeyPair(c.env))) {
      return c.json(
        {
          code: "BAD_REQUEST",
          error: "web push is not available on this server",
          field: "pusher.kind",
        },
        400,
      );
    }
  } else if (!isNotificationGatewayAllowed(c.env, parsed.value.gatewayUrl)) {
    return c.json(
      {
        code: "BAD_REQUEST",
        error: "pusher.data.url is not allowed by this server",
        field: "pusher.data.url",
      },
      400,
    );
  }
  // `webpush` rows are bound to the session that registers them, so the
  // subscription stops receiving when that session ends.
  let sessionKey: string | null = null;
  if (parsed.value.pusher.kind === "webpush") {
    const rawSession = rawSessionCredential(c);
    if (!rawSession) return c.json({ error: "Unauthorized" }, 401);
    sessionKey = await hashSessionIdForEnv(c.env, rawSession);
  }
  try {
    const pusher = await registerNotificationPusher(
      c.get("db"),
      actor,
      parsed.value,
      { sessionKey },
    );
    return c.json({ pusher });
  } catch (error) {
    if (error instanceof NotificationPusherConflictError) {
      return c.json(
        { code: "CONFLICT", error: error.message, field: "pusher.pushkey" },
        409,
      );
    }
    throw error;
  }
});

pushers.delete("/", async (c) => {
  const actor = requireActor(c);
  if (actor instanceof Response) return actor;
  const body = await parseJsonObject(c);
  if (!body) {
    return c.json({ code: "BAD_REQUEST", error: "Invalid request body" }, 400);
  }
  const parsed = parseNotificationPusherDeleteRequest(body);
  if (!parsed.ok) return c.json(parsed.error, 400);
  await deleteNotificationPusher(c.get("db"), actor, parsed.value);
  return c.json({ deleted: true as const });
});

export default pushers;
