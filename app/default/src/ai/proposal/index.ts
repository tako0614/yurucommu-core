/**
 * Proposal Queue for App Layer
 *
 * App layer implementation for AI proposal management.
 * Provides REST API endpoints and KV-based storage for proposals.
 */

// Re-export types from platform
export type {
  ProposalType,
  ProposalStatus,
  ProposalMetadata,
  ConfigChangeProposal,
  CodePatchProposal,
  ActionEnableProposal,
  ActionDisableProposal,
  ProposalContent,
  Proposal,
  ProposalQueueStats,
  ListProposalsParams,
  ProposalQueueStorage,
  ProposalQueue,
} from "@takos/platform/ai/proposal-queue";

// Re-export implementations from platform
export {
  D1ProposalQueueStorage,
  InMemoryProposalQueueStorage,
  createProposalQueue,
} from "@takos/platform/ai/proposal-queue";

export { default as proposalRouter } from "./routes.js";
export { createKvProposalQueueStorage, type KvProposalQueueStorageOptions } from "./kv-storage.js";
