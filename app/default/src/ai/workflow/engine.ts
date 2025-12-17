/**
 * AI Workflow Execution Engine for App Layer
 *
 * Workflow execution engine implementation
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
} from "./types.js";
import type { AiRegistry, AiProviderRegistry } from "@takos/platform/server";

/**
 * Workflow execution error
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
 * Generate a unique ID
 */
function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * Get value by JSON path
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

    // Array index support
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
 * Resolve input mapping
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
      // String value used as-is
      resolved[key] = value;
    } else if (value && typeof value === "object" && value.type === "ref") {
      // Data reference
      const ref = value as WorkflowDataRef;
      if (ref.stepId === "input") {
        // Reference from workflow input
        resolved[key] = getValueByPath(workflowInput, ref.path);
      } else {
        // Reference from previous step output
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
 * Evaluate condition expression (simple implementation)
 */
function evaluateCondition(
  expression: string,
  context: Record<string, unknown>,
): boolean {
  // Simple comparison expressions: "value == 'string'" or "value > 0"
  const eqMatch = expression.match(/^(\w+(?:\.\w+)*)\s*(==|!=|>|<|>=|<=)\s*(.+)$/);
  if (eqMatch) {
    const [, path, operator, rawValue] = eqMatch;
    const leftValue = getValueByPath(context, path);

    // Parse right-hand value
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

  // Boolean path reference
  const boolValue = getValueByPath(context, expression);
  return Boolean(boolValue);
}

/**
 * Default workflow engine implementation
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
   * Add event handler
   */
  addEventHandler(handler: WorkflowEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Emit event
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
   * Start workflow
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

    // Start execution asynchronously
    this.executeWorkflow(definition, instance, {
      ...context,
      instance,
    }).catch((error) => {
      console.error("[workflow-engine] Workflow execution error:", error);
    });

    return instance;
  }

  /**
   * Resume workflow
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

    // Add approval input to current step result if provided
    if (approvalInput && instance.currentStepId) {
      const currentResult = instance.stepResults[instance.currentStepId];
      if (currentResult) {
        currentResult.output = { ...currentResult.output as object, ...approvalInput };
      }
    }

    return instance;
  }

  /**
   * Cancel workflow
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
   * Submit human approval
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
   * Get instance
   */
  async getInstance(instanceId: string): Promise<WorkflowInstance | null> {
    return this.instances.get(instanceId) ?? null;
  }

  /**
   * List instances
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

      // Pagination
      const offset = filters.offset ?? 0;
      const limit = filters.limit ?? 50;
      instances = instances.slice(offset, offset + limit);
    }

    return instances;
  }

  /**
   * Execute workflow
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

        // Execute step
        const result = await this.executeStep(step, instance, context, definition);

        // Save result
        instance.stepResults[step.id] = result;

        // Determine next step
        if (result.status === "completed") {
          currentStepId = this.determineNextStep(step, result, instance);
        } else if (result.status === "failed") {
          // Error handling
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

        // Check for pause (human approval)
        if ((instance.status as WorkflowStatus) === "paused") {
          return;
        }
      }

      // Workflow complete
      instance.status = "completed";
      instance.completedAt = new Date().toISOString();
      instance.currentStepId = null;

      // Set final output
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
   * Execute step
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
        // Resolve input
        const resolvedInput = resolveInputMapping(
          step.inputMapping,
          instance.stepResults,
          instance.input,
        );

        // Execute by step type
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

    // All retries failed
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
   * Execute step by type
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
   * Execute AI action step
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

    // Merge input
    const mergedInput = { ...config.input, ...input };

    // Execute AI action
    const actionContext = {
      nodeConfig: context.nodeConfig,
      auth: context.auth,
      env: context.env,
      providers: this.providerRegistry,
    };

    return await action.handler(actionContext, mergedInput);
  }

  /**
   * Execute tool call step
   */
  private async executeToolCallStep(
    step: WorkflowStep,
    input: Record<string, unknown>,
    context: WorkflowExecutionContext,
  ): Promise<unknown> {
    const config = step.config as { type: "tool_call"; toolName: string; input: Record<string, unknown> };

    context.log("info", `Executing tool: ${config.toolName}`, { input: { ...config.input, ...input } });

    // Placeholder implementation
    return { toolName: config.toolName, executed: true, input: { ...config.input, ...input } };
  }

  /**
   * Execute condition step
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
   * Execute transform step
   */
  private async executeTransformStep(
    step: WorkflowStep,
    input: Record<string, unknown>,
    _context: WorkflowExecutionContext,
  ): Promise<unknown> {
    const config = step.config as { type: "transform"; expression: string };

    // Simple path reference transformation
    if (config.expression.startsWith("$.")) {
      const path = config.expression.slice(2);
      return getValueByPath(input, path);
    }

    return input;
  }

  /**
   * Execute human approval step
   */
  private async executeHumanApprovalStep(
    step: WorkflowStep,
    input: Record<string, unknown>,
    context: WorkflowExecutionContext,
  ): Promise<unknown> {
    const config = step.config as { type: "human_approval"; message: string; approvalType: string; choices?: string[] };

    // Pause workflow
    context.instance.status = "paused";

    await this.emitEvent({
      type: "approval_required",
      instanceId: context.instance.id,
      stepId: step.id,
      message: config.message,
    });

    // Return approval waiting info
    return {
      waitingForApproval: true,
      message: config.message,
      approvalType: config.approvalType,
      choices: config.choices,
    };
  }

  /**
   * Execute parallel step
   */
  private async executeParallelStep(
    step: WorkflowStep,
    input: Record<string, unknown>,
    context: WorkflowExecutionContext,
  ): Promise<unknown> {
    const config = step.config as { type: "parallel"; branches: WorkflowStep[][]; waitFor: "all" | "any" | "none" };

    // Execute branches in parallel
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
      // none: fire and forget
      Promise.all(promises).catch((err) => {
        context.log("error", "Parallel branch error", { error: err });
      });
      return { scheduled: true };
    }
  }

  /**
   * Execute loop step
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
      // Check condition
      const evalContext = { ...input, iteration, results };
      if (!evaluateCondition(config.condition, evalContext)) {
        break;
      }

      // Execute body
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
   * Determine next step
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

    // For condition steps
    if (step.type === "condition" && result.output) {
      const output = result.output as { selectedBranch?: string };
      return output.selectedBranch ?? null;
    }

    // For branch arrays, evaluate conditions
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
 * Create a workflow engine
 */
export function createWorkflowEngine(
  registry: WorkflowRegistry,
  aiRegistry: AiRegistry,
  providerRegistry: AiProviderRegistry,
): WorkflowEngine & { addEventHandler: (handler: WorkflowEventHandler) => void } {
  return new DefaultWorkflowEngine(registry, aiRegistry, providerRegistry);
}
