/**
 * AI Proposal Queue Routes
 *
 * PLAN.md 6.4.3 に基づく手動承認フローのAPI
 * AI からの設定変更・コード変更提案を管理
 */

import { Hono } from "hono";
import type {
  PublicAccountBindings as Bindings,
  Variables,
} from "@takos/platform/server";
import { ok, fail } from "@takos/platform/server";
import { auth } from "../middleware/auth";
import {
  createProposalQueue,
  D1ProposalQueueStorage,
  type ProposalQueue,
  type ProposalStatus,
  type ProposalType,
} from "@takos/platform/ai/proposal-queue";
import { executeProposal } from "../lib/proposal-executor";
import { requireAiQuota } from "../lib/plan-guard";
import type { AuthContext } from "../lib/auth-context-model";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
const planGuardError = (c: any) => {
  const check = requireAiQuota((c.get("authContext") as AuthContext | undefined) ?? null);
  if (!check.ok) {
    return fail(c, check.message, check.status);
  }
  return null;
};

/**
 * リクエストごとに D1 ベースの ProposalQueue を取得
 */
function getProposalQueue(db: D1Database): ProposalQueue {
  const storage = new D1ProposalQueueStorage(db);
  return createProposalQueue(storage);
}

/**
 * GET /ai/proposals
 * 提案一覧を取得
 */
app.get("/", auth, async (c) => {
  const planError = planGuardError(c);
  if (planError) return planError;
  try {
    const db = c.env.DB;
    if (!db) {
      return fail(c, "Database not available", 500);
    }

    const proposalQueue = getProposalQueue(db);
    const status = c.req.query("status") as ProposalStatus | undefined;
    const type = c.req.query("type") as ProposalType | undefined;
    const agentType = c.req.query("agentType") as "user" | "system" | "dev" | undefined;
    const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!, 10) : 50;
    const offset = c.req.query("offset") ? parseInt(c.req.query("offset")!, 10) : 0;

    const proposals = await proposalQueue.list({
      status,
      type,
      agentType,
      limit,
      offset,
      orderBy: "createdAt",
      desc: true,
    });

    const stats = await proposalQueue.getStats();

    return ok(c, { proposals, stats });
  } catch (err) {
    console.error("Failed to list proposals:", err);
    return fail(c, "Failed to list proposals", 500);
  }
});

/**
 * GET /ai/proposals/stats
 * 提案統計を取得
 */
app.get("/stats", auth, async (c) => {
  const planError = planGuardError(c);
  if (planError) return planError;
  try {
    const db = c.env.DB;
    if (!db) {
      return fail(c, "Database not available", 500);
    }

    const proposalQueue = getProposalQueue(db);
    const stats = await proposalQueue.getStats();
    return ok(c, stats);
  } catch (err) {
    console.error("Failed to get proposal stats:", err);
    return fail(c, "Failed to get proposal stats", 500);
  }
});

/**
 * GET /ai/proposals/:id
 * 特定の提案を取得
 */
app.get("/:id", auth, async (c) => {
  const planError = planGuardError(c);
  if (planError) return planError;
  try {
    const db = c.env.DB;
    if (!db) {
      return fail(c, "Database not available", 500);
    }

    const proposalQueue = getProposalQueue(db);
    const id = c.req.param("id");
    const proposal = await proposalQueue.get(id);

    if (!proposal) {
      return fail(c, "Proposal not found", 404);
    }

    return ok(c, proposal);
  } catch (err) {
    console.error("Failed to get proposal:", err);
    return fail(c, "Failed to get proposal", 500);
  }
});

/**
 * POST /ai/proposals/:id/approve
 * 提案を承認し、変更を適用
 */
app.post("/:id/approve", auth, async (c) => {
  const planError = planGuardError(c);
  if (planError) return planError;
  try {
    const db = c.env.DB;
    if (!db) {
      return fail(c, "Database not available", 500);
    }

    const id = c.req.param("id");
    const user = c.get("user") as { id: string } | undefined;
    if (!user?.id) {
      return fail(c, "Authentication required", 401);
    }

    const body = await c.req.json().catch(() => ({}));
    const comment = (body as { comment?: string }).comment;

    const proposalQueue = getProposalQueue(db);
    const proposal = await proposalQueue.approve(id, user.id, comment);

    // 承認された提案を実行
    const executionResult = await executeProposal(db, proposal);

    if (!executionResult.success) {
      // 実行に失敗した場合、エラーを返すが提案自体は承認済みのまま
      console.error("Proposal execution failed:", executionResult.message);
      return ok(c, {
        proposal,
        applied: false,
        executionError: executionResult.message,
        executionDetails: executionResult.details,
      });
    }

    return ok(c, {
      proposal,
      applied: true,
      executionMessage: executionResult.message,
      executionDetails: executionResult.details,
    });
  } catch (err) {
    console.error("Failed to approve proposal:", err);
    const message = err instanceof Error ? err.message : "Failed to approve proposal";
    return fail(c, message, 400);
  }
});

/**
 * POST /ai/proposals/:id/reject
 * 提案を拒否
 */
app.post("/:id/reject", auth, async (c) => {
  const planError = planGuardError(c);
  if (planError) return planError;
  try {
    const db = c.env.DB;
    if (!db) {
      return fail(c, "Database not available", 500);
    }

    const id = c.req.param("id");
    const user = c.get("user") as { id: string } | undefined;
    if (!user?.id) {
      return fail(c, "Authentication required", 401);
    }

    const body = await c.req.json().catch(() => ({}));
    const comment = (body as { comment?: string }).comment;

    const proposalQueue = getProposalQueue(db);
    const proposal = await proposalQueue.reject(id, user.id, comment);

    return ok(c, { proposal });
  } catch (err) {
    console.error("Failed to reject proposal:", err);
    const message = err instanceof Error ? err.message : "Failed to reject proposal";
    return fail(c, message, 400);
  }
});

/**
 * POST /ai/proposals/expire
 * 期限切れの提案を処理
 */
app.post("/expire", auth, async (c) => {
  const planError = planGuardError(c);
  if (planError) return planError;
  try {
    const db = c.env.DB;
    if (!db) {
      return fail(c, "Database not available", 500);
    }

    const proposalQueue = getProposalQueue(db);
    const count = await proposalQueue.expireOld();
    return ok(c, { expired: count });
  } catch (err) {
    console.error("Failed to expire proposals:", err);
    return fail(c, "Failed to expire proposals", 500);
  }
});

export default app;
