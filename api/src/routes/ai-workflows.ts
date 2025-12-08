/**
 * AI Workflows API Routes
 *
 * PLAN.md 6.4 に基づくワークフロー管理API
 */

import { Hono } from "hono";
import type { PublicAccountBindings as Bindings, Variables } from "@takos/platform/server";
import { auth } from "../middleware/auth";
import {
  workflowRegistry,
  createWorkflowEngine,
  registerBuiltinWorkflows,
  type WorkflowDefinition,
  type WorkflowInstanceFilters,
  aiActionRegistry,
  type AiProviderRegistry,
} from "@takos/platform/server";
import { requireAiQuota } from "../lib/plan-guard";
import type { AuthContext } from "../lib/auth-context-model";

// 組み込みワークフローを登録
registerBuiltinWorkflows(workflowRegistry);

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
const planGuardError = (c: any) => {
  const check = requireAiQuota((c.get("authContext") as AuthContext | undefined) ?? null);
  if (!check.ok) {
    return c.json(
      { error: check.message, code: check.code, details: check.details ?? undefined },
      check.status,
    );
  }
  return null;
};

/**
 * ワークフロー定義一覧を取得
 * GET /ai/workflows
 */
app.get("/", async (c) => {
  const definitions = workflowRegistry.listDefinitions();

  return c.json({
    workflows: definitions.map((def) => ({
      id: def.id,
      name: def.name,
      description: def.description,
      version: def.version,
      entryPoint: def.entryPoint,
      stepCount: def.steps.length,
      dataPolicy: def.dataPolicy,
      metadata: def.metadata,
    })),
    total: definitions.length,
  });
});

/**
 * ワークフロー定義の詳細を取得
 * GET /ai/workflows/:id
 */
app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const definition = workflowRegistry.getDefinition(id);

  if (!definition) {
    return c.json({ error: "Workflow not found", code: "NOT_FOUND" }, 404);
  }

  return c.json({
    workflow: definition,
  });
});

/**
 * カスタムワークフローを登録
 * POST /ai/workflows
 */
app.post("/", auth, async (c) => {
  const planError = planGuardError(c);
  if (planError) return planError;
  const body = await c.req.json<WorkflowDefinition>();

  if (!body.id || !body.name || !body.steps || !body.entryPoint) {
    return c.json(
      {
        error: "Invalid workflow definition",
        code: "INVALID_INPUT",
        required: ["id", "name", "steps", "entryPoint"],
      },
      400,
    );
  }

  // カスタムワークフローIDの接頭辞チェック
  if (!body.id.startsWith("custom.")) {
    return c.json(
      {
        error: "Custom workflow ID must start with 'custom.'",
        code: "INVALID_ID",
      },
      400,
    );
  }

  try {
    workflowRegistry.register(body);
    return c.json({ success: true, id: body.id }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Registration failed";
    return c.json({ error: message, code: "REGISTRATION_FAILED" }, 400);
  }
});

/**
 * ワークフローを削除
 * DELETE /ai/workflows/:id
 */
app.delete("/:id", auth, async (c) => {
  const id = c.req.param("id");
  const planError = planGuardError(c);
  if (planError) return planError;

  // 組み込みワークフローは削除不可
  if (id.startsWith("workflow.")) {
    return c.json(
      {
        error: "Cannot delete built-in workflows",
        code: "FORBIDDEN",
      },
      403,
    );
  }

  const deleted = workflowRegistry.unregister(id);

  if (!deleted) {
    return c.json({ error: "Workflow not found", code: "NOT_FOUND" }, 404);
  }

  return c.json({ success: true, id });
});

/**
 * ワークフローを実行
 * POST /ai/workflows/:id/run
 */
app.post("/:id/run", auth, async (c) => {
  const id = c.req.param("id");
  const planError = planGuardError(c);
  if (planError) return planError;
  const body = await c.req.json<{ input?: Record<string, unknown> }>();

  const definition = workflowRegistry.getDefinition(id);
  if (!definition) {
    return c.json({ error: "Workflow not found", code: "NOT_FOUND" }, 404);
  }

  // AI設定を取得
  const env = c.env;
  const providers = (env as any).AI_PROVIDERS as AiProviderRegistry | undefined;

  if (!providers) {
    return c.json(
      {
        error: "AI providers not configured",
        code: "AI_NOT_CONFIGURED",
      },
      503,
    );
  }

  // ワークフローエンジンを作成
  const engine = createWorkflowEngine(workflowRegistry, aiActionRegistry, providers);

  try {
    const instance = await engine.start(id, body.input || {}, {
      nodeConfig: {
        schema_version: "1.0",
        distro: { name: "takos", version: "0.1.0" },
        node: { url: `https://${env.INSTANCE_DOMAIN || "localhost"}` },
        ai: {
          enabled: true,
          enabled_actions: ["ai.summary", "ai.tag-suggest", "ai.translation", "ai.dm-moderator"],
        },
      },
      provider: providers.require(),
      dataPolicy: providers.getDataPolicy(),
      auth: {
        userId: (c as any).get?.("userId") || null,
        sessionId: (c as any).get?.("sessionId") || null,
        isAuthenticated: true,
      },
      env: env as unknown as Record<string, string | undefined>,
      log: (level, message, data) => {
        console[level](`[workflow:${id}]`, message, data);
      },
    });

    return c.json({
      instance: {
        id: instance.id,
        definitionId: instance.definitionId,
        status: instance.status,
        startedAt: instance.startedAt,
        currentStepId: instance.currentStepId,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workflow execution failed";
    return c.json({ error: message, code: "EXECUTION_FAILED" }, 500);
  }
});

/**
 * ワークフローインスタンスの状態を取得
 * GET /ai/workflows/instances/:instanceId
 */
app.get("/instances/:instanceId", auth, async (c) => {
  const instanceId = c.req.param("instanceId");
  const planError = planGuardError(c);
  if (planError) return planError;

  // Note: 実際の実装では、永続化されたインスタンスストアから取得
  // 現在はインメモリエンジンを使用しているため、簡易実装

  return c.json({
    error: "Instance store not implemented",
    code: "NOT_IMPLEMENTED",
    message: "Workflow instance persistence is pending implementation",
  }, 501);
});

/**
 * ワークフローインスタンス一覧を取得
 * GET /ai/workflows/instances
 */
app.get("/instances", auth, async (c) => {
  const planError = planGuardError(c);
  if (planError) return planError;
  const filters: WorkflowInstanceFilters = {
    definitionId: c.req.query("definitionId") || undefined,
    status: c.req.query("status")?.split(",") as any,
    limit: parseInt(c.req.query("limit") || "50", 10),
    offset: parseInt(c.req.query("offset") || "0", 10),
  };

  // Note: 実際の実装では、永続化されたインスタンスストアから取得
  return c.json({
    instances: [],
    total: 0,
    filters,
  });
});

/**
 * 人間の承認を送信
 * POST /ai/workflows/instances/:instanceId/approve
 */
app.post("/instances/:instanceId/approve", auth, async (c) => {
  const instanceId = c.req.param("instanceId");
  const planError = planGuardError(c);
  if (planError) return planError;
  const body = await c.req.json<{
    stepId: string;
    approved: boolean;
    choice?: string;
  }>();

  if (!body.stepId || typeof body.approved !== "boolean") {
    return c.json(
      {
        error: "Invalid approval request",
        code: "INVALID_INPUT",
        required: ["stepId", "approved"],
      },
      400,
    );
  }

  // Note: 実際の実装では、エンジンインスタンスを取得してsubmitApprovalを呼び出す
  return c.json({
    error: "Instance store not implemented",
    code: "NOT_IMPLEMENTED",
  }, 501);
});

/**
 * ワークフローインスタンスをキャンセル
 * POST /ai/workflows/instances/:instanceId/cancel
 */
app.post("/instances/:instanceId/cancel", auth, async (c) => {
  const instanceId = c.req.param("instanceId");
  const planError = planGuardError(c);
  if (planError) return planError;

  // Note: 実際の実装では、エンジンインスタンスを取得してcancelを呼び出す
  return c.json({
    error: "Instance store not implemented",
    code: "NOT_IMPLEMENTED",
  }, 501);
});

export default app;
