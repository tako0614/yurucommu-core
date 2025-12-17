/**
 * Workflow Engine Tests
 *
 * Tests for the App layer Workflow Engine implementation.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createWorkflowRegistry,
  WorkflowValidationError,
} from "./registry.js";
import {
  createWorkflowEngine,
  WorkflowExecutionError,
} from "./engine.js";
import {
  builtinWorkflows,
  registerBuiltinWorkflows,
  contentModerationWorkflow,
  postEnhancementWorkflow,
} from "./builtin-workflows.js";
import {
  WorkflowActionGenerator,
  createActionGenerator,
  inferInputSchema,
  inferOutputSchema,
  inferDataPolicy,
} from "./action-generator.js";
import type {
  WorkflowDefinition,
  WorkflowRegistry,
  WorkflowExecutionContext,
} from "./types.js";

describe("WorkflowRegistry", () => {
  let registry: WorkflowRegistry;

  beforeEach(() => {
    registry = createWorkflowRegistry();
  });

  it("registers a valid workflow definition", () => {
    const workflow: WorkflowDefinition = {
      id: "test-workflow",
      name: "Test Workflow",
      version: "1.0.0",
      entryPoint: "step1",
      steps: [
        {
          id: "step1",
          type: "transform",
          name: "Transform Step",
          config: { type: "transform", expression: "$.input" },
        },
      ],
    };

    registry.register(workflow);
    const retrieved = registry.getDefinition("test-workflow");

    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe("test-workflow");
    expect(retrieved?.name).toBe("Test Workflow");
  });

  it("throws error for duplicate registration", () => {
    const workflow: WorkflowDefinition = {
      id: "duplicate",
      name: "Duplicate",
      version: "1.0.0",
      entryPoint: "step1",
      steps: [
        {
          id: "step1",
          type: "transform",
          config: { type: "transform", expression: "$.x" },
        },
      ],
    };

    registry.register(workflow);

    expect(() => registry.register(workflow)).toThrow("already registered");
  });

  it("throws WorkflowValidationError for invalid definition", () => {
    const invalidWorkflow = {
      id: "",
      name: "No ID",
      version: "1.0.0",
      entryPoint: "step1",
      steps: [],
    } as WorkflowDefinition;

    expect(() => registry.register(invalidWorkflow)).toThrow(WorkflowValidationError);
  });

  it("validates entry point exists in steps", () => {
    const workflow: WorkflowDefinition = {
      id: "bad-entry",
      name: "Bad Entry Point",
      version: "1.0.0",
      entryPoint: "nonexistent",
      steps: [
        {
          id: "step1",
          type: "transform",
          config: { type: "transform", expression: "$.x" },
        },
      ],
    };

    expect(() => registry.register(workflow)).toThrow(WorkflowValidationError);
  });

  it("lists all registered definitions", () => {
    const workflow1: WorkflowDefinition = {
      id: "wf1",
      name: "Workflow 1",
      version: "1.0.0",
      entryPoint: "s1",
      steps: [{ id: "s1", type: "transform", config: { type: "transform", expression: "$.x" } }],
    };

    const workflow2: WorkflowDefinition = {
      id: "wf2",
      name: "Workflow 2",
      version: "1.0.0",
      entryPoint: "s1",
      steps: [{ id: "s1", type: "transform", config: { type: "transform", expression: "$.y" } }],
    };

    registry.register(workflow1);
    registry.register(workflow2);

    const definitions = registry.listDefinitions();
    expect(definitions).toHaveLength(2);
    expect(definitions.map((d) => d.id).sort()).toEqual(["wf1", "wf2"]);
  });

  it("unregisters a workflow", () => {
    const workflow: WorkflowDefinition = {
      id: "to-remove",
      name: "To Remove",
      version: "1.0.0",
      entryPoint: "s1",
      steps: [{ id: "s1", type: "transform", config: { type: "transform", expression: "$.x" } }],
    };

    registry.register(workflow);
    expect(registry.getDefinition("to-remove")).not.toBeNull();

    const result = registry.unregister("to-remove");
    expect(result).toBe(true);
    expect(registry.getDefinition("to-remove")).toBeNull();
  });
});

describe("Built-in Workflows", () => {
  it("exports 5 builtin workflows", () => {
    expect(builtinWorkflows).toHaveLength(5);
  });

  it("content moderation workflow has valid structure", () => {
    expect(contentModerationWorkflow.id).toBe("workflow.content_moderation");
    expect(contentModerationWorkflow.steps.length).toBeGreaterThan(0);
    expect(contentModerationWorkflow.entryPoint).toBe("analyze_content");
  });

  it("post enhancement workflow has valid structure", () => {
    expect(postEnhancementWorkflow.id).toBe("workflow.post_enhancement");
    expect(postEnhancementWorkflow.steps.length).toBeGreaterThan(0);
  });

  it("registerBuiltinWorkflows registers all workflows", () => {
    const registry = createWorkflowRegistry();
    registerBuiltinWorkflows(registry);

    const definitions = registry.listDefinitions();
    expect(definitions.length).toBe(5);

    // Verify specific workflows are registered
    expect(registry.getDefinition("workflow.content_moderation")).not.toBeNull();
    expect(registry.getDefinition("workflow.post_enhancement")).not.toBeNull();
    expect(registry.getDefinition("workflow.translation_chain")).not.toBeNull();
    expect(registry.getDefinition("workflow.dm_safety_check")).not.toBeNull();
    expect(registry.getDefinition("workflow.community_digest")).not.toBeNull();
  });
});

describe("Schema Inference", () => {
  it("infers input schema from explicit inputSchema", () => {
    const workflow: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: "1.0.0",
      entryPoint: "s1",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string" },
          count: { type: "number" },
        },
        required: ["text"],
      },
      steps: [{ id: "s1", type: "transform", config: { type: "transform", expression: "$.x" } }],
    };

    const schema = inferInputSchema(workflow);
    expect(schema.type).toBe("object");
    expect(schema.properties?.text).toBeDefined();
    expect(schema.required).toContain("text");
  });

  it("infers input schema from step inputMapping when no explicit schema", () => {
    const workflow: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: "1.0.0",
      entryPoint: "s1",
      steps: [
        {
          id: "s1",
          type: "ai_action",
          config: { type: "ai_action", actionId: "ai.summary", input: {} },
          inputMapping: {
            text: { type: "ref", stepId: "input", path: "content" },
            maxSentences: { type: "ref", stepId: "input", path: "limit" },
          },
        },
      ],
    };

    const schema = inferInputSchema(workflow);
    expect(schema.properties?.content).toBeDefined();
    expect(schema.properties?.limit).toBeDefined();
  });

  it("infers output schema from explicit outputSchema", () => {
    const workflow: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: "1.0.0",
      entryPoint: "s1",
      outputSchema: {
        type: "object",
        properties: {
          result: { type: "string" },
        },
      },
      steps: [{ id: "s1", type: "transform", config: { type: "transform", expression: "$.x" } }],
    };

    const schema = inferOutputSchema(workflow);
    expect(schema.properties?.result).toBeDefined();
  });

  it("infers data policy from workflow dataPolicy", () => {
    const workflow: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: "1.0.0",
      entryPoint: "s1",
      dataPolicy: {
        sendPublicPosts: true,
        sendDm: true,
      },
      steps: [{ id: "s1", type: "transform", config: { type: "transform", expression: "$.x" } }],
    };

    const policy = inferDataPolicy(workflow);
    expect(policy.sendPublicPosts).toBe(true);
    expect(policy.sendDm).toBe(true);
  });
});

describe("WorkflowActionGenerator", () => {
  it("generates action ID from workflow ID", () => {
    const registry = createWorkflowRegistry();
    const mockEngine = {
      start: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
      submitApproval: vi.fn(),
      getInstance: vi.fn(),
      listInstances: vi.fn(),
    } as any;

    const generator = createActionGenerator(registry, mockEngine);

    const workflow: WorkflowDefinition = {
      id: "my-workflow",
      name: "My Workflow",
      version: "1.0.0",
      entryPoint: "s1",
      steps: [{ id: "s1", type: "transform", config: { type: "transform", expression: "$.x" } }],
    };

    const actionId = generator.generateActionId(workflow);
    expect(actionId).toBe("workflow.my-workflow");
  });

  it("generates action from registered workflow", () => {
    const registry = createWorkflowRegistry();
    const mockEngine = {
      start: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
      submitApproval: vi.fn(),
      getInstance: vi.fn(),
      listInstances: vi.fn(),
    } as any;

    const workflow: WorkflowDefinition = {
      id: "test-workflow",
      name: "Test Workflow",
      description: "A test workflow",
      version: "1.0.0",
      entryPoint: "s1",
      steps: [{ id: "s1", type: "transform", config: { type: "transform", expression: "$.x" } }],
    };

    registry.register(workflow);

    const generator = createActionGenerator(registry, mockEngine);
    const result = generator.generate("test-workflow");

    expect(result.success).toBe(true);
    expect(result.action).toBeDefined();
    expect(result.actionId).toBe("workflow.test-workflow");
    expect(result.action?.definition.label).toContain("Test Workflow");
    expect(result.action?.definition.description).toContain("Auto-generated from workflow");
  });

  it("returns error for non-existent workflow", () => {
    const registry = createWorkflowRegistry();
    const mockEngine = {} as any;

    const generator = createActionGenerator(registry, mockEngine);
    const result = generator.generate("nonexistent");

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("generateAll generates actions for all workflows", () => {
    const registry = createWorkflowRegistry();
    const mockEngine = {
      start: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
      submitApproval: vi.fn(),
      getInstance: vi.fn(),
      listInstances: vi.fn(),
    } as any;

    // Register some workflows
    registerBuiltinWorkflows(registry);

    const generator = createActionGenerator(registry, mockEngine);
    const results = generator.generateAll();

    expect(results.length).toBe(5);
    expect(results.filter((r) => r.success).length).toBe(5);
  });
});
