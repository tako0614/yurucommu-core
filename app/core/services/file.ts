import type { DataStore } from "../db/types.ts";
import type { ObjectStorage } from "../storage/types.ts";
import { b64ToBuf } from "@takos/buffer";

// core 側ではストレージ実装を保持しない。必要時に DB API から取得する。
function getStorage(db: DataStore): ObjectStorage {
  return db.storage as ObjectStorage;
}

export async function saveFile(
  db: DataStore,
  bytes: Uint8Array,
  env: Record<string, string>,
  options: { mediaType?: string; key?: string; iv?: string; ext?: string } = {},
): Promise<{ id: string; url: string }> {
  const storage = getStorage(db);
  const mediaType = options.mediaType ?? "application/octet-stream";
  const ext = options.ext ?? "";
  const filename = `${crypto.randomUUID()}${ext}`;
  const storageKey = `files/${filename}`;
  await storage.put(storageKey, bytes);
  const domain = env["ACTIVITYPUB_DOMAIN"] ?? "";
  // ファイルIDはURLを含まないランダム文字列にする
  const id = crypto.randomUUID();
  await db.posts.saveObject({
    _id: id,
    type: "Attachment",
    attributedTo: `https://${domain}/users/system`,
    extra: { mediaType, key: options.key, iv: options.iv, storageKey },
  });
  return { id, url: `https://${domain}/api/files/${id}` };
}

export async function getFile(
  db: DataStore,
  id: string,
): Promise<{ data: Uint8Array; mediaType: string } | null> {
  const storage = getStorage(db);
  const doc = await db.posts.findAttachmentById(id) as {
    content?: string;
    extra?: Record<string, unknown>;
  } | null;
  if (!doc) return null;
  const mediaType = typeof doc.extra?.mediaType === "string"
    ? doc.extra.mediaType
    : "application/octet-stream";
  const storageKey = typeof doc.extra?.storageKey === "string"
    ? doc.extra.storageKey
    : undefined;
  let data: Uint8Array | null = null;
  if (storageKey) {
    data = await storage.get(storageKey);
  } else if (typeof doc.content === "string") {
    data = b64ToBuf(doc.content);
  }
  if (!data) return null;
  return { data, mediaType };
}

export async function getMessageAttachment(
  db: DataStore,
  id: string,
  index: number,
): Promise<{ data: Uint8Array; mediaType: string } | null> {
  const doc = await db.posts.findMessageById(id) as
    | { extra?: Record<string, unknown> }
    | null;
  if (!doc || typeof doc.extra !== "object" || !doc.extra) return null;
  const list = (doc.extra as Record<string, unknown>).attachments as unknown;
  if (!Array.isArray(list) || index < 0 || index >= list.length) return null;
  const att = list[index] as Record<string, unknown>;
  const content = att.content;
  if (typeof content !== "string") return null;
  const mediaType = typeof att.mediaType === "string"
    ? att.mediaType
    : "application/octet-stream";
  const bytes = b64ToBuf(content);
  return { data: bytes, mediaType };
}
