import type { PublicAccountBindings as Bindings } from "@takos/platform/server";
import {
  createProposalQueue,
  D1ProposalQueueStorage,
} from "@takos/platform/ai/proposal-queue";

export const expireAiProposals = async (env: Bindings): Promise<{ expired: number }> => {
  const db = (env as any).DB as D1Database | undefined;
  if (!db) return { expired: 0 };

  const storage = new D1ProposalQueueStorage(db);
  const queue = createProposalQueue(storage);
  const expired = await queue.expireOld();
  return { expired };
};

