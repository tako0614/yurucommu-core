import { createDB } from "@takos_host/db";
import type { HostDataStore } from "../db/types.ts";

const db = createDB({}) as HostDataStore;

export interface HostSessionData {
  _id?: string;
  sessionId: string;
  expiresAt: Date;
  user: string;
}

export async function findHostSessionById(
  sessionId: string,
): Promise<HostSessionData | null> {
  return await db.hostSessions.findById(sessionId);
}

export async function createHostSession(
  sessionId: string,
  expiresAt: Date,
  user: string,
): Promise<HostSessionData> {
  return await db.hostSessions.create({
    sessionId,
    expiresAt,
    user,
  });
}

export async function updateHostSession(
  sessionId: string,
  expiresAt: Date,
): Promise<void> {
  await db.hostSessions.update(sessionId, { expiresAt });
}
