import type { Context } from "hono";
import { verifyHttpSignature } from "./activitypub.ts";
import type { DataStore } from "../db/types.ts";

export async function parseActivityRequest(
  c: Context,
): Promise<{ activity: Record<string, unknown>; body: string } | null> {
  const body = await c.req.text();
  const verified = await verifyHttpSignature(c.req.raw, body);
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
  db: DataStore,
): Promise<{ stored: Record<string, unknown>; actorId: string } | null> {
  if (activity.type !== "Create" || typeof activity.object !== "object") {
    return null;
  }
  const object = activity.object as Record<string, unknown>;
  const attributedTo = actorAttr(object.attributedTo, activity.actor);
  let objectId = typeof object.id === "string" ? object.id : "";
  const type = typeof object.type === "string" ? object.type : "";
  let stored = null;
  if (type === "Note") {
    stored = await db.posts.findNoteById(objectId);
  } else if (type === "Attachment") {
    stored = await db.posts.findAttachmentById(objectId);
  } else {
    stored = await db.posts.findMessageById(objectId);
  }
  if (!stored) {
    stored = await db.posts.saveObject({ ...object, attributedTo });
    if (!stored) return null;
    objectId = String((stored as { _id?: unknown })._id);
  }
  const actorId = (stored as { actor_id?: unknown }).actor_id as
    | string
    | undefined ?? (typeof activity.actor === "string" ? activity.actor : "");
  return { stored: stored as Record<string, unknown>, actorId };
}

function actorAttr(
  attr: unknown,
  actor: unknown,
): string {
  // attributedTo を URL として正規化する
  if (typeof attr === "string") {
    try {
      return new URL(attr).href;
    } catch {
      // fall through
    }
  }
  if (typeof actor === "string") {
    try {
      return new URL(actor).href;
    } catch {
      return actor;
    }
  }
  return "";
}
