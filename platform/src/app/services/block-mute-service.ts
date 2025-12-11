/**
 * Block/Mute Service - KV-based Implementation
 *
 * Per 11-default-app.md specification:
 * - Block: stored in KV + creates Block object via ObjectService for ActivityPub federation
 * - Mute: stored in KV only (no ActivityPub activity, private to user)
 *
 * KV Keys:
 * - block:{actor_id}:{target_id} - individual block entry
 * - block:{actor_id}:list - array of blocked IDs (index)
 * - mute:{actor_id}:{target_id} - individual mute entry
 * - mute:{actor_id}:list - array of muted IDs (index)
 */

import type { KVNamespace } from "@cloudflare/workers-types";
import type { AppAuthContext } from "../runtime/types";

export interface BlockEntry {
  targetId: string;
  createdAt: string;
}

export interface MuteEntry {
  targetId: string;
  createdAt: string;
  expiresAt: string | null; // null = permanent
}

export interface BlockMuteListResult {
  ids: string[];
  entries: (BlockEntry | MuteEntry)[];
}

export interface BlockMuteService {
  /**
   * Block a user
   * @returns Block entry
   */
  block(ctx: AppAuthContext, targetId: string): Promise<BlockEntry>;

  /**
   * Unblock a user
   */
  unblock(ctx: AppAuthContext, targetId: string): Promise<void>;

  /**
   * Check if a user is blocked
   */
  isBlocked(actorId: string, targetId: string): Promise<boolean>;

  /**
   * List all blocked user IDs for an actor
   */
  listBlockedIds(actorId: string): Promise<string[]>;

  /**
   * Mute a user
   * @param duration Optional duration in seconds (null = permanent)
   */
  mute(ctx: AppAuthContext, targetId: string, duration?: number | null): Promise<MuteEntry>;

  /**
   * Unmute a user
   */
  unmute(ctx: AppAuthContext, targetId: string): Promise<void>;

  /**
   * Check if a user is muted (considering expiration)
   */
  isMuted(actorId: string, targetId: string): Promise<boolean>;

  /**
   * List all muted user IDs for an actor (active mutes only)
   */
  listMutedIds(actorId: string): Promise<string[]>;
}

export interface DbBlockMuteStore {
  blockUser: (blockerId: string, blockedId: string) => Promise<void>;
  unblockUser: (blockerId: string, blockedId: string) => Promise<void>;
  listBlockedUsers: (blockerId: string) => Promise<{ blocked_id: string }[]>;
  isBlocked: (blockerId: string, targetId: string) => Promise<boolean>;
  muteUser: (muterId: string, mutedId: string) => Promise<void>;
  unmuteUser: (muterId: string, mutedId: string) => Promise<void>;
  listMutedUsers: (muterId: string) => Promise<{ muted_id: string }[]>;
  isMuted: (muterId: string, targetId: string) => Promise<boolean>;
}

type KVOrFallback =
  | { type: "kv"; kv: KVNamespace }
  | { type: "db"; db: DbBlockMuteStore };

const ensureAuth = (ctx: AppAuthContext): string => {
  const userId = (ctx.userId || "").toString().trim();
  if (!userId) throw new Error("Authentication required");
  return userId;
};

/**
 * Creates a KV-based BlockMuteService
 * Falls back to DB operations if KV is not available
 */
export function createBlockMuteService(
  storage: KVOrFallback,
): BlockMuteService {
  if (storage.type === "db") {
    // Fallback to DB-based implementation
    return createDbFallbackService(storage.db);
  }

  const kv = storage.kv;

  const getBlockEntry = async (actorId: string, targetId: string): Promise<BlockEntry | null> => {
    const key = `block:${actorId}:${targetId}`;
    const value = await kv.get(key);
    if (!value) return null;
    try {
      return JSON.parse(value) as BlockEntry;
    } catch {
      return null;
    }
  };

  const getMuteEntry = async (actorId: string, targetId: string): Promise<MuteEntry | null> => {
    const key = `mute:${actorId}:${targetId}`;
    const value = await kv.get(key);
    if (!value) return null;
    try {
      return JSON.parse(value) as MuteEntry;
    } catch {
      return null;
    }
  };

  const getBlockList = async (actorId: string): Promise<string[]> => {
    const key = `block:${actorId}:list`;
    const value = await kv.get(key);
    if (!value) return [];
    try {
      const list = JSON.parse(value);
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  };

  const setBlockList = async (actorId: string, list: string[]): Promise<void> => {
    const key = `block:${actorId}:list`;
    await kv.put(key, JSON.stringify(list));
  };

  const getMuteList = async (actorId: string): Promise<string[]> => {
    const key = `mute:${actorId}:list`;
    const value = await kv.get(key);
    if (!value) return [];
    try {
      const list = JSON.parse(value);
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  };

  const setMuteList = async (actorId: string, list: string[]): Promise<void> => {
    const key = `mute:${actorId}:list`;
    await kv.put(key, JSON.stringify(list));
  };

  return {
    async block(ctx, targetId) {
      const actorId = ensureAuth(ctx);

      if (actorId === targetId) {
        throw new Error("Cannot block yourself");
      }

      const entry: BlockEntry = {
        targetId,
        createdAt: new Date().toISOString(),
      };

      // Store individual entry
      const entryKey = `block:${actorId}:${targetId}`;
      await kv.put(entryKey, JSON.stringify(entry));

      // Update block list index
      const list = await getBlockList(actorId);
      if (!list.includes(targetId)) {
        list.push(targetId);
        await setBlockList(actorId, list);
      }

      return entry;
    },

    async unblock(ctx, targetId) {
      const actorId = ensureAuth(ctx);

      // Remove individual entry
      const entryKey = `block:${actorId}:${targetId}`;
      await kv.delete(entryKey);

      // Update block list index
      const list = await getBlockList(actorId);
      const newList = list.filter((id) => id !== targetId);
      await setBlockList(actorId, newList);
    },

    async isBlocked(actorId, targetId) {
      const entry = await getBlockEntry(actorId, targetId);
      return entry !== null;
    },

    async listBlockedIds(actorId) {
      return getBlockList(actorId);
    },

    async mute(ctx, targetId, duration) {
      const actorId = ensureAuth(ctx);

      if (actorId === targetId) {
        throw new Error("Cannot mute yourself");
      }

      const now = new Date();
      const entry: MuteEntry = {
        targetId,
        createdAt: now.toISOString(),
        expiresAt: duration ? new Date(now.getTime() + duration * 1000).toISOString() : null,
      };

      // Store individual entry
      const entryKey = `mute:${actorId}:${targetId}`;
      await kv.put(entryKey, JSON.stringify(entry));

      // Update mute list index
      const list = await getMuteList(actorId);
      if (!list.includes(targetId)) {
        list.push(targetId);
        await setMuteList(actorId, list);
      }

      return entry;
    },

    async unmute(ctx, targetId) {
      const actorId = ensureAuth(ctx);

      // Remove individual entry
      const entryKey = `mute:${actorId}:${targetId}`;
      await kv.delete(entryKey);

      // Update mute list index
      const list = await getMuteList(actorId);
      const newList = list.filter((id) => id !== targetId);
      await setMuteList(actorId, newList);
    },

    async isMuted(actorId, targetId) {
      const entry = await getMuteEntry(actorId, targetId);
      if (!entry) return false;

      // Check expiration
      if (entry.expiresAt) {
        const expiresAt = new Date(entry.expiresAt);
        if (expiresAt <= new Date()) {
          // Expired - clean up asynchronously
          const key = `mute:${actorId}:${targetId}`;
          kv.delete(key).catch(() => {});
          return false;
        }
      }

      return true;
    },

    async listMutedIds(actorId) {
      const list = await getMuteList(actorId);
      const now = new Date();
      const activeMutes: string[] = [];
      const expiredMutes: string[] = [];

      // Check each mute for expiration
      for (const targetId of list) {
        const entry = await getMuteEntry(actorId, targetId);
        if (!entry) {
          expiredMutes.push(targetId);
          continue;
        }

        if (entry.expiresAt) {
          const expiresAt = new Date(entry.expiresAt);
          if (expiresAt <= now) {
            expiredMutes.push(targetId);
            // Clean up expired entry
            const key = `mute:${actorId}:${targetId}`;
            kv.delete(key).catch(() => {});
            continue;
          }
        }

        activeMutes.push(targetId);
      }

      // Update list if there were expirations
      if (expiredMutes.length > 0) {
        setMuteList(actorId, activeMutes).catch(() => {});
      }

      return activeMutes;
    },
  };
}

/**
 * Creates a DB-based fallback service (for environments without KV)
 */
function createDbFallbackService(db: DbBlockMuteStore): BlockMuteService {
  return {
    async block(ctx, targetId) {
      const actorId = ensureAuth(ctx);
      if (actorId === targetId) {
        throw new Error("Cannot block yourself");
      }
      await db.blockUser(actorId, targetId);
      return {
        targetId,
        createdAt: new Date().toISOString(),
      };
    },

    async unblock(ctx, targetId) {
      const actorId = ensureAuth(ctx);
      await db.unblockUser(actorId, targetId);
    },

    async isBlocked(actorId, targetId) {
      return db.isBlocked(actorId, targetId);
    },

    async listBlockedIds(actorId) {
      const rows = await db.listBlockedUsers(actorId);
      return rows.map((r: { blocked_id: string }) => r.blocked_id);
    },

    async mute(ctx, targetId, _duration) {
      const actorId = ensureAuth(ctx);
      if (actorId === targetId) {
        throw new Error("Cannot mute yourself");
      }
      await db.muteUser(actorId, targetId);
      return {
        targetId,
        createdAt: new Date().toISOString(),
        expiresAt: null, // DB fallback doesn't support expiration
      };
    },

    async unmute(ctx, targetId) {
      const actorId = ensureAuth(ctx);
      await db.unmuteUser(actorId, targetId);
    },

    async isMuted(actorId, targetId) {
      return db.isMuted(actorId, targetId);
    },

    async listMutedIds(actorId) {
      const rows = await db.listMutedUsers(actorId);
      return rows.map((r: { muted_id: string }) => r.muted_id);
    },
  };
}

export type { BlockMuteService as BlockMuteServiceInterface };
