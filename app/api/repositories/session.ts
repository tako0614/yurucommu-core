export interface SessionData {
  _id?: string;
  sessionId: string;
  expiresAt: Date;
}

import Session from "../models/session.ts";

export async function createSession(
  env: Record<string, string>,
  sessionId: string,
  expiresAt: Date,
): Promise<SessionData> {
  const doc = new Session({
    sessionId,
    expiresAt,
    tenant_id: env["ACTIVITYPUB_DOMAIN"] ?? "",
  });
  (doc as unknown as { $locals?: { env?: Record<string, string> } }).$locals = {
    env,
  };
  await doc.save();
  return doc.toObject() as SessionData;
}

export async function findSessionById(
  env: Record<string, string>,
  sessionId: string,
): Promise<SessionData | null> {
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  return await Session.findOne({ sessionId, tenant_id: tenantId }).lean<
    SessionData | null
  >();
}

export async function deleteSessionById(
  env: Record<string, string>,
  sessionId: string,
): Promise<void> {
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  await Session.deleteOne({ sessionId, tenant_id: tenantId });
}

export async function updateSessionExpires(
  env: Record<string, string>,
  sessionId: string,
  expires: Date,
): Promise<void> {
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  await Session.updateOne({ sessionId, tenant_id: tenantId }, {
    expiresAt: expires,
  });
}
