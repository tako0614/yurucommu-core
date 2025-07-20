export interface PublicMessageData {
  _id?: string;
  from: string;
  to: string[];
  content: string;
  mediaType: string;
  encoding: string;
  createdAt?: Date;
}

import PublicMessage from "../models/public_message.ts";

export async function createPublicMessage(
  env: Record<string, string>,
  data: {
    from: string;
    to: string[];
    content: string;
    mediaType?: string;
    encoding?: string;
  },
): Promise<PublicMessageData> {
  const doc = new PublicMessage({
    from: data.from,
    to: data.to,
    content: data.content,
    mediaType: data.mediaType ?? "message/mls",
    encoding: data.encoding ?? "base64",
    tenant_id: env["ACTIVITYPUB_DOMAIN"] ?? "",
  });
  (doc as unknown as { $locals?: { env?: Record<string, string> } }).$locals = {
    env,
  };
  await doc.save();
  return doc.toObject() as PublicMessageData;
}

export async function findPublicMessages(
  env: Record<string, string>,
  condition: Record<string, unknown>,
  opts: { before?: string; after?: string; limit?: number } = {},
): Promise<PublicMessageData[]> {
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  const query = PublicMessage.find({ ...condition, tenant_id: tenantId });
  if (opts.before) {
    query.where("createdAt").lt(new Date(opts.before) as unknown as number);
  }
  if (opts.after) {
    query.where("createdAt").gt(new Date(opts.after) as unknown as number);
  }
  const list = await query
    .sort({ createdAt: -1 })
    .limit(opts.limit ?? 50)
    .lean<PublicMessageData[]>();
  return list;
}
