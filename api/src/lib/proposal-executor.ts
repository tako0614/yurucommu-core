/**
 * Proposal Executor
 *
 * PLAN.md 6.4.3 に基づく提案実行ロジック
 * 承認された提案を実際に適用する
 */

/// <reference types="@cloudflare/workers-types" />

import type { TakosConfig } from "@takos/platform/server";
import { applyPatch, validateTakosConfig } from "@takos/platform/server";
import type {
  Proposal,
  ProposalContent,
  ConfigChangeProposal,
  CodePatchProposal,
  ActionEnableProposal,
  ActionDisableProposal,
} from "@takos/platform/ai/proposal-queue";
import { loadStoredConfig, persistConfig } from "./config-utils";
import { createWorkspaceStore, type WorkspaceStore } from "./workspace-store";

export type ProposalExecutionResult = {
  success: boolean;
  message: string;
  details?: Record<string, unknown>;
};

/**
 * 設定値のパス解決（ドット記法）
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * 設定値のパス設定（ドット記法）
 */
function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const keys = path.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || typeof current[key] !== "object" || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}

/**
 * config_change 提案を実行
 */
async function executeConfigChange(
  db: D1Database,
  proposal: ConfigChangeProposal
): Promise<ProposalExecutionResult> {
  try {
    // 現在の設定を読み込み
    const { config: storedConfig, warnings } = await loadStoredConfig(db);
    if (!storedConfig) {
      return {
        success: false,
        message: `Failed to load stored config: ${warnings.join("; ")}`,
      };
    }

    // パスを検証
    const currentValue = getNestedValue(storedConfig as Record<string, unknown>, proposal.path);

    // 新しい設定を構築
    const newConfig = JSON.parse(JSON.stringify(storedConfig)) as Record<string, unknown>;
    setNestedValue(newConfig, proposal.path, proposal.proposedValue);

    // バリデーション
    const validation = validateTakosConfig(newConfig);
    if (!validation.ok || !validation.config) {
      return {
        success: false,
        message: `Invalid config after applying change: ${validation.errors.join("; ")}`,
      };
    }

    // 保存
    await persistConfig(db, validation.config);

    return {
      success: true,
      message: `Config updated: ${proposal.path}`,
      details: {
        path: proposal.path,
        previousValue: currentValue,
        newValue: proposal.proposedValue,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to execute config change: ${(error as Error).message}`,
    };
  }
}

/**
 * code_patch 提案を実行
 */
async function executeCodePatch(
  db: D1Database,
  proposal: CodePatchProposal
): Promise<ProposalExecutionResult> {
  try {
    const store = createWorkspaceStore(db);

    // ワークスペースの存在確認
    const workspace = await store.getWorkspace(proposal.workspaceId);
    if (!workspace) {
      return {
        success: false,
        message: `Workspace not found: ${proposal.workspaceId}`,
      };
    }

    // 既存ファイルを取得
    const existingFile = await store.getWorkspaceFile(proposal.workspaceId, proposal.filePath);
    const existingContent = existingFile
      ? new TextDecoder().decode(existingFile.content)
      : "";

    // パッチを適用（unified diff, replace:, または追記をサポート）
    const patchResult = applyPatch(existingContent, proposal.patch);

    if (!patchResult.success && patchResult.error) {
      return {
        success: false,
        message: `Failed to apply patch: ${patchResult.error}`,
        details: {
          workspaceId: proposal.workspaceId,
          filePath: proposal.filePath,
        },
      };
    }

    // ファイルを保存
    await store.saveWorkspaceFile(
      proposal.workspaceId,
      proposal.filePath,
      patchResult.content,
      "text/plain"
    );

    return {
      success: true,
      message: `Patch applied to ${proposal.filePath} in workspace ${proposal.workspaceId}`,
      details: {
        workspaceId: proposal.workspaceId,
        filePath: proposal.filePath,
        description: proposal.description,
        warnings: patchResult.warnings,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to execute code patch: ${(error as Error).message}`,
    };
  }
}

/**
 * action_enable 提案を実行
 */
async function executeActionEnable(
  db: D1Database,
  proposal: ActionEnableProposal
): Promise<ProposalExecutionResult> {
  try {
    const { config: storedConfig, warnings } = await loadStoredConfig(db);
    if (!storedConfig) {
      return {
        success: false,
        message: `Failed to load stored config: ${warnings.join("; ")}`,
      };
    }

    // enabled_actions を更新
    const currentActions = storedConfig.ai?.enabled_actions ?? [];
    if (currentActions.includes(proposal.actionId)) {
      return {
        success: true,
        message: `Action ${proposal.actionId} is already enabled`,
        details: { actionId: proposal.actionId, alreadyEnabled: true },
      };
    }

    const newActions = [...currentActions, proposal.actionId];
    const newConfig = JSON.parse(JSON.stringify(storedConfig)) as TakosConfig;
    if (!newConfig.ai) {
      newConfig.ai = {};
    }
    newConfig.ai.enabled_actions = newActions;

    // data_policy も更新（提案に含まれている場合）
    if (proposal.dataPolicy) {
      newConfig.ai.data_policy = {
        ...newConfig.ai.data_policy,
        send_public_posts: proposal.dataPolicy.sendPublicPosts,
        send_community_posts: proposal.dataPolicy.sendCommunityPosts,
        send_dm: proposal.dataPolicy.sendDm,
        send_profile: proposal.dataPolicy.sendProfile,
      };
    }

    // バリデーションと保存
    const validation = validateTakosConfig(newConfig);
    if (!validation.ok || !validation.config) {
      return {
        success: false,
        message: `Invalid config after enabling action: ${validation.errors.join("; ")}`,
      };
    }

    await persistConfig(db, validation.config);

    return {
      success: true,
      message: `Action ${proposal.actionId} enabled`,
      details: {
        actionId: proposal.actionId,
        description: proposal.actionDescription,
        enabledActions: newActions,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to enable action: ${(error as Error).message}`,
    };
  }
}

/**
 * action_disable 提案を実行
 */
async function executeActionDisable(
  db: D1Database,
  proposal: ActionDisableProposal
): Promise<ProposalExecutionResult> {
  try {
    const { config: storedConfig, warnings } = await loadStoredConfig(db);
    if (!storedConfig) {
      return {
        success: false,
        message: `Failed to load stored config: ${warnings.join("; ")}`,
      };
    }

    const currentActions = storedConfig.ai?.enabled_actions ?? [];
    if (!currentActions.includes(proposal.actionId)) {
      return {
        success: true,
        message: `Action ${proposal.actionId} is already disabled`,
        details: { actionId: proposal.actionId, alreadyDisabled: true },
      };
    }

    const newActions = currentActions.filter((id) => id !== proposal.actionId);
    const newConfig = JSON.parse(JSON.stringify(storedConfig)) as TakosConfig;
    if (!newConfig.ai) {
      newConfig.ai = {};
    }
    newConfig.ai.enabled_actions = newActions;

    const validation = validateTakosConfig(newConfig);
    if (!validation.ok || !validation.config) {
      return {
        success: false,
        message: `Invalid config after disabling action: ${validation.errors.join("; ")}`,
      };
    }

    await persistConfig(db, validation.config);

    return {
      success: true,
      message: `Action ${proposal.actionId} disabled`,
      details: {
        actionId: proposal.actionId,
        enabledActions: newActions,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to disable action: ${(error as Error).message}`,
    };
  }
}

/**
 * 提案を実行
 */
export async function executeProposal(
  db: D1Database,
  proposal: Proposal
): Promise<ProposalExecutionResult> {
  const content = proposal.content;

  switch (content.type) {
    case "config_change":
      return executeConfigChange(db, content);
    case "code_patch":
      return executeCodePatch(db, content);
    case "action_enable":
      return executeActionEnable(db, content);
    case "action_disable":
      return executeActionDisable(db, content);
    default:
      return {
        success: false,
        message: `Unknown proposal type: ${(content as any).type}`,
      };
  }
}
