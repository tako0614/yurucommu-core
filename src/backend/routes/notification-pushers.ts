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
  registerNotificationPusher,
} from "../lib/notification-push.ts";

const pushers = new Hono<{ Bindings: Env; Variables: Variables }>();

pushers.get("/config", (c) => {
  const actor = requireActor(c);
  if (actor instanceof Response) return actor;

  const configuredGateway = normalizeGatewayUrl(
    c.env.YURUCOMMU_NOTIFICATION_PUSH_GATEWAY_URL,
  );
  const gatewayUrl =
    configuredGateway && isNotificationGatewayAllowed(c.env, configuredGateway)
      ? configuredGateway
      : null;
  const configuredPublicKey =
    c.env.YURUCOMMU_NOTIFICATION_PUSH_WEB_PUSH_PUBLIC_KEY?.trim() ?? "";
  const webPushPublicKey = normalizeWebPushPublicKey(configuredPublicKey);

  return c.json({
    gateway_url: gatewayUrl,
    web_push_public_key: webPushPublicKey,
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
  if (!isNotificationGatewayAllowed(c.env, parsed.value.gatewayUrl)) {
    return c.json(
      {
        code: "BAD_REQUEST",
        error: "pusher.data.url is not allowed by this server",
        field: "pusher.data.url",
      },
      400,
    );
  }
  const pusher = await registerNotificationPusher(
    c.get("db"),
    actor,
    parsed.value,
  );
  return c.json({ pusher });
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

function normalizeWebPushPublicKey(value: string): string | null {
  if (!/^[A-Za-z0-9_-]{87}$/.test(value)) return null;
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=";
    const decoded = Uint8Array.from(atob(padded), (character) =>
      character.charCodeAt(0),
    );
    return decoded.byteLength === 65 && decoded[0] === 0x04 ? value : null;
  } catch {
    return null;
  }
}
