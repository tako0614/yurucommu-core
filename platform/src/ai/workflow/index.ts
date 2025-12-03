/**
 * AI Workflow Module
 *
 * マルチステップAIワークフロー（LangChain/LangGraph相当）のエクスポート
 */

// Types
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
} from "./types";

// Registry
export {
  createWorkflowRegistry,
  workflowRegistry,
  WorkflowValidationError,
} from "./registry";

// Engine
export {
  createWorkflowEngine,
  DefaultWorkflowEngine,
  WorkflowExecutionError,
} from "./engine";

// Built-in workflows
export {
  builtinWorkflows,
  registerBuiltinWorkflows,
  contentModerationWorkflow,
  postEnhancementWorkflow,
  translationChainWorkflow,
  dmSafetyCheckWorkflow,
  communityDigestWorkflow,
} from "./builtin-workflows";

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
} from "./action-generator";

export type {
  GeneratedActionMetadata,
  ActionGeneratorOptions,
  ActionGeneratorResult,
} from "./action-generator";
