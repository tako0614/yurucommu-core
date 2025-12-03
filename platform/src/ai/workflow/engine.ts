/**
 * AI Workflow Execution Engine
 *
 * ワークフローの実行エンジン実装
 * PLAN.md 6.4 に基づくマルチステップエージェントワークフローの実行
 */

import type {
  WorkflowDefinition,
  WorkflowEngine,
  WorkflowExecutionContext,
  WorkflowInstance,
  WorkflowInstanceFilters,
  WorkflowRegistry,
  WorkflowStep,
  WorkflowStepResult,
  WorkflowEvent,
  WorkflowEventHandler,
  WorkflowError,
  WorkflowDataRef,
  WorkflowStatus,
} from "./types";
import type { AiRegistry } from "../action-registry";
import type { AiProviderRegistry } from "../provider-registry";
import { chatCompletion, type ChatMessage } from "../provider-adapters";

/**
 * ワークフロー実行エラー
 */
export class WorkflowExecutionError extends Error {
  constructor(
    public readonly instanceId: string,
    public readonly stepId: string,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "WorkflowExecutionError";
  }
}

/**
 * 一意なIDを生成
 */
function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * JSON パスから値を取得
 */
function getValueByPath(obj: unknown, path: string): unknown {
  if (!path) return obj;

  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== "object") {
      return undefined;
    }

    // 配列インデックスのサポート
    const indexMatch = part.match(/^(\w+)\[(\d+)\]$/);
    if (indexMatch) {
      const key = indexMatch[1];
      const index = parseInt(indexMatch[2], 10);
      current = (current as Record<string, unknown>)[key];
      if (Array.isArray(current)) {
        current = current[index];
      } else {
        return undefined;
      }
    } else {
      current = (current as Record<string, unknown>)[part];
    }
  }

  return current;
}

/**
 * 入力マッピングを解決
 */
function resolveInputMapping(
  mapping: Record<string, string | WorkflowDataRef> | undefined,
  stepResults: Record<string, WorkflowStepResult>,
  workflowInput: Record<string, unknown>,
): Record<string, unknown> {
  if (!mapping) return {};

  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(mapping)) {
    if (typeof value === "string") {
      // 文字列の場合はそのまま使用
      resolved[key] = value;
    } else if (value && typeof value === "object" && value.type === "ref") {
      // データ参照の場合
      const ref = value as WorkflowDataRef;
      if (ref.stepId === "input") {
        // ワークフロー入力からの参照
        resolved[key] = getValueByPath(workflowInput, ref.path);
      } else {
        // 前ステップの出力からの参照
        const stepResult = stepResults[ref.stepId];
        if (stepResult?.output) {
          resolved[key] = getValueByPath(stepResult.output, ref.path);
        }
      }
    }
  }

  return resolved;
}

/**
 * 条件式を評価（シンプルな実装）
 */
function evaluateCondition(
  expression: string,
  context: Record<string, unknown>,
): boolean {
  // セキュリティのため、非常に限定的な評価のみ許可
  // 実際の実装では JSON Logic などを使用することを推奨

  // 単純な比較式のサポート: "value == 'string'" または "value > 0"
  const eqMatch = expression.match(/^(\w+(?:\.\w+)*)\s*(==|!=|>|<|>=|<=)\s*(.+)$/);
  if (eqMatch) {
    const [, path, operator, rawValue] = eqMatch;
    const leftValue = getValueByPath(context, path);

    // 右辺の値をパース
    let rightValue: unknown;
    const trimmedValue = rawValue.trim();
    if (trimmedValue.startsWith("'") || trimmedValue.startsWith('"')) {
      rightValue = trimmedValue.slice(1, -1);
    } else if (trimmedValue === "true") {
      rightValue = true;
    } else if (trimmedValue === "false") {
      rightValue = false;
    } else if (trimmedValue === "null") {
      rightValue = null;
    } else {
      rightValue = parseFloat(trimmedValue);
    }

    switch (operator) {
      case "==":
        return leftValue === rightValue;
      case "!=":
        return leftValue !== rightValue;
      case ">":
        return Number(leftValue) > Number(rightValue);
      case "<":
        return Number(leftValue) < Number(rightValue);
      case ">=":
        return Number(leftValue) >= Number(rightValue);
      case "<=":
        return Number(leftValue) <= Number(rightValue);
    }
  }

  // ブール値のパス参照
  const boolValue = getValueByPath(context, expression);
  return Boolean(boolValue);
}

/**
 * ワークフロー実行エンジン実装
 */
export class DefaultWorkflowEngine implements WorkflowEngine {
  private instances = new Map<string, WorkflowInstance>();
  private eventHandlers: WorkflowEventHandler[] = [];

  constructor(
    private readonly registry: WorkflowRegistry,
    private readonly aiRegistry: AiRegistry,
    private readonly providerRegistry: AiProviderRegistry,
  ) {}

  /**
   * イベントハンドラーを追加
   */
  addEventHandler(handler: WorkflowEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * イベントを発火
   */
  private async emitEvent(event: WorkflowEvent): Promise<void> {
    for (const handler of this.eventHandlers) {
      try {
        await handler(event);
      } catch (error) {
        console.error("[workflow-engine] Event handler error:", error);
      }
    }
  }

  /**
   * ワークフローを開始
   */
  async start(
    definitionId: string,
    input: Record<string, unknown>,
    context: Omit<WorkflowExecutionContext, "instance">,
  ): Promise<WorkflowInstance> {
    const definition = this.registry.getDefinition(definitionId);
    if (!definition) {
      throw new Error(`Workflow definition not found: ${definitionId}`);
    }

    const instanceId = generateId("wf");
    const now = new Date().toISOString();

    const instance: WorkflowInstance = {
      id: instanceId,
      definitionId,
      status: "pending",
      input,
      currentStepId: definition.entryPoint,
      stepResults: {},
      startedAt: now,
      initiator: {
        type: context.auth.userId ? "user" : "system",
        id: context.auth.userId ?? undefined,
      },
    };

    this.instances.set(instanceId, instance);

    await this.emitEvent({ type: "started", instanceId, definitionId });

    // 非同期で実行開始
    this.executeWorkflow(definition, instance, {
      ...context,
      instance,
    }).catch((error) => {
      console.error("[workflow-engine] Workflow execution error:", error);
    });

    return instance;
  }

  /**
   * ワークフローを再開
   */
  async resume(
    instanceId: string,
    approvalInput?: Record<string, unknown>,
  ): Promise<WorkflowInstance> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Workflow instance not found: ${instanceId}`);
    }

    if (instance.status !== "paused") {
      throw new Error(`Cannot resume workflow in status: ${instance.status}`);
    }

    const definition = this.registry.getDefinition(instance.definitionId);
    if (!definition) {
      throw new Error(`Workflow definition not found: ${instance.definitionId}`);
    }

    instance.status = "running";

    // 承認入力があれば現在のステップ結果に追加
    if (approvalInput && instance.currentStepId) {
      const currentResult = instance.stepResults[instance.currentStepId];
      if (currentResult) {
        currentResult.output = { ...currentResult.output as object, ...approvalInput };
      }
    }

    // 実行を継続（コンテキストは簡易的に再構築）
    // 実際の実装では、コンテキストを永続化・復元する必要がある

    return instance;
  }

  /**
   * ワークフローをキャンセル
   */
  async cancel(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Workflow instance not found: ${instanceId}`);
    }

    if (instance.status === "completed" || instance.status === "failed") {
      throw new Error(`Cannot cancel workflow in status: ${instance.status}`);
    }

    instance.status = "cancelled";
    instance.completedAt = new Date().toISOString();

    await this.emitEvent({ type: "cancelled", instanceId });
  }

  /**
   * 人間の承認を送信
   */
  async submitApproval(
    instanceId: string,
    stepId: string,
    approved: boolean,
    choice?: string,
  ): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Workflow instance not found: ${instanceId}`);
    }

    if (instance.status !== "paused") {
      throw new Error(`Workflow is not waiting for approval`);
    }

    if (instance.currentStepId !== stepId) {
      throw new Error(`Workflow is not waiting at step: ${stepId}`);
    }

    await this.resume(instanceId, { approved, choice });
  }

  /**
   * インスタンスを取得
   */
  async getInstance(instanceId: string): Promise<WorkflowInstance | null> {
    return this.instances.get(instanceId) ?? null;
  }

  /**
   * インスタンス一覧を取得
   */
  async listInstances(filters?: WorkflowInstanceFilters): Promise<WorkflowInstance[]> {
    let instances = Array.from(this.instances.values());

    if (filters) {
      if (filters.definitionId) {
        instances = instances.filter((i) => i.definitionId === filters.definitionId);
      }
      if (filters.status && filters.status.length > 0) {
        instances = instances.filter((i) => filters.status!.includes(i.status));
      }
      if (filters.initiatorType) {
        instances = instances.filter((i) => i.initiator.type === filters.initiatorType);
      }
      if (filters.initiatorId) {
        instances = instances.filter((i) => i.initiator.id === filters.initiatorId);
      }
      if (filters.startedAfter) {
        instances = instances.filter((i) => i.startedAt >= filters.startedAfter!);
      }
      if (filters.startedBefore) {
        instances = instances.filter((i) => i.startedAt <= filters.startedBefore!);
      }

      // ページネーション
      const offset = filters.offset ?? 0;
      const limit = filters.limit ?? 50;
      instances = instances.slice(offset, offset + limit);
    }

    return instances;
  }

  /**
   * ワークフローを実行
   */
  private async executeWorkflow(
    definition: WorkflowDefinition,
    instance: WorkflowInstance,
    context: WorkflowExecutionContext,
  ): Promise<void> {
    instance.status = "running";
    const stepMap = new Map(definition.steps.map((s) => [s.id, s]));

    try {
      let currentStepId: string | null = instance.currentStepId;

      while (currentStepId) {
        const step = stepMap.get(currentStepId);
        if (!step) {
          throw new WorkflowExecutionError(
            instance.id,
            currentStepId,
            "STEP_NOT_FOUND",
            `Step not found: ${currentStepId}`,
          );
        }

        instance.currentStepId = currentStepId;

        // ステップを実行
        const result = await this.executeStep(step, instance, context, definition);

        // 結果を保存
        instance.stepResults[step.id] = result;

        // 次のステップを決定
        if (result.status === "completed") {
          currentStepId = this.determineNextStep(step, result, instance);
        } else if (result.status === "failed") {
          // エラーハンドリング
          if (step.onError?.action === "skip") {
            currentStepId = typeof step.next === "string" ? step.next : null;
          } else if (step.onError?.action === "fallback" && step.onError.fallbackStep) {
            currentStepId = step.onError.fallbackStep;
          } else {
            throw new WorkflowExecutionError(
              instance.id,
              step.id,
              "STEP_FAILED",
              result.error || "Step execution failed",
            );
          }
        }

        // 一時停止チェック（人間の承認待ち）
        // Note: executeStep can mutate instance.status to "paused" via context
        if ((instance.status as WorkflowStatus) === "paused") {
          return;
        }
      }

      // ワークフロー完了
      instance.status = "completed";
      instance.completedAt = new Date().toISOString();
      instance.currentStepId = null;

      // 最終出力を設定
      const lastStepId = definition.steps[definition.steps.length - 1]?.id;
      if (lastStepId && instance.stepResults[lastStepId]) {
        instance.output = instance.stepResults[lastStepId].output as Record<string, unknown>;
      }

      await this.emitEvent({
        type: "completed",
        instanceId: instance.id,
        output: instance.output,
      });
    } catch (error) {
      instance.status = "failed";
      instance.completedAt = new Date().toISOString();

      const workflowError: WorkflowError = error instanceof WorkflowExecutionError
        ? {
            stepId: error.stepId,
            code: error.code,
            message: error.message,
            details: error.details,
          }
        : {
            stepId: instance.currentStepId || "unknown",
            code: "EXECUTION_ERROR",
            message: error instanceof Error ? error.message : String(error),
          };

      instance.error = workflowError;

      await this.emitEvent({
        type: "failed",
        instanceId: instance.id,
        error: workflowError,
      });
    }
  }

  /**
   * ステップを実行
   */
  private async executeStep(
    step: WorkflowStep,
    instance: WorkflowInstance,
    context: WorkflowExecutionContext,
    definition: WorkflowDefinition,
  ): Promise<WorkflowStepResult> {
    const now = new Date().toISOString();
    const result: WorkflowStepResult = {
      stepId: step.id,
      status: "running",
      startedAt: now,
      attempts: 0,
    };

    await this.emitEvent({ type: "step_started", instanceId: instance.id, stepId: step.id });

    const maxAttempts = step.retry?.maxAttempts ?? 1;
    const retryDelay = step.retry?.delayMs ?? 1000;
    const backoffMultiplier = step.retry?.backoffMultiplier ?? 2;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      result.attempts = attempt + 1;

      if (attempt > 0) {
        const delay = retryDelay * Math.pow(backoffMultiplier, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      try {
        // 入力を解決
        const resolvedInput = resolveInputMapping(
          step.inputMapping,
          instance.stepResults,
          instance.input,
        );

        // ステップタイプに応じた実行
        const output = await this.executeStepByType(step, resolvedInput, context);

        result.status = "completed";
        result.output = output;
        result.completedAt = new Date().toISOString();

        await this.emitEvent({
          type: "step_completed",
          instanceId: instance.id,
          stepId: step.id,
          output,
        });

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        context.log("warn", `Step ${step.id} attempt ${attempt + 1} failed: ${lastError.message}`);
      }
    }

    // 全リトライ失敗
    result.status = "failed";
    result.error = lastError?.message || "Unknown error";
    result.completedAt = new Date().toISOString();

    await this.emitEvent({
      type: "step_failed",
      instanceId: instance.id,
      stepId: step.id,
      error: result.error,
    });

    return result;
  }

  /**
   * ステップタイプに応じた実行
   */
  private async executeStepByType(
    step: WorkflowStep,
    input: Record<string, unknown>,
    context: WorkflowExecutionContext,
  ): Promise<unknown> {
    switch (step.type) {
      case "ai_action":
        return this.executeAiActionStep(step, input, context);

      case "tool_call":
        return this.executeToolCallStep(step, input, context);

      case "condition":
        return this.executeConditionStep(step, input, context);

      case "transform":
        return this.executeTransformStep(step, input, context);

      case "human_approval":
        return this.executeHumanApprovalStep(step, input, context);

      case "parallel":
        return this.executeParallelStep(step, input, context);

      case "loop":
        return this.executeLoopStep(step, input, context);

      default:
        throw new Error(`Unknown step type: ${step.type}`);
    }
  }

  /**
   * AI アクションステップを実行
   */
  private async executeAiActionStep(
    step: WorkflowStep,
    input: Record<string, unknown>,
    context: WorkflowExecutionContext,
  ): Promise<unknown> {
    const config = step.config as { type: "ai_action"; actionId: string; input: Record<string, unknown>; providerId?: string };

    const action = this.aiRegistry.getAction(config.actionId);
    if (!action) {
      throw new Error(`AI action not found: ${config.actionId}`);
    }

    // 入力をマージ
    const mergedInput = { ...config.input, ...input };

    // AI アクションを実行
    const actionContext = {
      nodeConfig: context.nodeConfig,
      auth: context.auth,
      env: context.env,
      providers: this.providerRegistry,
    };

    return await action.handler(actionContext, mergedInput);
  }

  /**
   * ツール呼び出しステップを実行
   */
  private async executeToolCallStep(
    step: WorkflowStep,
    input: Record<string, unknown>,
    context: WorkflowExecutionContext,
  ): Promise<unknown> {
    const config = step.config as { type: "tool_call"; toolName: string; input: Record<string, unknown> };

    // ツール呼び出しの実装
    // 実際の実装では、agent-tools-impl.ts の関数を呼び出す
    context.log("info", `Executing tool: ${config.toolName}`, { input: { ...config.input, ...input } });

    // プレースホルダー実装
    return { toolName: config.toolName, executed: true, input: { ...config.input, ...input } };
  }

  /**
   * 条件分岐ステップを実行
   */
  private async executeConditionStep(
    step: WorkflowStep,
    input: Record<string, unknown>,
    context: WorkflowExecutionContext,
  ): Promise<unknown> {
    const config = step.config as { type: "condition"; expression: string; branches: Array<{ condition: string; nextStep: string }> };

    const evalContext = { ...input, ...context.instance.stepResults };

    for (const branch of config.branches) {
      if (evaluateCondition(branch.condition, evalContext)) {
        return { selectedBranch: branch.nextStep };
      }
    }

    return { selectedBranch: null };
  }

  /**
   * データ変換ステップを実行
   */
  private async executeTransformStep(
    step: WorkflowStep,
    input: Record<string, unknown>,
    _context: WorkflowExecutionContext,
  ): Promise<unknown> {
    const config = step.config as { type: "transform"; expression: string };

    // シンプルなパス参照変換
    // 実際の実装では、より安全な変換エンジンを使用
    if (config.expression.startsWith("$.")) {
      const path = config.expression.slice(2);
      return getValueByPath(input, path);
    }

    return input;
  }

  /**
   * 人間の承認待ちステップを実行
   */
  private async executeHumanApprovalStep(
    step: WorkflowStep,
    input: Record<string, unknown>,
    context: WorkflowExecutionContext,
  ): Promise<unknown> {
    const config = step.config as { type: "human_approval"; message: string; approvalType: string; choices?: string[] };

    // ワークフローを一時停止
    context.instance.status = "paused";

    await this.emitEvent({
      type: "approval_required",
      instanceId: context.instance.id,
      stepId: step.id,
      message: config.message,
    });

    // 承認待ちの情報を返す
    return {
      waitingForApproval: true,
      message: config.message,
      approvalType: config.approvalType,
      choices: config.choices,
    };
  }

  /**
   * 並列実行ステップを実行
   */
  private async executeParallelStep(
    step: WorkflowStep,
    input: Record<string, unknown>,
    context: WorkflowExecutionContext,
  ): Promise<unknown> {
    const config = step.config as { type: "parallel"; branches: WorkflowStep[][]; waitFor: "all" | "any" | "none" };

    // 各ブランチを並列実行
    const promises = config.branches.map(async (branch) => {
      const results: unknown[] = [];
      for (const branchStep of branch) {
        const result = await this.executeStepByType(branchStep, input, context);
        results.push(result);
      }
      return results;
    });

    if (config.waitFor === "all") {
      const allResults = await Promise.all(promises);
      return { branches: allResults };
    } else if (config.waitFor === "any") {
      const firstResult = await Promise.race(promises);
      return { firstCompleted: firstResult };
    } else {
      // none: 投げっぱなし
      Promise.all(promises).catch((err) => {
        context.log("error", "Parallel branch error", { error: err });
      });
      return { scheduled: true };
    }
  }

  /**
   * ループステップを実行
   */
  private async executeLoopStep(
    step: WorkflowStep,
    input: Record<string, unknown>,
    context: WorkflowExecutionContext,
  ): Promise<unknown> {
    const config = step.config as { type: "loop"; maxIterations: number; condition: string; body: WorkflowStep[] };

    const results: unknown[] = [];
    let iteration = 0;

    while (iteration < config.maxIterations) {
      // 条件チェック
      const evalContext = { ...input, iteration, results };
      if (!evaluateCondition(config.condition, evalContext)) {
        break;
      }

      // ボディを実行
      const iterationInput = { ...input, iteration };
      for (const bodyStep of config.body) {
        const result = await this.executeStepByType(bodyStep, iterationInput, context);
        results.push(result);
      }

      iteration++;
    }

    return { iterations: iteration, results };
  }

  /**
   * 次のステップを決定
   */
  private determineNextStep(
    step: WorkflowStep,
    result: WorkflowStepResult,
    instance: WorkflowInstance,
  ): string | null {
    if (!step.next) {
      return null;
    }

    if (typeof step.next === "string") {
      return step.next;
    }

    // 条件分岐の場合
    if (step.type === "condition" && result.output) {
      const output = result.output as { selectedBranch?: string };
      return output.selectedBranch ?? null;
    }

    // 分岐配列の場合、条件を評価
    const evalContext = {
      ...instance.input,
      ...instance.stepResults,
      currentOutput: result.output,
    };

    for (const branch of step.next) {
      if (evaluateCondition(branch.condition, evalContext)) {
        return branch.nextStep;
      }
    }

    return null;
  }
}

/**
 * ワークフローエンジンを作成
 */
export function createWorkflowEngine(
  registry: WorkflowRegistry,
  aiRegistry: AiRegistry,
  providerRegistry: AiProviderRegistry,
): WorkflowEngine & { addEventHandler: (handler: WorkflowEventHandler) => void } {
  return new DefaultWorkflowEngine(registry, aiRegistry, providerRegistry);
}
