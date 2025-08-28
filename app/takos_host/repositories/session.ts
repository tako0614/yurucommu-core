import { createDB } from "@takos_host/db";
import type { HostDataStore } from "../db/types.ts";

// DB は初期化順序の都合で遅延生成する
let dbInst: HostDataStore | null = null;
function db(): HostDataStore {
  if (!dbInst) dbInst = createDB({}) as HostDataStore;
  return dbInst;
}

export interface HostSessionData {
  _id?: string;
  sessionId: string;
  expiresAt: Date;
  user: string;
}

export async function findHostSessionById(
  sessionId: string,
): Promise<HostSessionData | null> {
  return await db().hostSessions.findById(sessionId);
}

export async function createHostSession(
  sessionId: string,
  expiresAt: Date,
  user: string,
): Promise<HostSessionData> {
  return await db().hostSessions.create({
    sessionId,
    expiresAt,
    user,
  });
}

export async function updateHostSession(
  sessionId: string,
  expiresAt: Date,
): Promise<void> {
  await db().hostSessions.update(sessionId, { expiresAt });
}
