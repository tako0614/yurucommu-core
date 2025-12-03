/**
 * AI Workflow Types
 *
 * PLAN.md 6.1-6.4 に基づく高度な AI ワークフロー機能の型定義
 * LangChain/LangGraph に相当するマルチステップエージェントワークフローをサポート
 */

import type { AiActionDefinition, AiActionHandler } from "../action-registry";
import type { AiProviderClient, EffectiveAiDataPolicy } from "../provider-registry";
import type { TakosConfig } from "../../config/takos-config";

// ========================================
// Core Workflow Types
// ========================================

/**
 * ワークフローの状態
 */
export type WorkflowStatus =
  | "pending"      // 実行待ち
  | "running"      // 実行中
  | "paused"       // 一時停止
  | "completed"    // 正常完了
  | "failed"       // 失敗
  | "cancelled";   // キャンセル

/**
 * ワークフローステップの種類
 */
export type WorkflowStepType =
  | "ai_action"      // AI アクションの呼び出し
  | "tool_call"      // ツールの呼び出し
  | "condition"      // 条件分岐
  | "loop"           // ループ処理
  | "parallel"       // 並列実行
  | "human_approval" // 人間の承認待ち
  | "transform";     // データ変換

/**
 * 単一ワークフローステップの定義
 */
export interface WorkflowStep {
  id: string;
  type: WorkflowStepType;
  name: string;
  description?: string;

  // 入力データの参照（前ステップの出力を参照）
  inputMapping?: Record<string, string | WorkflowDataRef>;

  // ステップ固有の設定
  config: WorkflowStepConfig;

  // 次のステップ（条件分岐の場合は複数）
  next?: string | WorkflowBranch[];

  // エラーハンドリング
  onError?: WorkflowErrorHandler;

  // タイムアウト（ミリ秒）
  timeout?: number;

  // リトライ設定
  retry?: WorkflowRetryConfig;
}

/**
 * ワークフローステップの設定（種類別）
 */
export type WorkflowStepConfig =
  | AiActionStepConfig
  | ToolCallStepConfig
  | ConditionStepConfig
  | LoopStepConfig
  | ParallelStepConfig
  | HumanApprovalStepConfig
  | TransformStepConfig;

/**
 * AI アクション呼び出しステップ
 */
export interface AiActionStepConfig {
  type: "ai_action";
  actionId: string;
  input: Record<string, unknown>;
  providerId?: string;
}

/**
 * ツール呼び出しステップ
 */
export interface ToolCallStepConfig {
  type: "tool_call";
  toolName: string;
  input: Record<string, unknown>;
}

/**
 * 条件分岐ステップ
 */
export interface ConditionStepConfig {
  type: "condition";
  expression: string;  // 簡易式言語または JSON Logic
  branches: WorkflowBranch[];
}

/**
 * ループステップ
 */
export interface LoopStepConfig {
  type: "loop";
  maxIterations: number;
  condition: string;
  body: WorkflowStep[];
}

/**
 * 並列実行ステップ
 */
export interface ParallelStepConfig {
  type: "parallel";
  branches: WorkflowStep[][];
  waitFor: "all" | "any" | "none";
}

/**
 * 人間の承認待ちステップ
 */
export interface HumanApprovalStepConfig {
  type: "human_approval";
  message: string;
  approvalType: "approve_reject" | "choice";
  choices?: string[];
  timeout?: number;
}

/**
 * データ変換ステップ
 */
export interface TransformStepConfig {
  type: "transform";
  expression: string;  // JavaScript または JSON Logic
}

/**
 * 条件分岐の定義
 */
export interface WorkflowBranch {
  condition: string;
  nextStep: string;
}

/**
 * データ参照（前ステップの出力を参照）
 */
export interface WorkflowDataRef {
  type: "ref";
  stepId: string;
  path: string;  // JSON パス形式
}

/**
 * エラーハンドリング設定
 */
export interface WorkflowErrorHandler {
  action: "fail" | "retry" | "skip" | "fallback";
  fallbackStep?: string;
  message?: string;
}

/**
 * リトライ設定
 */
export interface WorkflowRetryConfig {
  maxAttempts: number;
  delayMs: number;
  backoffMultiplier?: number;
}

// ========================================
// Workflow Definition & Instance
// ========================================

/**
 * ワークフロー定義
 */
export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  version: string;

  // 入力スキーマ
  inputSchema?: Record<string, unknown>;

  // 出力スキーマ
  outputSchema?: Record<string, unknown>;

  // ステップ一覧
  steps: WorkflowStep[];

  // 開始ステップ
  entryPoint: string;

  // データポリシー（ワークフロー全体）
  dataPolicy: Partial<EffectiveAiDataPolicy>;

  // メタデータ
  metadata?: {
    author?: string;
    createdAt?: string;
    updatedAt?: string;
    tags?: string[];
  };
}

/**
 * ワークフロー実行インスタンス
 */
export interface WorkflowInstance {
  id: string;
  definitionId: string;
  status: WorkflowStatus;

  // 入力データ
  input: Record<string, unknown>;

  // 現在のステップ
  currentStepId: string | null;

  // ステップ実行結果
  stepResults: Record<string, WorkflowStepResult>;

  // 最終出力
  output?: Record<string, unknown>;

  // エラー情報
  error?: WorkflowError;

  // 実行時間
  startedAt: string;
  completedAt?: string;

  // 実行者情報
  initiator: {
    type: "user" | "system" | "agent";
    id?: string;
  };
}

/**
 * ステップ実行結果
 */
export interface WorkflowStepResult {
  stepId: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  output?: unknown;
  error?: string;
  startedAt: string;
  completedAt?: string;
  attempts: number;
}

/**
 * ワークフローエラー
 */
export interface WorkflowError {
  stepId: string;
  code: string;
  message: string;
  details?: unknown;
}

// ========================================
// Workflow Execution Context
// ========================================

/**
 * ワークフロー実行コンテキスト
 */
export interface WorkflowExecutionContext {
  // ノード設定
  nodeConfig: TakosConfig;

  // AI プロバイダー
  provider: AiProviderClient;

  // データポリシー
  dataPolicy: EffectiveAiDataPolicy;

  // 認証コンテキスト
  auth: {
    userId: string | null;
    sessionId: string | null;
    isAuthenticated: boolean;
  };

  // 環境変数
  env: Record<string, string | undefined>;

  // ワークフローインスタンス
  instance: WorkflowInstance;

  // ログ関数
  log: (level: "debug" | "info" | "warn" | "error", message: string, data?: unknown) => void;
}

// ========================================
// Workflow Registry
// ========================================

/**
 * ワークフローレジストリインターフェース
 */
export interface WorkflowRegistry {
  register(definition: WorkflowDefinition): void;
  getDefinition(id: string): WorkflowDefinition | null;
  listDefinitions(): WorkflowDefinition[];
  unregister(id: string): boolean;
}

/**
 * ワークフロー実行エンジンインターフェース
 */
export interface WorkflowEngine {
  // ワークフロー開始
  start(
    definitionId: string,
    input: Record<string, unknown>,
    context: Omit<WorkflowExecutionContext, "instance">,
  ): Promise<WorkflowInstance>;

  // ワークフロー再開（一時停止からの復帰）
  resume(instanceId: string, input?: Record<string, unknown>): Promise<WorkflowInstance>;

  // ワークフローキャンセル
  cancel(instanceId: string): Promise<void>;

  // 人間の承認を送信
  submitApproval(instanceId: string, stepId: string, approved: boolean, choice?: string): Promise<void>;

  // インスタンス取得
  getInstance(instanceId: string): Promise<WorkflowInstance | null>;

  // インスタンス一覧
  listInstances(filters?: WorkflowInstanceFilters): Promise<WorkflowInstance[]>;
}

/**
 * ワークフローインスタンスフィルター
 */
export interface WorkflowInstanceFilters {
  definitionId?: string;
  status?: WorkflowStatus[];
  initiatorType?: "user" | "system" | "agent";
  initiatorId?: string;
  startedAfter?: string;
  startedBefore?: string;
  limit?: number;
  offset?: number;
}

// ========================================
// Built-in Workflow Templates
// ========================================

/**
 * 事前定義されたワークフローテンプレートID
 */
export type BuiltinWorkflowId =
  | "workflow.content_moderation"   // コンテンツモデレーション
  | "workflow.post_enhancement"     // 投稿の強化（要約、タグ付け）
  | "workflow.translation_chain"    // 翻訳チェーン
  | "workflow.dm_safety_check"      // DM 安全性チェック
  | "workflow.community_digest";    // コミュニティダイジェスト生成

/**
 * ワークフローイベント
 */
export type WorkflowEvent =
  | { type: "started"; instanceId: string; definitionId: string }
  | { type: "step_started"; instanceId: string; stepId: string }
  | { type: "step_completed"; instanceId: string; stepId: string; output: unknown }
  | { type: "step_failed"; instanceId: string; stepId: string; error: string }
  | { type: "approval_required"; instanceId: string; stepId: string; message: string }
  | { type: "completed"; instanceId: string; output: unknown }
  | { type: "failed"; instanceId: string; error: WorkflowError }
  | { type: "cancelled"; instanceId: string };

/**
 * ワークフローイベントハンドラー
 */
export type WorkflowEventHandler = (event: WorkflowEvent) => void | Promise<void>;
