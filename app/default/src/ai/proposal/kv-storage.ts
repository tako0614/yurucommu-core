/**
 * KV-based Proposal Queue Storage for App Layer
 *
 * Uses Cloudflare KV for proposal storage, suitable for serverless deployments.
 */

import type {
  Proposal,
  ProposalQueueStorage,
  ProposalQueueStats,
  ListProposalsParams,
} from "@takos/platform/ai/proposal-queue";

export interface KvProposalQueueStorageOptions {
  /** KV namespace */
  kv: KVNamespace;
  /** Key prefix (default: "proposals:") */
  prefix?: string;
  /** Default TTL for proposals in seconds (default: 30 days) */
  defaultTtl?: number;
}

/**
 * KV-based Proposal Queue Storage
 *
 * Key structure:
 * - proposals:item:{id} - Individual proposal
 * - proposals:index:status:{status} - List of proposal IDs by status
 * - proposals:index:type:{type} - List of proposal IDs by type
 * - proposals:stats - Cached statistics
 */
export class KvProposalQueueStorage implements ProposalQueueStorage {
  private kv: KVNamespace;
  private prefix: string;
  private defaultTtl: number;

  constructor(options: KvProposalQueueStorageOptions) {
    this.kv = options.kv;
    this.prefix = options.prefix ?? "proposals:";
    this.defaultTtl = options.defaultTtl ?? 30 * 24 * 60 * 60; // 30 days
  }

  private itemKey(id: string): string {
    return `${this.prefix}item:${id}`;
  }

  private statusIndexKey(status: string): string {
    return `${this.prefix}index:status:${status}`;
  }

  private typeIndexKey(type: string): string {
    return `${this.prefix}index:type:${type}`;
  }

  private statsKey(): string {
    return `${this.prefix}stats`;
  }

  private async getIndex(key: string): Promise<string[]> {
    const value = await this.kv.get(key, "json");
    return Array.isArray(value) ? value : [];
  }

  private async addToIndex(key: string, id: string): Promise<void> {
    const index = await this.getIndex(key);
    if (!index.includes(id)) {
      index.push(id);
      await this.kv.put(key, JSON.stringify(index));
    }
  }

  private async removeFromIndex(key: string, id: string): Promise<void> {
    const index = await this.getIndex(key);
    const newIndex = index.filter((i) => i !== id);
    if (newIndex.length !== index.length) {
      await this.kv.put(key, JSON.stringify(newIndex));
    }
  }

  private async updateStats(delta: Partial<ProposalQueueStats>): Promise<void> {
    const stats = await this.getStats();
    const newStats: ProposalQueueStats = {
      pending: stats.pending + (delta.pending ?? 0),
      approved: stats.approved + (delta.approved ?? 0),
      rejected: stats.rejected + (delta.rejected ?? 0),
      expired: stats.expired + (delta.expired ?? 0),
    };
    await this.kv.put(this.statsKey(), JSON.stringify(newStats));
  }

  async save(proposal: Proposal): Promise<void> {
    // Calculate TTL
    let ttl = this.defaultTtl;
    if (proposal.expiresAt) {
      const expiresMs = new Date(proposal.expiresAt).getTime() - Date.now();
      if (expiresMs > 0) {
        ttl = Math.ceil(expiresMs / 1000);
      }
    }

    // Save proposal
    await this.kv.put(this.itemKey(proposal.id), JSON.stringify(proposal), {
      expirationTtl: ttl,
    });

    // Update indexes
    await this.addToIndex(this.statusIndexKey(proposal.status), proposal.id);
    await this.addToIndex(this.typeIndexKey(proposal.type), proposal.id);

    // Update stats
    await this.updateStats({ [proposal.status]: 1 });
  }

  async get(id: string): Promise<Proposal | null> {
    const value = await this.kv.get(this.itemKey(id), "json");
    return value as Proposal | null;
  }

  async list(params: ListProposalsParams): Promise<Proposal[]> {
    let ids: string[] = [];

    // Get IDs based on filters
    if (params.status) {
      const statuses = Array.isArray(params.status) ? params.status : [params.status];
      for (const status of statuses) {
        const statusIds = await this.getIndex(this.statusIndexKey(status));
        ids.push(...statusIds);
      }
      // Deduplicate
      ids = [...new Set(ids)];
    } else if (params.type) {
      const types = Array.isArray(params.type) ? params.type : [params.type];
      for (const type of types) {
        const typeIds = await this.getIndex(this.typeIndexKey(type));
        ids.push(...typeIds);
      }
      ids = [...new Set(ids)];
    } else {
      // Get all statuses
      const allStatuses = ["pending", "approved", "rejected", "expired"];
      for (const status of allStatuses) {
        const statusIds = await this.getIndex(this.statusIndexKey(status));
        ids.push(...statusIds);
      }
    }

    // Fetch proposals
    const proposals: Proposal[] = [];
    for (const id of ids) {
      const proposal = await this.get(id);
      if (proposal) {
        // Apply additional filters
        if (params.agentType && proposal.metadata.agentType !== params.agentType) {
          continue;
        }
        if (params.type) {
          const types = Array.isArray(params.type) ? params.type : [params.type];
          if (!types.includes(proposal.type)) {
            continue;
          }
        }
        proposals.push(proposal);
      }
    }

    // Sort
    const orderBy = params.orderBy ?? "createdAt";
    proposals.sort((a, b) => {
      const aVal = a[orderBy] ?? "";
      const bVal = b[orderBy] ?? "";
      return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    });
    if (params.desc) {
      proposals.reverse();
    }

    // Pagination
    const offset = params.offset ?? 0;
    const limit = params.limit ?? 50;
    return proposals.slice(offset, offset + limit);
  }

  async update(id: string, updates: Partial<Proposal>): Promise<void> {
    const existing = await this.get(id);
    if (!existing) {
      throw new Error(`Proposal not found: ${id}`);
    }

    const oldStatus = existing.status;
    const updated: Proposal = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    // Update proposal
    await this.kv.put(this.itemKey(id), JSON.stringify(updated));

    // Update status index if status changed
    if (updates.status && updates.status !== oldStatus) {
      await this.removeFromIndex(this.statusIndexKey(oldStatus), id);
      await this.addToIndex(this.statusIndexKey(updates.status), id);

      // Update stats
      const statsDelta: Partial<ProposalQueueStats> = {
        [oldStatus]: -1,
        [updates.status]: 1,
      };
      await this.updateStats(statsDelta);
    }
  }

  async delete(id: string): Promise<void> {
    const existing = await this.get(id);
    if (existing) {
      // Remove from indexes
      await this.removeFromIndex(this.statusIndexKey(existing.status), id);
      await this.removeFromIndex(this.typeIndexKey(existing.type), id);

      // Update stats
      await this.updateStats({ [existing.status]: -1 });
    }

    // Delete proposal
    await this.kv.delete(this.itemKey(id));
  }

  async getStats(): Promise<ProposalQueueStats> {
    const value = await this.kv.get(this.statsKey(), "json");
    if (value && typeof value === "object") {
      return value as ProposalQueueStats;
    }

    // Calculate stats from indexes
    const pending = (await this.getIndex(this.statusIndexKey("pending"))).length;
    const approved = (await this.getIndex(this.statusIndexKey("approved"))).length;
    const rejected = (await this.getIndex(this.statusIndexKey("rejected"))).length;
    const expired = (await this.getIndex(this.statusIndexKey("expired"))).length;

    const stats: ProposalQueueStats = { pending, approved, rejected, expired };
    await this.kv.put(this.statsKey(), JSON.stringify(stats));
    return stats;
  }

  async expireOld(before: string): Promise<number> {
    const pendingIds = await this.getIndex(this.statusIndexKey("pending"));
    let count = 0;

    for (const id of pendingIds) {
      const proposal = await this.get(id);
      if (proposal && proposal.expiresAt && proposal.expiresAt < before) {
        await this.update(id, {
          status: "expired",
        });
        count++;
      }
    }

    return count;
  }
}

/**
 * Create a KV-based proposal queue storage
 */
export function createKvProposalQueueStorage(
  options: KvProposalQueueStorageOptions,
): ProposalQueueStorage {
  return new KvProposalQueueStorage(options);
}
