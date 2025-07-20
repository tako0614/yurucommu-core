export interface MessageData {
  _id?: string;
  from: string;
  to: string[];
  content: string;
  mediaType: string;
  encoding: string;
  createdAt?: Date;
}

import EncryptedMessage from "../models/encrypted_message.ts";

export async function createEncryptedMessage(data: {
  from: string;
  to: string[];
  content: string;
  mediaType?: string;
  encoding?: string;
}): Promise<MessageData> {
  const doc = await EncryptedMessage.create({
    from: data.from,
    to: data.to,
    content: data.content,
    mediaType: data.mediaType ?? "message/mls",
    encoding: data.encoding ?? "base64",
  });
  return doc.toObject() as MessageData;
}

export async function findEncryptedMessages(
  condition: Record<string, unknown>,
  opts: { before?: string; after?: string; limit?: number } = {},
): Promise<MessageData[]> {
  const query = EncryptedMessage.find(condition);
  if (opts.before) {
    query.where("createdAt").lt(new Date(opts.before) as unknown as number);
  }
  if (opts.after) {
    query.where("createdAt").gt(new Date(opts.after) as unknown as number);
  }
  const list = await query
    .sort({ createdAt: -1 })
    .limit(opts.limit ?? 50)
    .lean<MessageData[]>();
  return list;
}
