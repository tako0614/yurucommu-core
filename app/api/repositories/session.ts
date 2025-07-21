import Session from "../models/session.ts";

export interface SessionData {
  _id?: string;
  sessionId: string;
  expiresAt: Date;
  tenant_id: string;
}

export async function createSession(
  _env: Record<string, string>,
  sessionId: string,
  expiresAt: Date,
  tenantId: string,
): Promise<SessionData> {
  const doc = new Session({
    sessionId,
    expiresAt,
    tenant_id: tenantId,
  });
  (doc as unknown as { $locals?: { env?: Record<string, string> } }).$locals = {
    env: _env,
  };
  await doc.save();
  return doc.toObject() as SessionData;
}

export async function findSessionById(
  _env: Record<string, string>,
  sessionId: string,
): Promise<SessionData | null> {
  return await Session.findOne({ sessionId }).lean<SessionData | null>();
}

export async function deleteSessionById(
  _env: Record<string, string>,
  sessionId: string,
): Promise<void> {
  await Session.deleteOne({ sessionId });
}

export async function updateSessionExpires(
  _env: Record<string, string>,
  sessionId: string,
  expires: Date,
): Promise<void> {
  await Session.updateOne({ sessionId }, { expiresAt: expires });
}
