/**
 * AI Workflow Module for App Layer
 *
 * Multi-step AI workflow (LangChain/LangGraph equivalent) exports
 */

// Types (re-exported from platform)
export type {
  WorkflowStatus,
  WorkflowStepType,
  WorkflowStep,
  WorkflowStepConfig,
  AiActionStepConfig,
  ToolCallStepConfig,
  ConditionStepConfig,
  LoopStepConfig,
  ParallelStepConfig,
  HumanApprovalStepConfig,
  TransformStepConfig,
  WorkflowBranch,
  WorkflowDataRef,
  WorkflowErrorHandler,
  WorkflowRetryConfig,
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowStepResult,
  WorkflowError,
  WorkflowExecutionContext,
  WorkflowRegistry,
  WorkflowEngine,
  WorkflowInstanceFilters,
  BuiltinWorkflowId,
  WorkflowEvent,
  WorkflowEventHandler,
} from "./types.js";

// Registry
export {
  createWorkflowRegistry,
  appWorkflowRegistry,
  WorkflowValidationError,
} from "./registry.js";

// Engine
export {
  createWorkflowEngine,
  DefaultWorkflowEngine,
  WorkflowExecutionError,
} from "./engine.js";

// Built-in workflows
export {
  builtinWorkflows,
  registerBuiltinWorkflows,
  contentModerationWorkflow,
  postEnhancementWorkflow,
  translationChainWorkflow,
  dmSafetyCheckWorkflow,
  communityDigestWorkflow,
} from "./builtin-workflows.js";

// Action Generator
export {
  WorkflowActionGenerator,
  createActionGenerator,
  registerGeneratedAction,
  registerWorkflowsAsActions,
  inferInputSchema,
  inferOutputSchema,
  inferDataPolicy,
  mergeDataPolicies,
} from "./action-generator.js";

export type {
  GeneratedActionMetadata,
  ActionGeneratorOptions,
  ActionGeneratorResult,
} from "./action-generator.js";
