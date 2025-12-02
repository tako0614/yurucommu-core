/**
 * AI Agent Tools
 *
 * PLAN.md 6.4.2 で定義された、AI エージェントが利用する tool 群
 * これらは LangChain / LangGraph などのエージェントフレームワークで利用される
 */

import type { TakosConfig } from "../config/takos-config.js";
import type { AiActionDefinition } from "./action-registry.js";
import type { CoreServices } from "../app/services/index.js";

/**
 * Tool Context
 * すべてのツールが受け取る共通コンテキスト
 */
export interface ToolContext {
  /** 認証情報 */
  auth: {
    userId: string | null;
    isAuthenticated: boolean;
  };
  /** ノード設定 */
  nodeConfig: TakosConfig;
  /** Core Services へのアクセス */
  services?: CoreServices;
  /** 環境変数など */
  env?: Record<string, unknown>;
}

/**
 * 1. tool.describeNodeCapabilities
 *
 * 現在のノードの機能・設定を説明
 */
export interface DescribeNodeCapabilitiesInput {
  /** 詳細レベル: "basic" | "full" */
  level?: "basic" | "full";
}

export interface DescribeNodeCapabilitiesOutput {
  /** takos-core バージョン */
  coreVersion: string;
  /** distro 名（takos-profile.json.name） */
  distroName: string;
  /** distro バージョン */
  distroVersion: string;
  /** 登録済み AI Action 一覧 */
  availableActions: AiActionDefinition[];
  /** 有効化された AI Action 一覧 */
  enabledActions: string[];
  /** ノードの主要機能 */
  features: {
    activitypub: boolean;
    communities: boolean;
    stories: boolean;
    dm: boolean;
    [key: string]: boolean;
  };
  /** AI データポリシー */
  dataPolicy?: {
    sendPublicPosts: boolean;
    sendCommunityPosts: boolean;
    sendDm: boolean;
    sendProfile: boolean;
  };
}

export type DescribeNodeCapabilitiesTool = (
  ctx: ToolContext,
  input: DescribeNodeCapabilitiesInput,
) => Promise<DescribeNodeCapabilitiesOutput>;

/**
 * 2. tool.inspectService
 *
 * Core Kernel サービス API の一覧を返す
 */
export interface InspectServiceInput {
  /** サービス名（省略時は全サービス） */
  serviceName?: "posts" | "users" | "communities" | "dm" | "stories";
}

export interface ServiceMethodInfo {
  name: string;
  description: string;
  parameters: Array<{
    name: string;
    type: string;
    required: boolean;
  }>;
  returnType: string;
}

export interface InspectServiceOutput {
  services: Array<{
    name: string;
    description: string;
    methods: ServiceMethodInfo[];
  }>;
}

export type InspectServiceTool = (
  ctx: ToolContext,
  input: InspectServiceInput,
) => Promise<InspectServiceOutput>;

/**
 * 3. tool.updateTakosConfig
 *
 * takos-config.json の一部を更新
 * オーナーのみ実行可能
 */
export interface UpdateTakosConfigInput {
  /** 更新するキーのパス（ドット記法） */
  path: string;
  /** 新しい値 */
  value: unknown;
  /** 確認メッセージ（省略時は自動生成） */
  confirmMessage?: string;
}

export interface UpdateTakosConfigOutput {
  success: boolean;
  /** 更新されたキー */
  updatedPath: string;
  /** 更新後の値 */
  newValue: unknown;
  /** 前の値 */
  previousValue?: unknown;
}

export type UpdateTakosConfigTool = (
  ctx: ToolContext,
  input: UpdateTakosConfigInput,
) => Promise<UpdateTakosConfigOutput>;

/**
 * 4. tool.applyCodePatch
 *
 * App Layer のコードにパッチを適用
 * dev Workspace 上でのみ動作
 * オーナーのみ実行可能
 */
export interface ApplyCodePatchInput {
  /** ワークスペースID（省略時はデフォルト） */
  workspaceId?: string;
  /** 対象ファイルパス */
  filePath: string;
  /** diff 形式のパッチ */
  patch: string;
  /** パッチの説明 */
  description?: string;
}

export interface ApplyCodePatchOutput {
  success: boolean;
  /** 適用されたワークスペースID */
  workspaceId: string;
  /** 適用されたファイルパス */
  filePath: string;
  /** パッチの結果メッセージ */
  message: string;
}

export type ApplyCodePatchTool = (
  ctx: ToolContext,
  input: ApplyCodePatchInput,
) => Promise<ApplyCodePatchOutput>;

/**
 * 5. tool.runAIAction
 *
 * 登録済みかつ有効化された AI Action を実行
 */
export interface RunAIActionInput {
  /** 実行する AI Action の ID */
  actionId: string;
  /** アクションへの入力 */
  input: unknown;
}

export interface RunAIActionOutput {
  success: boolean;
  /** アクションの実行結果 */
  output: unknown;
  /** エラーメッセージ（失敗時） */
  error?: string;
}

export type RunAIActionTool = (
  ctx: ToolContext,
  input: RunAIActionInput,
) => Promise<RunAIActionOutput>;

/**
 * Agent Tools レジストリ
 */
export interface AgentTools {
  describeNodeCapabilities: DescribeNodeCapabilitiesTool;
  inspectService: InspectServiceTool;
  updateTakosConfig: UpdateTakosConfigTool;
  applyCodePatch: ApplyCodePatchTool;
  runAIAction: RunAIActionTool;
}

/**
 * ツールの実行権限チェック
 */
export function requireAuthenticated(ctx: ToolContext): void {
  if (!ctx.auth.isAuthenticated) {
    throw new Error("This tool requires authentication");
  }
}

/**
 * ツールのデータポリシーチェック
 */
export function checkDataPolicy(
  ctx: ToolContext,
  requiredPolicy: Partial<{
    sendPublicPosts: boolean;
    sendCommunityPosts: boolean;
    sendDm: boolean;
    sendProfile: boolean;
  }>,
): void {
  const nodePolicy = ctx.nodeConfig.ai?.data_policy;
  if (!nodePolicy) {
    throw new Error("AI data policy not configured");
  }

  if (requiredPolicy.sendPublicPosts && !nodePolicy.sendPublicPosts) {
    throw new Error("Data policy violation: sendPublicPosts not allowed");
  }
  if (requiredPolicy.sendCommunityPosts && !nodePolicy.sendCommunityPosts) {
    throw new Error("Data policy violation: sendCommunityPosts not allowed");
  }
  if (requiredPolicy.sendDm && !nodePolicy.sendDm) {
    throw new Error("Data policy violation: sendDm not allowed");
  }
  if (requiredPolicy.sendProfile && !nodePolicy.sendProfile) {
    throw new Error("Data policy violation: sendProfile not allowed");
  }
}
