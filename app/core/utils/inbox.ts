import type { Context } from "hono";
import { verifyHttpSignature } from "./activitypub.ts";
import type { DataStore } from "../db/types.ts";

export async function parseActivityRequest(
  c: Context,
): Promise<{ activity: Record<string, unknown>; body: string } | null> {
  const body = await c.req.text();
  const verified = await verifyHttpSignature(c.req.raw, body);
  if (!verified) {
    try {
      console.warn("[AP] parseActivityRequest: verify failed", {
        url: c.req.url,
        sigInput: c.req.header("signature-input"),
        sig: c.req.header("signature"),
        digest: c.req.header("content-digest"),
      });
    } catch { /* ignore */ }
    return null;
  }
  try {
    const activity = JSON.parse(body) as Record<string, unknown>;
    try {
      console.log("[AP] parseActivityRequest: verified", {
        url: c.req.url,
        type: (activity as { type?: string })?.type ?? "unknown",
        actor: (activity as { actor?: string })?.actor ?? undefined,
      });
    } catch { /* ignore */ }
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
    // aud フィールドに to/cc/audience を正規化して保存（グループ絞り込み用）
    const to = Array.isArray((object as { to?: unknown }).to)
      ? (object as { to: string[] }).to
      : [];
    const cc = Array.isArray((object as { cc?: unknown }).cc)
      ? (object as { cc: string[] }).cc
      : [];
    const audienceRaw = (object as { audience?: unknown }).audience;
    const audience = typeof audienceRaw === "string"
      ? [audienceRaw]
      : Array.isArray(audienceRaw)
      ? (audienceRaw as unknown[]).filter((v): v is string =>
        typeof v === "string"
      )
      : [];
    const aud = { to: [...to, ...audience], cc };
    stored = await db.posts.saveObject({ ...object, attributedTo, aud });
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
