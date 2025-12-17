/**
 * AI Workflow Types for App Layer
 *
 * Re-export types from platform for App layer usage.
 * Types remain in platform as they are shared type definitions.
 */

// Re-export all types from platform
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
} from "@takos/platform/server";
