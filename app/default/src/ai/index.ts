/**
 * AI module for Default App
 *
 * This module contains App-layer AI actions that use Core's AI Provider connection layer.
 * The Core layer provides:
 * - Provider Registry (registration and management)
 * - Provider Adapters (OpenAI-compatible API)
 * - Rate limiting
 * - Audit logging
 * - Data policy enforcement
 *
 * This App layer provides:
 * - Specific AI actions (chat, summary, tag-suggest, translation, dm-moderator)
 * - Action handlers with business logic
 * - REST API endpoints
 * - Workflow Engine (multi-step AI workflows, LangChain/LangGraph equivalent)
 * - Built-in workflow templates
 * - Workflow-to-Action generator
 * - Agent Tools wrapper (LangChain integration)
 * - Proposal Queue (human-in-the-loop approval flow)
 */

export {
  builtinAiActions,
  registerBuiltinAiActions,
  getBuiltinActionDefinitions,
  getDefaultProviderId,
  CHAT_ACTION_ID,
  SUMMARY_ACTION_ID,
  TAG_SUGGEST_ACTION_ID,
  TRANSLATION_ACTION_ID,
  DM_MODERATOR_ACTION_ID,
} from "./actions.js";

export { default as aiRouter } from "./routes.js";

// Workflow module (App layer implementation)
export * from "./workflow/index.js";

// Agent Tools (App layer wrapper)
export {
  createAppAgentTools,
  getLangChainToolDefinitions,
  getToolFunction,
  type AppAgentToolsOptions,
  type LangChainToolDefinition,
} from "./agent-tools.js";

// Re-export commonly used types from agent-tools
export type {
  ToolContext,
  AgentTools,
} from "./agent-tools.js";

// Proposal module (App layer implementation)
export {
  proposalRouter,
  createKvProposalQueueStorage,
  type KvProposalQueueStorageOptions,
} from "./proposal/index.js";

// Re-export commonly used proposal types
export type {
  Proposal,
  ProposalType,
  ProposalStatus,
  ProposalContent,
  ProposalQueue,
} from "./proposal/index.js";
