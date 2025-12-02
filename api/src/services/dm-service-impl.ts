/**
 * DMService Implementation
 *
 * 既存のDM/チャットロジックをCore Kernel サービスAPIでラップ
 */

import type {
  DMService,
  OpenThreadInput,
  SendMessageInput,
  ListThreadsParams,
  ListMessagesParams,
  DmThread,
  DmMessage,
  DmThreadPage,
  DmMessagePage,
  AppAuthContext,
} from "@takos/platform/app/services";
import { makeData } from "../data";
import {
  releaseStore,
  requireInstanceDomain,
  getActorUri,
  webfingerLookup,
  getOrFetchActor,
  sendDirectMessage,
  getDmThreadMessages,
  computeParticipantsHash,
  canonicalizeParticipants,
} from "@takos/platform/server";

/**
 * 参加者リスト（handle or Actor URI）を Actor URI に解決
 */
async function resolveRecipientActorUris(
  env: Record<string, unknown>,
  rawRecipients: string[],
): Promise<string[]> {
  const instanceDomain = requireInstanceDomain(env as any);
  const fetcher = fetch;
  const actorUris: string[] = [];

  for (const raw of rawRecipients) {
    const normalized = String(raw || "").trim();
    if (!normalized) continue;

    // Already Actor URI
    if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
      actorUris.push(normalized);
      continue;
    }

    // Handle format: @user@domain or user@domain
    const withoutPrefix = normalized.replace(/^@+/, "");
    const parts = withoutPrefix.split("@");

    if (parts.length >= 2) {
      // Remote user
      const handle = (parts.shift() || "").trim();
      const domain = parts.join("@").trim().toLowerCase();
      if (!handle || !domain) continue;
      const account = `${handle}@${domain}`;
      const actorUri = await webfingerLookup(account, fetcher).catch(() => null);
      if (!actorUri) continue;
      const actor = await getOrFetchActor(actorUri, env as any, false, fetcher).catch(() => null);
      actorUris.push((actor as any)?.id || actorUri);
      continue;
    }

    // Local user: just handle
    actorUris.push(getActorUri(withoutPrefix.toLowerCase(), instanceDomain));
  }

  return Array.from(new Set(actorUris));
}

/**
 * スレッドを取得または作成
 */
async function getOrCreateDmThread(
  store: ReturnType<typeof makeData>,
  participants: string[],
  limit: number,
) {
  const normalized = canonicalizeParticipants(participants);
  const hash = computeParticipantsHash(normalized);
  const thread = await store.upsertDmThread(hash, JSON.stringify(normalized));
  const messages = await store.listDmMessages(thread.id, limit);
  return { threadId: thread.id, messages };
}

export function createDMService(env: any): DMService {
  return {
    async openThread(
      ctx: AppAuthContext,
      input: OpenThreadInput,
    ): Promise<{ threadId: string; messages: DmMessage[] }> {
      if (!ctx.userId) {
        throw new Error("Authentication required");
      }

      const store = makeData(env, null as any);
      try {
        const instanceDomain = requireInstanceDomain(env as any);
        const senderActorUri = getActorUri(ctx.userId, instanceDomain);

        // Resolve participants to Actor URIs
        const recipientActors = await resolveRecipientActorUris(env as any, input.participants);

        // Add sender to participants
        const allParticipants = Array.from(new Set([senderActorUri, ...recipientActors]));

        // Check for blocked users
        for (const recipientUri of recipientActors) {
          // Try to get local user from Actor URI
          const recipientHandle = recipientUri.split("/").pop() || "";
          const otherUser = await store.getUser(recipientHandle).catch(() => null);

          if (otherUser) {
            const blocked = await store.isBlocked?.(ctx.userId, otherUser.id).catch(() => false);
            const blocking = await store.isBlocked?.(otherUser.id, ctx.userId).catch(() => false);
            if (blocked || blocking) {
              throw new Error("Cannot send message to blocked user");
            }
          }
        }

        const result = await getOrCreateDmThread(store, allParticipants, 50);
        return result as { threadId: string; messages: DmMessage[] };
      } finally {
        await releaseStore(store);
      }
    },

    async sendMessage(ctx: AppAuthContext, input: SendMessageInput): Promise<DmMessage> {
      if (!ctx.userId) {
        throw new Error("Authentication required");
      }

      const store = makeData(env, null as any);
      try {
        const instanceDomain = requireInstanceDomain(env as any);
        const senderActorUri = getActorUri(ctx.userId, instanceDomain);

        let threadId = input.thread_id;

        // If no thread_id, create new thread
        if (!threadId && input.participants) {
          const recipientActors = await resolveRecipientActorUris(env as any, input.participants);
          const allParticipants = Array.from(new Set([senderActorUri, ...recipientActors]));

          // Check for blocked users
          for (const recipientUri of recipientActors) {
            const recipientHandle = recipientUri.split("/").pop() || "";
            const otherUser = await store.getUser(recipientHandle).catch(() => null);

            if (otherUser) {
              const blocked = await store.isBlocked?.(ctx.userId, otherUser.id).catch(() => false);
              const blocking = await store.isBlocked?.(otherUser.id, ctx.userId).catch(() => false);
              if (blocked || blocking) {
                throw new Error("Cannot send message to blocked user");
              }
            }
          }

          const result = await getOrCreateDmThread(store, allParticipants, 1);
          threadId = result.threadId;
        }

        if (!threadId) {
          throw new Error("thread_id or participants required");
        }

        // Verify user is participant
        const thread = await store.getDmThread?.(threadId);
        if (!thread) {
          throw new Error("Thread not found");
        }

        const participants = JSON.parse(thread.participants_json || "[]");
        if (!participants.includes(senderActorUri)) {
          throw new Error("Forbidden: not a participant");
        }

        // Send message
        const message = await sendDirectMessage(
          env,
          {
            thread_id: threadId,
            sender_actor_uri: senderActorUri,
            content: input.content,
            media_ids: input.media_ids || [],
          },
          fetch,
        );

        return message as DmMessage;
      } finally {
        await releaseStore(store);
      }
    },

    async listThreads(ctx: AppAuthContext, params: ListThreadsParams): Promise<DmThreadPage> {
      if (!ctx.userId) {
        throw new Error("Authentication required");
      }

      const store = makeData(env, null as any);
      try {
        const instanceDomain = requireInstanceDomain(env as any);
        const userActorUri = getActorUri(ctx.userId, instanceDomain);

        // Get all threads where user is a participant
        const allThreads = await store.listAllDmThreads?.();
        if (!allThreads) {
          return { threads: [] };
        }

        const userThreads = allThreads.filter((thread: any) => {
          try {
            const participants = JSON.parse(thread.participants_json || "[]");
            return participants.includes(userActorUri);
          } catch {
            return false;
          }
        });

        // Apply pagination
        const limit = Math.min(params.limit || 20, 100);
        const offset = params.offset || 0;
        const paginatedThreads = userThreads.slice(offset, offset + limit);

        // Enrich with latest message
        const enriched = await Promise.all(
          paginatedThreads.map(async (thread: any) => {
            const messages = await store.listDmMessages(thread.id, 1);
            return {
              id: thread.id,
              participants: JSON.parse(thread.participants_json || "[]"),
              created_at: thread.created_at,
              latest_message: messages[0] || null,
            };
          }),
        );

        const nextOffset = userThreads.length > offset + limit ? offset + limit : null;

        return {
          threads: enriched as DmThread[],
          next_offset: nextOffset,
        };
      } finally {
        await releaseStore(store);
      }
    },

    async listMessages(
      ctx: AppAuthContext,
      params: ListMessagesParams,
    ): Promise<DmMessagePage> {
      if (!ctx.userId) {
        throw new Error("Authentication required");
      }

      const store = makeData(env, null as any);
      try {
        const instanceDomain = requireInstanceDomain(env as any);
        const userActorUri = getActorUri(ctx.userId, instanceDomain);

        // Verify user is participant in this thread
        const thread = await store.getDmThread?.(params.thread_id);
        if (!thread) {
          throw new Error("Thread not found");
        }

        const participants = JSON.parse(thread.participants_json || "[]");
        if (!participants.includes(userActorUri)) {
          throw new Error("Forbidden: not a participant");
        }

        const limit = Math.min(params.limit || 50, 100);
        const messages = await getDmThreadMessages(env, params.thread_id, limit);

        return {
          messages: messages as DmMessage[],
        };
      } finally {
        await releaseStore(store);
      }
    },
  };
}
