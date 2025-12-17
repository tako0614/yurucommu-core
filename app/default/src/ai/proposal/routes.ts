/**
 * Proposal Routes for App Layer
 *
 * REST API endpoints for AI proposal management.
 */

import { Hono } from "hono";
import type { AppEnv } from "@takos/app-sdk/server";
import { json, error } from "@takos/app-sdk/server";
import type {
  ProposalContent,
  ProposalMetadata,
  ListProposalsParams,
  ProposalStatus,
  ProposalType,
} from "@takos/platform/ai/proposal-queue";
import {
  createProposalQueue,
  D1ProposalQueueStorage,
  InMemoryProposalQueueStorage,
} from "@takos/platform/ai/proposal-queue";
import { createKvProposalQueueStorage } from "./kv-storage.js";

const proposalRouter = new Hono<{ Bindings: AppEnv }>();

/**
 * Get or create proposal queue from environment
 */
const getProposalQueue = (env: AppEnv) => {
  // Prefer KV storage for App layer
  const kv = (env as any).APP_STATE ?? (env as any).KV;
  if (kv) {
    const storage = createKvProposalQueueStorage({ kv, prefix: "proposals:" });
    return createProposalQueue(storage);
  }

  // Fall back to D1 if available
  const db = (env as any).DB;
  if (db) {
    const storage = new D1ProposalQueueStorage(db);
    return createProposalQueue(storage);
  }

  // Development fallback: in-memory
  console.warn("[proposal-routes] No storage available, using in-memory storage");
  const storage = new InMemoryProposalQueueStorage();
  return createProposalQueue(storage);
};

/**
 * List proposals
 * GET /ai/proposals
 */
proposalRouter.get("/ai/proposals", async (c) => {
  if (!c.env.auth) {
    return error("Unauthorized", 401);
  }

  const queue = getProposalQueue(c.env);

  // Parse query parameters
  const url = new URL(c.req.url);
  const status = url.searchParams.get("status") as ProposalStatus | null;
  const type = url.searchParams.get("type") as ProposalType | null;
  const agentType = url.searchParams.get("agentType") as "user" | "system" | "dev" | null;
  const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
  const orderBy = url.searchParams.get("orderBy") as "createdAt" | "updatedAt" | null;
  const desc = url.searchParams.get("desc") === "true";

  const params: ListProposalsParams = {
    limit: Math.min(limit, 100),
    offset: Math.max(offset, 0),
    desc,
  };

  if (status) params.status = status;
  if (type) params.type = type;
  if (agentType) params.agentType = agentType;
  if (orderBy) params.orderBy = orderBy;

  try {
    const proposals = await queue.list(params);
    const stats = await queue.getStats();

    return json({
      proposals,
      stats,
      pagination: {
        limit: params.limit,
        offset: params.offset,
        hasMore: proposals.length === params.limit,
      },
    });
  } catch (err) {
    console.error("[proposal-routes] list error:", err);
    return error("Failed to list proposals", 500);
  }
});

/**
 * Get a single proposal
 * GET /ai/proposals/:id
 */
proposalRouter.get("/ai/proposals/:id", async (c) => {
  if (!c.env.auth) {
    return error("Unauthorized", 401);
  }

  const queue = getProposalQueue(c.env);
  const id = c.req.param("id");

  try {
    const proposal = await queue.get(id);
    if (!proposal) {
      return error("Proposal not found", 404);
    }
    return json({ proposal });
  } catch (err) {
    console.error("[proposal-routes] get error:", err);
    return error("Failed to get proposal", 500);
  }
});

/**
 * Create a new proposal
 * POST /ai/proposals
 */
proposalRouter.post("/ai/proposals", async (c) => {
  if (!c.env.auth) {
    return error("Unauthorized", 401);
  }

  const queue = getProposalQueue(c.env);

  let body: { content: ProposalContent; metadata?: Partial<ProposalMetadata> };
  try {
    body = await c.req.json();
  } catch {
    return error("Invalid JSON body", 400);
  }

  if (!body.content || !body.content.type) {
    return error("content and content.type are required", 400);
  }

  // Build metadata
  const metadata: ProposalMetadata = {
    agentType: body.metadata?.agentType ?? "user",
    reason: body.metadata?.reason,
    conversationId: body.metadata?.conversationId,
    context: body.metadata?.context,
  };

  try {
    const proposal = await queue.create(body.content, metadata);
    return json({ proposal }, 201);
  } catch (err) {
    console.error("[proposal-routes] create error:", err);
    return error("Failed to create proposal", 500);
  }
});

/**
 * Approve a proposal
 * POST /ai/proposals/:id/approve
 */
proposalRouter.post("/ai/proposals/:id/approve", async (c) => {
  if (!c.env.auth) {
    return error("Unauthorized", 401);
  }

  const queue = getProposalQueue(c.env);
  const id = c.req.param("id");
  const reviewerId = c.env.auth.userId;

  let body: { comment?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    // Optional body
  }

  try {
    const proposal = await queue.approve(id, reviewerId, body.comment);

    // TODO: Execute the proposal after approval
    // This would call the proposal executor to apply the changes

    return json({
      proposal,
      message: "Proposal approved",
    });
  } catch (err: any) {
    if (err.message?.includes("not found")) {
      return error("Proposal not found", 404);
    }
    if (err.message?.includes("not pending")) {
      return error("Proposal is not in pending status", 400);
    }
    console.error("[proposal-routes] approve error:", err);
    return error("Failed to approve proposal", 500);
  }
});

/**
 * Reject a proposal
 * POST /ai/proposals/:id/reject
 */
proposalRouter.post("/ai/proposals/:id/reject", async (c) => {
  if (!c.env.auth) {
    return error("Unauthorized", 401);
  }

  const queue = getProposalQueue(c.env);
  const id = c.req.param("id");
  const reviewerId = c.env.auth.userId;

  let body: { comment?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    // Optional body
  }

  try {
    const proposal = await queue.reject(id, reviewerId, body.comment);
    return json({
      proposal,
      message: "Proposal rejected",
    });
  } catch (err: any) {
    if (err.message?.includes("not found")) {
      return error("Proposal not found", 404);
    }
    if (err.message?.includes("not pending")) {
      return error("Proposal is not in pending status", 400);
    }
    console.error("[proposal-routes] reject error:", err);
    return error("Failed to reject proposal", 500);
  }
});

/**
 * Delete a proposal
 * DELETE /ai/proposals/:id
 */
proposalRouter.delete("/ai/proposals/:id", async (c) => {
  if (!c.env.auth) {
    return error("Unauthorized", 401);
  }

  const queue = getProposalQueue(c.env);
  const id = c.req.param("id");

  // Verify proposal exists
  const existing = await queue.get(id);
  if (!existing) {
    return error("Proposal not found", 404);
  }

  // Only allow deletion of rejected/expired proposals, or by the creator
  // For now, just check auth
  try {
    // Using storage directly since ProposalQueue doesn't have delete
    const kv = (c.env as any).APP_STATE ?? (c.env as any).KV;
    if (kv) {
      const storage = createKvProposalQueueStorage({ kv, prefix: "proposals:" });
      await storage.delete(id);
    } else {
      const db = (c.env as any).DB;
      if (db) {
        const storage = new D1ProposalQueueStorage(db);
        await storage.delete(id);
      }
    }
    return json({ message: "Proposal deleted" });
  } catch (err) {
    console.error("[proposal-routes] delete error:", err);
    return error("Failed to delete proposal", 500);
  }
});

/**
 * Get proposal statistics
 * GET /ai/proposals/stats
 */
proposalRouter.get("/ai/proposals/stats", async (c) => {
  if (!c.env.auth) {
    return error("Unauthorized", 401);
  }

  const queue = getProposalQueue(c.env);

  try {
    const stats = await queue.getStats();
    return json({ stats });
  } catch (err) {
    console.error("[proposal-routes] stats error:", err);
    return error("Failed to get stats", 500);
  }
});

/**
 * Expire old proposals (maintenance endpoint)
 * POST /ai/proposals/expire
 */
proposalRouter.post("/ai/proposals/expire", async (c) => {
  // This could be called from a scheduled worker
  // For now, require auth but in production might want admin-only

  const queue = getProposalQueue(c.env);

  try {
    const count = await queue.expireOld();
    return json({
      message: `Expired ${count} proposals`,
      count,
    });
  } catch (err) {
    console.error("[proposal-routes] expire error:", err);
    return error("Failed to expire proposals", 500);
  }
});

export default proposalRouter;
