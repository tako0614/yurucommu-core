import { createDB } from "../DB/mod.ts";
import type { Context } from "hono";
import { verifyHttpSignature } from "./activitypub.ts";

export async function parseActivityRequest(
  c: Context,
): Promise<{ activity: Record<string, unknown>; body: string } | null> {
  const body = await c.req.text();
  const verified = await verifyHttpSignature(c.req.raw, body);
  console.log(verified)
  if (!verified) return null;
  try {
    const activity = JSON.parse(body) as Record<string, unknown>;
    return { activity, body };
  } catch {
    return null;
  }
}

export async function storeCreateActivity(
  activity: Record<string, unknown>,
  env: Record<string, string>,
): Promise<{ stored: Record<string, unknown>; actorId: string } | null> {
  if (activity.type !== "Create" || typeof activity.object !== "object") {
    return null;
  }
  const db = createDB(env);
  const object = activity.object as Record<string, unknown>;
  let objectId = typeof object.id === "string" ? object.id : "";
  let stored = await db.getObject(objectId);
  if (!stored) {
    stored = await db.saveObject(object);
    if (!stored) return null;
    objectId = String((stored as { _id?: unknown })._id);
  }
  const actorId = (stored as { actor_id?: unknown }).actor_id as
    | string
    | undefined ?? (typeof activity.actor === "string" ? activity.actor : "");
  return { stored: stored as Record<string, unknown>, actorId };
}
