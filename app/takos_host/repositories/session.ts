import HostSession from "../models/session.ts";

export interface HostSessionData {
  _id?: string;
  sessionId: string;
  expiresAt: Date;
  user: unknown;
}

export async function findHostSessionById(
  sessionId: string,
): Promise<HostSessionData | null> {
  return await HostSession.findOne({ sessionId }).lean<HostSessionData | null>();
}

export async function createHostSession(
  sessionId: string,
  expiresAt: Date,
  user: unknown,
): Promise<HostSessionData> {
  const doc = new HostSession({
    sessionId,
    expiresAt,
    user,
  });
  await doc.save();
  return doc.toObject() as HostSessionData;
}

export async function updateHostSession(
  sessionId: string,
  expiresAt: Date,
): Promise<void> {
  await HostSession.updateOne({ sessionId }, { expiresAt });
}
