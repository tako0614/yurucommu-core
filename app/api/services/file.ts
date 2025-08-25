import { createDB } from "../DB/mod.ts";
import { createStorage, type ObjectStorage } from "./object-storage.ts";
import { b64ToBuf } from "../../shared/buffer.ts";

let storage: ObjectStorage | undefined;

export async function initFileService(env: Record<string, string>) {
  const db = createDB(env);
  storage = await createStorage(env, db);
}

export async function saveFile(
  bytes: Uint8Array,
  env: Record<string, string>,
  options: { mediaType?: string; key?: string; iv?: string; ext?: string } = {},
): Promise<{ id: string; url: string }> {
  if (!storage) await initFileService(env);
  const mediaType = options.mediaType ?? "application/octet-stream";
  const ext = options.ext ?? "";
  const filename = `${crypto.randomUUID()}${ext}`;
  const storageKey = `files/${filename}`;
  await storage!.put(storageKey, bytes);
  const domain = env["ACTIVITYPUB_DOMAIN"] ?? "";
  const db = createDB(env);
  // ファイルIDはURLを含まないランダム文字列にする
  const id = crypto.randomUUID();
  await db.saveObject({
    _id: id,
    type: "Attachment",
    attributedTo: `https://${domain}/users/system`,
    extra: { mediaType, key: options.key, iv: options.iv, storageKey },
  });
  return { id, url: `https://${domain}/api/files/${id}` };
}

export async function getFile(
  id: string,
  env: Record<string, string>,
): Promise<{ data: Uint8Array; mediaType: string } | null> {
  if (!storage) await initFileService(env);
  const db = createDB(env);
  const doc = await db.findAttachmentById(id) as {
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
    data = await storage!.get(storageKey);
  } else if (typeof doc.content === "string") {
    data = b64ToBuf(doc.content);
  }
  if (!data) return null;
  return { data, mediaType };
}

export async function getMessageAttachment(
  id: string,
  index: number,
  env: Record<string, string>,
): Promise<{ data: Uint8Array; mediaType: string } | null> {
  const db = createDB(env);
  const doc = await db.findMessageById(id) as
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
