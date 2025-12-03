/**
 * AI Proposal Queue
 *
 * PLAN.md 6.4.3 に基づく「手動承認フロー」の実装
 * AI からの設定変更提案を「提案キュー」に蓄積し、オーナーが個別に承認するフロー
 */

export type ProposalType =
  | "config_change"      // takos-config.json の変更
  | "code_patch"         // App Layer のコード変更
  | "action_enable"      // AI Action の有効化
  | "action_disable";    // AI Action の無効化

export type ProposalStatus =
  | "pending"            // 承認待ち
  | "approved"           // 承認済み（適用済み）
  | "rejected"           // 拒否
  | "expired";           // 期限切れ

export interface ProposalMetadata {
  /** 提案元のエージェント種別 */
  agentType: "user" | "system" | "dev";
  /** 提案の理由・説明 */
  reason?: string;
  /** 関連する会話ID */
  conversationId?: string;
  /** 追加のコンテキスト */
  context?: Record<string, unknown>;
}

export interface ConfigChangeProposal {
  type: "config_change";
  /** 変更するキーのパス（ドット記法） */
  path: string;
  /** 現在の値 */
  currentValue: unknown;
  /** 提案する新しい値 */
  proposedValue: unknown;
}

export interface CodePatchProposal {
  type: "code_patch";
  /** ワークスペースID */
  workspaceId: string;
  /** 対象ファイルパス */
  filePath: string;
  /** diff 形式のパッチ */
  patch: string;
  /** パッチの説明 */
  description?: string;
}

export interface ActionEnableProposal {
  type: "action_enable";
  /** 有効化する AI Action の ID */
  actionId: string;
  /** アクションの説明 */
  actionDescription?: string;
  /** データポリシー */
  dataPolicy?: {
    sendPublicPosts: boolean;
    sendCommunityPosts: boolean;
    sendDm: boolean;
    sendProfile: boolean;
  };
}

export interface ActionDisableProposal {
  type: "action_disable";
  /** 無効化する AI Action の ID */
  actionId: string;
}

export type ProposalContent =
  | ConfigChangeProposal
  | CodePatchProposal
  | ActionEnableProposal
  | ActionDisableProposal;

export interface Proposal {
  /** 一意の提案ID */
  id: string;
  /** 提案のタイプ */
  type: ProposalType;
  /** 提案のステータス */
  status: ProposalStatus;
  /** 提案の内容 */
  content: ProposalContent;
  /** 提案のメタデータ */
  metadata: ProposalMetadata;
  /** 作成日時 */
  createdAt: string;
  /** 更新日時 */
  updatedAt: string;
  /** 有効期限（省略時は無期限） */
  expiresAt?: string;
  /** 審査者のユーザーID（承認/拒否時） */
  reviewedBy?: string;
  /** 審査日時 */
  reviewedAt?: string;
  /** 審査コメント */
  reviewComment?: string;
}

export interface ProposalQueueStats {
  /** 承認待ちの提案数 */
  pending: number;
  /** 承認済みの提案数 */
  approved: number;
  /** 拒否された提案数 */
  rejected: number;
  /** 期限切れの提案数 */
  expired: number;
}

export interface ListProposalsParams {
  /** ステータスでフィルタ */
  status?: ProposalStatus | ProposalStatus[];
  /** タイプでフィルタ */
  type?: ProposalType | ProposalType[];
  /** エージェント種別でフィルタ */
  agentType?: "user" | "system" | "dev";
  /** ページネーション: オフセット */
  offset?: number;
  /** ページネーション: 件数 */
  limit?: number;
  /** ソート順 */
  orderBy?: "createdAt" | "updatedAt";
  /** 降順かどうか */
  desc?: boolean;
}

export interface ProposalQueueStorage {
  /** 提案を保存 */
  save(proposal: Proposal): Promise<void>;
  /** 提案を取得 */
  get(id: string): Promise<Proposal | null>;
  /** 提案を一覧 */
  list(params: ListProposalsParams): Promise<Proposal[]>;
  /** 提案を更新 */
  update(id: string, updates: Partial<Proposal>): Promise<void>;
  /** 提案を削除 */
  delete(id: string): Promise<void>;
  /** 統計情報を取得 */
  getStats(): Promise<ProposalQueueStats>;
  /** 期限切れの提案を処理 */
  expireOld(before: string): Promise<number>;
}

/**
 * Proposal Queue Manager
 */
export interface ProposalQueue {
  /**
   * 新しい提案を作成
   */
  create(content: ProposalContent, metadata: ProposalMetadata): Promise<Proposal>;

  /**
   * 提案を取得
   */
  get(id: string): Promise<Proposal | null>;

  /**
   * 提案を一覧
   */
  list(params?: ListProposalsParams): Promise<Proposal[]>;

  /**
   * 提案を承認
   */
  approve(id: string, reviewerId: string, comment?: string): Promise<Proposal>;

  /**
   * 提案を拒否
   */
  reject(id: string, reviewerId: string, comment?: string): Promise<Proposal>;

  /**
   * 統計情報を取得
   */
  getStats(): Promise<ProposalQueueStats>;

  /**
   * 期限切れの提案を処理
   */
  expireOld(): Promise<number>;
}

/**
 * UUID 生成ヘルパー
 */
function generateProposalId(): string {
  const g = globalThis as Record<string, unknown>;
  if (g.crypto && typeof (g.crypto as { randomUUID?: () => string }).randomUUID === "function") {
    return `prop_${(g.crypto as { randomUUID: () => string }).randomUUID()}`;
  }
  return `prop_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

/**
 * In-Memory Proposal Queue Storage（開発用）
 */
export class InMemoryProposalQueueStorage implements ProposalQueueStorage {
  private proposals: Map<string, Proposal> = new Map();

  async save(proposal: Proposal): Promise<void> {
    this.proposals.set(proposal.id, { ...proposal });
  }

  async get(id: string): Promise<Proposal | null> {
    return this.proposals.get(id) ?? null;
  }

  async list(params: ListProposalsParams): Promise<Proposal[]> {
    let items = Array.from(this.proposals.values());

    // フィルタリング
    if (params.status) {
      const statuses = Array.isArray(params.status) ? params.status : [params.status];
      items = items.filter((p) => statuses.includes(p.status));
    }
    if (params.type) {
      const types = Array.isArray(params.type) ? params.type : [params.type];
      items = items.filter((p) => types.includes(p.type));
    }
    if (params.agentType) {
      items = items.filter((p) => p.metadata.agentType === params.agentType);
    }

    // ソート
    const orderBy = params.orderBy ?? "createdAt";
    items.sort((a, b) => {
      const aVal = a[orderBy];
      const bVal = b[orderBy];
      return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    });
    if (params.desc) {
      items.reverse();
    }

    // ページネーション
    const offset = params.offset ?? 0;
    const limit = params.limit ?? 50;
    return items.slice(offset, offset + limit);
  }

  async update(id: string, updates: Partial<Proposal>): Promise<void> {
    const existing = this.proposals.get(id);
    if (!existing) {
      throw new Error(`Proposal not found: ${id}`);
    }
    this.proposals.set(id, { ...existing, ...updates, updatedAt: new Date().toISOString() });
  }

  async delete(id: string): Promise<void> {
    this.proposals.delete(id);
  }

  async getStats(): Promise<ProposalQueueStats> {
    const items = Array.from(this.proposals.values());
    return {
      pending: items.filter((p) => p.status === "pending").length,
      approved: items.filter((p) => p.status === "approved").length,
      rejected: items.filter((p) => p.status === "rejected").length,
      expired: items.filter((p) => p.status === "expired").length,
    };
  }

  async expireOld(before: string): Promise<number> {
    let count = 0;
    for (const [id, proposal] of this.proposals) {
      if (
        proposal.status === "pending" &&
        proposal.expiresAt &&
        proposal.expiresAt < before
      ) {
        this.proposals.set(id, {
          ...proposal,
          status: "expired",
          updatedAt: new Date().toISOString(),
        });
        count++;
      }
    }
    return count;
  }
}

/**
 * Proposal Queue の実装
 */
export function createProposalQueue(storage: ProposalQueueStorage): ProposalQueue {
  return {
    async create(content: ProposalContent, metadata: ProposalMetadata): Promise<Proposal> {
      const now = new Date().toISOString();
      const proposal: Proposal = {
        id: generateProposalId(),
        type: content.type,
        status: "pending",
        content,
        metadata,
        createdAt: now,
        updatedAt: now,
      };
      await storage.save(proposal);
      return proposal;
    },

    async get(id: string): Promise<Proposal | null> {
      return storage.get(id);
    },

    async list(params?: ListProposalsParams): Promise<Proposal[]> {
      return storage.list(params ?? {});
    },

    async approve(id: string, reviewerId: string, comment?: string): Promise<Proposal> {
      const proposal = await storage.get(id);
      if (!proposal) {
        throw new Error(`Proposal not found: ${id}`);
      }
      if (proposal.status !== "pending") {
        throw new Error(`Proposal is not pending: ${proposal.status}`);
      }

      const now = new Date().toISOString();
      await storage.update(id, {
        status: "approved",
        reviewedBy: reviewerId,
        reviewedAt: now,
        reviewComment: comment,
      });

      return { ...proposal, status: "approved", reviewedBy: reviewerId, reviewedAt: now, reviewComment: comment };
    },

    async reject(id: string, reviewerId: string, comment?: string): Promise<Proposal> {
      const proposal = await storage.get(id);
      if (!proposal) {
        throw new Error(`Proposal not found: ${id}`);
      }
      if (proposal.status !== "pending") {
        throw new Error(`Proposal is not pending: ${proposal.status}`);
      }

      const now = new Date().toISOString();
      await storage.update(id, {
        status: "rejected",
        reviewedBy: reviewerId,
        reviewedAt: now,
        reviewComment: comment,
      });

      return { ...proposal, status: "rejected", reviewedBy: reviewerId, reviewedAt: now, reviewComment: comment };
    },

    async getStats(): Promise<ProposalQueueStats> {
      return storage.getStats();
    },

    async expireOld(): Promise<number> {
      return storage.expireOld(new Date().toISOString());
    },
  };
}
