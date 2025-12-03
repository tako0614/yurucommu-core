/**
 * Action Generator Tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  WorkflowActionGenerator,
  createActionGenerator,
  registerGeneratedAction,
  registerWorkflowsAsActions,
  inferInputSchema,
  inferOutputSchema,
  inferDataPolicy,
  mergeDataPolicies,
} from "./action-generator";
import type { WorkflowDefinition, WorkflowRegistry, WorkflowEngine } from "./types";
import type { AiRegistry, AiAction, AiActionDefinition } from "../action-registry";

// Mock workflow registry
function createMockWorkflowRegistry(workflows: WorkflowDefinition[]): WorkflowRegistry {
  const workflowMap = new Map(workflows.map((w) => [w.id, w]));
  return {
    register: vi.fn(),
    getDefinition: (id: string) => workflowMap.get(id) ?? null,
    listDefinitions: () => Array.from(workflowMap.values()),
    unregister: vi.fn(() => true),
  };
}

// Mock workflow engine
function createMockWorkflowEngine(): WorkflowEngine {
  return {
    start: vi.fn(async (definitionId, input) => ({
      id: "instance-1",
      definitionId,
      status: "completed" as const,
      input,
      currentStepId: null,
      stepResults: {},
      output: { result: "success" },
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      initiator: { type: "system" as const },
    })),
    resume: vi.fn(),
    cancel: vi.fn(),
    submitApproval: vi.fn(),
    getInstance: vi.fn(),
    listInstances: vi.fn(),
  };
}

// Mock AI registry
function createMockAiRegistry(): AiRegistry & { registeredActions: AiAction[] } {
  const actions: AiAction[] = [];
  return {
    registeredActions: actions,
    register: vi.fn((action: AiAction) => {
      actions.push(action);
    }),
    getAction: vi.fn((id: string) => actions.find((a) => a.definition.id === id) ?? null),
    listActions: vi.fn(() => actions.map((a) => a.definition)),
  };
}

// Sample workflow definitions
const sampleWorkflow: WorkflowDefinition = {
  id: "workflow.sample",
  name: "Sample Workflow",
  description: "A sample workflow for testing",
  version: "1.0.0",
  entryPoint: "step1",
  dataPolicy: {
    sendPublicPosts: true,
  },
  inputSchema: {
    type: "object",
    properties: {
      content: { type: "string", description: "Content to process" },
    },
    required: ["content"],
  },
  outputSchema: {
    type: "object",
    properties: {
      result: { type: "string" },
    },
  },
  steps: [
    {
      id: "step1",
      type: "ai_action",
      name: "Process Content",
      config: {
        type: "ai_action",
        actionId: "ai.summary",
        input: {},
      },
      inputMapping: {
        text: { type: "ref", stepId: "input", path: "content" },
      },
    },
  ],
};

const workflowWithoutSchemas: WorkflowDefinition = {
  id: "workflow.no-schemas",
  name: "No Schemas Workflow",
  description: "Workflow without explicit schemas",
  version: "1.0.0",
  entryPoint: "step1",
  dataPolicy: {},
  steps: [
    {
      id: "step1",
      type: "transform",
      name: "Transform",
      config: {
        type: "transform",
        expression: "$.data",
      },
      inputMapping: {
        data: { type: "ref", stepId: "input", path: "rawData" },
      },
    },
  ],
};

describe("inferInputSchema", () => {
  it("should use explicit input schema when provided", () => {
    const schema = inferInputSchema(sampleWorkflow);
    expect(schema.type).toBe("object");
    expect(schema.properties).toHaveProperty("content");
    expect(schema.required).toContain("content");
  });

  it("should infer schema from input mappings when not provided", () => {
    const schema = inferInputSchema(workflowWithoutSchemas);
    expect(schema.type).toBe("object");
    expect(schema.properties).toHaveProperty("rawData");
    expect(schema.required).toContain("rawData");
  });
});

describe("inferOutputSchema", () => {
  it("should use explicit output schema when provided", () => {
    const schema = inferOutputSchema(sampleWorkflow);
    expect(schema.type).toBe("object");
    expect(schema.properties).toHaveProperty("result");
  });

  it("should infer schema from last step when not provided", () => {
    const schema = inferOutputSchema(workflowWithoutSchemas);
    expect(schema.type).toBe("object");
    expect(schema.properties).toHaveProperty("transformed");
  });
});

describe("inferDataPolicy", () => {
  it("should return workflow data policy", () => {
    const policy = inferDataPolicy(sampleWorkflow);
    expect(policy.sendPublicPosts).toBe(true);
  });
});

describe("mergeDataPolicies", () => {
  it("should merge multiple policies with OR logic", () => {
    const policy1 = { sendPublicPosts: true, sendDm: false };
    const policy2 = { sendDm: true, sendProfile: false };
    const policy3 = { sendProfile: true };

    const merged = mergeDataPolicies(policy1, policy2, policy3);

    expect(merged.sendPublicPosts).toBe(true);
    expect(merged.sendDm).toBe(true);
    expect(merged.sendProfile).toBe(true);
    expect(merged.sendCommunityPosts).toBe(false);
  });

  it("should concatenate notes", () => {
    const policy1 = { notes: "First note" };
    const policy2 = { notes: "Second note" };

    const merged = mergeDataPolicies(policy1, policy2);

    expect(merged.notes).toBe("First note; Second note");
  });
});

describe("WorkflowActionGenerator", () => {
  let workflowRegistry: WorkflowRegistry;
  let workflowEngine: WorkflowEngine;
  let generator: WorkflowActionGenerator;

  beforeEach(() => {
    workflowRegistry = createMockWorkflowRegistry([sampleWorkflow, workflowWithoutSchemas]);
    workflowEngine = createMockWorkflowEngine();
    generator = new WorkflowActionGenerator(workflowRegistry, workflowEngine);
  });

  describe("generateActionId", () => {
    it("should generate action ID with prefix", () => {
      const actionId = generator.generateActionId(sampleWorkflow);
      expect(actionId).toBe("workflow.sample");
    });

    it("should handle workflows with custom prefix", () => {
      const customGenerator = new WorkflowActionGenerator(
        workflowRegistry,
        workflowEngine,
        { actionIdPrefix: "custom." },
      );
      const actionId = customGenerator.generateActionId(sampleWorkflow);
      expect(actionId).toBe("custom.sample");
    });
  });

  describe("generate", () => {
    it("should generate action from workflow ID", () => {
      const result = generator.generate("workflow.sample");

      expect(result.success).toBe(true);
      expect(result.action).toBeDefined();
      expect(result.actionId).toBe("workflow.sample");
      expect(result.metadata).toBeDefined();
      expect(result.metadata?.isAutoGenerated).toBe(true);
    });

    it("should return error for non-existent workflow", () => {
      const result = generator.generate("workflow.nonexistent");

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("generateFromDefinition", () => {
    it("should generate action with correct definition", () => {
      const result = generator.generateFromDefinition(sampleWorkflow);

      expect(result.success).toBe(true);
      expect(result.action?.definition.id).toBe("workflow.sample");
      expect(result.action?.definition.label).toContain("[Workflow]");
      expect(result.action?.definition.description).toContain("Auto-generated");
      expect(result.action?.definition.inputSchema).toBeDefined();
      expect(result.action?.definition.outputSchema).toBeDefined();
    });

    it("should include data policy", () => {
      const result = generator.generateFromDefinition(sampleWorkflow);

      expect(result.action?.definition.dataPolicy.sendPublicPosts).toBe(true);
    });

    it("should create working handler", async () => {
      const result = generator.generateFromDefinition(sampleWorkflow);

      expect(result.action?.handler).toBeDefined();

      const ctx = { nodeConfig: { ai: { enabled: true } } };
      const output = await result.action?.handler(ctx, { content: "test" });

      expect(output).toEqual({ result: "success" });
      expect(workflowEngine.start).toHaveBeenCalled();
    });
  });

  describe("generateAll", () => {
    it("should generate actions for all workflows", () => {
      const results = generator.generateAll();

      expect(results.length).toBe(2);
      expect(results.every((r) => r.success)).toBe(true);
    });
  });
});

describe("registerGeneratedAction", () => {
  it("should register action in registry", () => {
    const registry = createMockAiRegistry();
    const result = {
      success: true,
      action: {
        definition: {
          id: "workflow.test",
          label: "Test",
          description: "Test action",
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
          providerCapabilities: ["chat" as const],
          dataPolicy: {},
        },
        handler: async () => ({}),
      } as AiAction,
      actionId: "workflow.test",
    };

    const success = registerGeneratedAction(registry, result);

    expect(success).toBe(true);
    expect(registry.register).toHaveBeenCalled();
  });

  it("should not register if action already exists", () => {
    const registry = createMockAiRegistry();
    const existingAction = {
      definition: { id: "workflow.test" } as AiActionDefinition,
      handler: async () => ({}),
    };
    registry.registeredActions.push(existingAction);

    const result = {
      success: true,
      action: existingAction,
      actionId: "workflow.test",
    };

    const success = registerGeneratedAction(registry, result);

    expect(success).toBe(false);
  });

  it("should return false for failed generation", () => {
    const registry = createMockAiRegistry();
    const result = {
      success: false,
      error: "Generation failed",
    };

    const success = registerGeneratedAction(registry, result);

    expect(success).toBe(false);
  });
});

describe("registerWorkflowsAsActions", () => {
  it("should register all generated actions", () => {
    const workflowRegistry = createMockWorkflowRegistry([sampleWorkflow]);
    const workflowEngine = createMockWorkflowEngine();
    const aiRegistry = createMockAiRegistry();

    const { registered, failed } = registerWorkflowsAsActions(
      workflowRegistry,
      workflowEngine,
      aiRegistry,
    );

    expect(registered.length).toBe(1);
    expect(registered[0]).toBe("workflow.sample");
    expect(failed.length).toBe(0);
  });
});

describe("createActionGenerator", () => {
  it("should create generator with default options", () => {
    const workflowRegistry = createMockWorkflowRegistry([]);
    const workflowEngine = createMockWorkflowEngine();

    const generator = createActionGenerator(workflowRegistry, workflowEngine);

    expect(generator).toBeInstanceOf(WorkflowActionGenerator);
  });

  it("should create generator with custom options", () => {
    const workflowRegistry = createMockWorkflowRegistry([sampleWorkflow]);
    const workflowEngine = createMockWorkflowEngine();

    const generator = createActionGenerator(workflowRegistry, workflowEngine, {
      actionIdPrefix: "auto.",
      labelPrefix: "[Auto] ",
    });

    const result = generator.generate("workflow.sample");
    expect(result.actionId).toBe("auto.sample");
    expect(result.action?.definition.label).toContain("[Auto]");
  });
});
