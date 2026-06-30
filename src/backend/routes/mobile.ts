import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import {
  type MobilePushHostRegistration,
  type MobilePushHostUnregistrationResponse,
  parseMobilePushHostRegistrationRequest,
  type ParsedMobilePushHostRegistrationRequest,
} from "takosumi-contract/mobile";

import { mobilePushRegistrations, type Database } from "../../db/index.ts";
import type { Actor, Env, Variables } from "../types.ts";
import { requireActor } from "./actors-helpers.ts";
import { parseJsonObject } from "../lib/parse-helpers.ts";
import { generateId } from "../lib/oauth-utils.ts";

const mobile = new Hono<{ Bindings: Env; Variables: Variables }>();

type MobilePushRegistrationBody = ParsedMobilePushHostRegistrationRequest;

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function parsePushRegistrationBody(
  body: Record<string, unknown>,
): MobilePushRegistrationBody | Response {
  const parsed = parseMobilePushHostRegistrationRequest(body, {
    product: "yurucommu",
  });
  if (!parsed.ok) return Response.json(parsed.error, { status: 400 });
  return parsed.value;
}

async function registerMobilePushRegistration(
  db: Database,
  actor: Actor,
  body: MobilePushRegistrationBody,
): Promise<MobilePushHostRegistration> {
  const now = new Date().toISOString();
  const tokenHash = await sha256Hex(body.token);

  await db
    .insert(mobilePushRegistrations)
    .values({
      id: generateId(16),
      actorApId: actor.ap_id,
      product: body.product,
      token: body.token,
      tokenHash,
      environment: body.environment,
      hostUrl: body.hostUrl,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: [
        mobilePushRegistrations.actorApId,
        mobilePushRegistrations.product,
        mobilePushRegistrations.tokenHash,
      ],
      set: {
        token: body.token,
        environment: body.environment,
        hostUrl: body.hostUrl,
        updatedAt: now,
        lastSeenAt: now,
      },
    });

  const row = await db
    .select({
      id: mobilePushRegistrations.id,
      product: mobilePushRegistrations.product,
      environment: mobilePushRegistrations.environment,
      hostUrl: mobilePushRegistrations.hostUrl,
      createdAt: mobilePushRegistrations.createdAt,
      lastSeenAt: mobilePushRegistrations.lastSeenAt,
    })
    .from(mobilePushRegistrations)
    .where(
      and(
        eq(mobilePushRegistrations.actorApId, actor.ap_id),
        eq(mobilePushRegistrations.product, body.product),
        eq(mobilePushRegistrations.tokenHash, tokenHash),
      ),
    )
    .get();

  if (!row) throw new Error("Failed to register mobile push token");
  return {
    id: row.id,
    product: body.product,
    environment: row.environment,
    host_url: row.hostUrl,
    registered_at: row.createdAt,
    last_seen_at: row.lastSeenAt,
  };
}

async function unregisterMobilePushRegistration(
  db: Database,
  actor: Actor,
  body: MobilePushRegistrationBody,
): Promise<MobilePushHostUnregistrationResponse> {
  const tokenHash = await sha256Hex(body.token);
  await db
    .delete(mobilePushRegistrations)
    .where(
      and(
        eq(mobilePushRegistrations.actorApId, actor.ap_id),
        eq(mobilePushRegistrations.product, body.product),
        eq(mobilePushRegistrations.environment, body.environment),
        eq(mobilePushRegistrations.tokenHash, tokenHash),
      ),
    );
  return { unregistered: true };
}

mobile.post("/push-registrations", async (c) => {
  const actor = requireActor(c);
  if (actor instanceof Response) return actor;

  const rawBody = await parseJsonObject(c);
  if (!rawBody) {
    return c.json({ error: "Invalid request body", code: "BAD_REQUEST" }, 400);
  }

  const body = parsePushRegistrationBody(rawBody);
  if (body instanceof Response) return body;

  const registration = await registerMobilePushRegistration(
    c.get("db"),
    actor,
    body,
  );
  return c.json({ registration });
});

mobile.delete("/push-registrations", async (c) => {
  const actor = requireActor(c);
  if (actor instanceof Response) return actor;

  const rawBody = await parseJsonObject(c);
  if (!rawBody) {
    return c.json({ error: "Invalid request body", code: "BAD_REQUEST" }, 400);
  }

  const body = parsePushRegistrationBody(rawBody);
  if (body instanceof Response) return body;

  return c.json(
    await unregisterMobilePushRegistration(c.get("db"), actor, body),
  );
});

export default mobile;
