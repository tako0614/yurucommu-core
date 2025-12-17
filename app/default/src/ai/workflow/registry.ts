/**
 * AI Workflow Registry for App Layer
 *
 * Workflow definition registration and management
 */

import type {
  WorkflowDefinition,
  WorkflowRegistry,
  WorkflowStep,
} from "./types.js";

/**
 * Workflow definition validation error
 */
export class WorkflowValidationError extends Error {
  constructor(
    public readonly definitionId: string,
    public readonly errors: string[],
  ) {
    super(`Invalid workflow definition "${definitionId}": ${errors.join("; ")}`);
    this.name = "WorkflowValidationError";
  }
}

/**
 * Validate a workflow definition
 */
function validateWorkflowDefinition(definition: WorkflowDefinition): string[] {
  const errors: string[] = [];

  // Required field checks
  if (!definition.id?.trim()) {
    errors.push("id is required");
  }
  if (!definition.name?.trim()) {
    errors.push("name is required");
  }
  if (!definition.version?.trim()) {
    errors.push("version is required");
  }
  if (!definition.entryPoint?.trim()) {
    errors.push("entryPoint is required");
  }
  if (!Array.isArray(definition.steps) || definition.steps.length === 0) {
    errors.push("steps must be a non-empty array");
  }

  // Check for duplicate step IDs
  const stepIds = new Set<string>();
  for (const step of definition.steps) {
    if (!step.id?.trim()) {
      errors.push("All steps must have an id");
      continue;
    }
    if (stepIds.has(step.id)) {
      errors.push(`Duplicate step id: ${step.id}`);
    }
    stepIds.add(step.id);
  }

  // Check entry point exists
  if (definition.entryPoint && !stepIds.has(definition.entryPoint)) {
    errors.push(`Entry point "${definition.entryPoint}" does not exist in steps`);
  }

  // Check next step references
  for (const step of definition.steps) {
    if (typeof step.next === "string" && step.next && !stepIds.has(step.next)) {
      errors.push(`Step "${step.id}" references non-existent next step "${step.next}"`);
    }
    if (Array.isArray(step.next)) {
      for (const branch of step.next) {
        if (branch.nextStep && !stepIds.has(branch.nextStep)) {
          errors.push(`Step "${step.id}" references non-existent branch target "${branch.nextStep}"`);
        }
      }
    }
  }

  // Validate step configurations
  for (const step of definition.steps) {
    const stepErrors = validateWorkflowStep(step);
    errors.push(...stepErrors.map((e) => `Step "${step.id}": ${e}`));
  }

  return errors;
}

/**
 * Validate a workflow step
 */
function validateWorkflowStep(step: WorkflowStep): string[] {
  const errors: string[] = [];

  if (!step.type) {
    errors.push("type is required");
    return errors;
  }

  if (!step.config) {
    errors.push("config is required");
    return errors;
  }

  // Type-specific validation
  switch (step.type) {
    case "ai_action":
      if (step.config.type !== "ai_action") {
        errors.push("config.type must be 'ai_action'");
      } else if (!(step.config as any).actionId?.trim()) {
        errors.push("config.actionId is required for ai_action step");
      }
      break;

    case "tool_call":
      if (step.config.type !== "tool_call") {
        errors.push("config.type must be 'tool_call'");
      } else if (!(step.config as any).toolName?.trim()) {
        errors.push("config.toolName is required for tool_call step");
      }
      break;

    case "condition":
      if (step.config.type !== "condition") {
        errors.push("config.type must be 'condition'");
      } else {
        if (!(step.config as any).expression?.trim()) {
          errors.push("config.expression is required for condition step");
        }
        if (!Array.isArray((step.config as any).branches) || (step.config as any).branches.length === 0) {
          errors.push("config.branches must be a non-empty array for condition step");
        }
      }
      break;

    case "loop":
      if (step.config.type !== "loop") {
        errors.push("config.type must be 'loop'");
      } else {
        if (typeof (step.config as any).maxIterations !== "number" || (step.config as any).maxIterations <= 0) {
          errors.push("config.maxIterations must be a positive number for loop step");
        }
        if (!Array.isArray((step.config as any).body) || (step.config as any).body.length === 0) {
          errors.push("config.body must be a non-empty array for loop step");
        }
      }
      break;

    case "parallel":
      if (step.config.type !== "parallel") {
        errors.push("config.type must be 'parallel'");
      } else {
        if (!Array.isArray((step.config as any).branches) || (step.config as any).branches.length === 0) {
          errors.push("config.branches must be a non-empty array for parallel step");
        }
        if (!["all", "any", "none"].includes((step.config as any).waitFor)) {
          errors.push("config.waitFor must be 'all', 'any', or 'none' for parallel step");
        }
      }
      break;

    case "human_approval":
      if (step.config.type !== "human_approval") {
        errors.push("config.type must be 'human_approval'");
      } else if (!(step.config as any).message?.trim()) {
        errors.push("config.message is required for human_approval step");
      }
      break;

    case "transform":
      if (step.config.type !== "transform") {
        errors.push("config.type must be 'transform'");
      } else if (!(step.config as any).expression?.trim()) {
        errors.push("config.expression is required for transform step");
      }
      break;

    default:
      errors.push(`Unknown step type: ${step.type}`);
  }

  // Validate retry settings
  if (step.retry) {
    if (typeof step.retry.maxAttempts !== "number" || step.retry.maxAttempts < 1) {
      errors.push("retry.maxAttempts must be a positive integer");
    }
    if (typeof step.retry.delayMs !== "number" || step.retry.delayMs < 0) {
      errors.push("retry.delayMs must be a non-negative number");
    }
  }

  return errors;
}

/**
 * In-memory workflow registry implementation
 */
class InMemoryWorkflowRegistry implements WorkflowRegistry {
  private definitions = new Map<string, WorkflowDefinition>();

  register(definition: WorkflowDefinition): void {
    const errors = validateWorkflowDefinition(definition);
    if (errors.length > 0) {
      throw new WorkflowValidationError(definition.id || "(unknown)", errors);
    }

    const normalizedId = definition.id.trim();
    if (this.definitions.has(normalizedId)) {
      throw new Error(`Workflow definition already registered: ${normalizedId}`);
    }

    // Deep copy before storing
    this.definitions.set(normalizedId, structuredClone(definition));
  }

  getDefinition(id: string): WorkflowDefinition | null {
    const normalizedId = id.trim();
    const def = this.definitions.get(normalizedId);
    return def ? structuredClone(def) : null;
  }

  listDefinitions(): WorkflowDefinition[] {
    return Array.from(this.definitions.values()).map((def) => structuredClone(def));
  }

  unregister(id: string): boolean {
    const normalizedId = id.trim();
    return this.definitions.delete(normalizedId);
  }
}

/**
 * Create a workflow registry
 */
export function createWorkflowRegistry(): WorkflowRegistry {
  return new InMemoryWorkflowRegistry();
}

/**
 * Default workflow registry instance for App layer
 */
export const appWorkflowRegistry: WorkflowRegistry = createWorkflowRegistry();
