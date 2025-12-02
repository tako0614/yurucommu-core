import { normalizeAiDataPolicy } from "./provider-registry.js";
import type { EffectiveAiDataPolicy } from "./provider-registry.js";
import type { JsonSchema, TakosAiConfig, TakosConfig } from "../config/takos-config.js";

export type AiProviderCapability = "chat" | "completion" | "embedding";

export type AiActionDataPolicy = Partial<EffectiveAiDataPolicy>;

export interface AiActionDefinition {
  id: string;
  label: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  providerCapabilities: AiProviderCapability[];
  dataPolicy: AiActionDataPolicy;
}

export interface AiActionContext {
  nodeConfig: Pick<TakosConfig, "ai"> & Partial<TakosConfig>;
  [key: string]: unknown;
}

export type AiActionHandler<I = unknown, O = unknown> = (
  ctx: AiActionContext,
  input: I,
) => Promise<O>;

export interface AiAction<I = unknown, O = unknown> {
  definition: AiActionDefinition;
  handler: AiActionHandler<I, O>;
}

export interface AiRegistry {
  register(action: AiAction): void;
  getAction(id: string): AiAction | null;
  listActions(): AiActionDefinition[];
}

type NormalizedAiDataPolicy = Required<Omit<EffectiveAiDataPolicy, "notes">> & {
  notes?: string;
};

const PROVIDER_CAPABILITIES: AiProviderCapability[] = ["chat", "completion", "embedding"];

function normalizePolicy(policy?: AiActionDataPolicy): NormalizedAiDataPolicy {
  const notes = typeof policy?.notes === "string" ? policy.notes : undefined;
  return {
    sendPublicPosts: Boolean(policy?.sendPublicPosts),
    sendCommunityPosts: Boolean(policy?.sendCommunityPosts),
    sendDm: Boolean(policy?.sendDm),
    sendProfile: Boolean(policy?.sendProfile),
    ...(notes !== undefined ? { notes } : {}),
  };
}

function normalizeNodePolicy(config?: TakosAiConfig | null): NormalizedAiDataPolicy {
  const dataPolicy = normalizeAiDataPolicy(config?.data_policy);
  return {
    sendPublicPosts: dataPolicy.sendPublicPosts,
    sendCommunityPosts: dataPolicy.sendCommunityPosts,
    sendDm: dataPolicy.sendDm,
    sendProfile: dataPolicy.sendProfile,
  };
}

function normalizeId(id: string): string {
  return id.trim();
}

function normalizeActionList(actions: readonly string[]): string[] {
  return Array.from(new Set(actions.map(normalizeId).filter(Boolean)));
}

function cloneDefinition(definition: AiActionDefinition): AiActionDefinition {
  return {
    ...definition,
    providerCapabilities: [...definition.providerCapabilities],
    dataPolicy: { ...(definition.dataPolicy as Record<string, unknown>) },
  };
}

function ensureCapabilities(id: string, capabilities: AiProviderCapability[]): void {
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    throw new Error(`AiActionDefinition.providerCapabilities must be a non-empty array for "${id}"`);
  }

  for (const capability of capabilities) {
    if (!PROVIDER_CAPABILITIES.includes(capability)) {
      throw new Error(`Invalid provider capability "${capability}" for action "${id}"`);
    }
  }
}

class InMemoryAiRegistry implements AiRegistry {
  private actions = new Map<string, AiAction>();

  register(action: AiAction): void {
    const normalizedId = normalizeId(action.definition.id ?? "");
    if (!normalizedId) {
      throw new Error("AiActionDefinition.id is required");
    }
    ensureCapabilities(normalizedId, action.definition.providerCapabilities);

    if (this.actions.has(normalizedId)) {
      throw new Error(`AI action already registered: ${normalizedId}`);
    }

    const normalizedAction: AiAction = {
      definition: {
        ...action.definition,
        id: normalizedId,
        providerCapabilities: Array.from(
          new Set(action.definition.providerCapabilities),
        ) as AiProviderCapability[],
        dataPolicy: normalizePolicy(action.definition.dataPolicy),
      },
      handler: action.handler,
    };

    this.actions.set(normalizedId, normalizedAction);
  }

  getAction(id: string): AiAction | null {
    const normalizedId = normalizeId(id);
    return this.actions.get(normalizedId) ?? null;
  }

  listActions(): AiActionDefinition[] {
    return Array.from(this.actions.values()).map((action) => cloneDefinition(action.definition));
  }
}

export function createAiActionRegistry(): AiRegistry {
  return new InMemoryAiRegistry();
}

export const aiActionRegistry: AiRegistry = createAiActionRegistry();

type ActionAllowedConfig = Pick<TakosConfig, "ai">;

function assertAiFeatureEnabled(actionId: string, config: ActionAllowedConfig): void {
  if (!config.ai?.enabled) {
    throw new Error("AI is disabled for this node");
  }
  const enabledActions = (config.ai.enabled_actions ?? []).map(normalizeId);
  if (!enabledActions.includes(actionId)) {
    throw new Error(`AI action "${actionId}" is not enabled for this node`);
  }
}

function assertDataPolicy(
  actionPolicy: NormalizedAiDataPolicy,
  aiConfig: TakosAiConfig | undefined,
): void {
  const nodePolicy = normalizeNodePolicy(aiConfig);
  const violations: string[] = [];

  if (actionPolicy.sendPublicPosts && !nodePolicy.sendPublicPosts) {
    violations.push("sendPublicPosts");
  }
  if (actionPolicy.sendCommunityPosts && !nodePolicy.sendCommunityPosts) {
    violations.push("sendCommunityPosts");
  }
  if (actionPolicy.sendDm && !nodePolicy.sendDm) {
    violations.push("sendDm");
  }
  if (actionPolicy.sendProfile && !nodePolicy.sendProfile) {
    violations.push("sendProfile");
  }

  if (violations.length) {
    const suffix =
      violations.length === 1
        ? `${violations[0]} is not allowed by node policy`
        : `${violations.join(", ")} are not allowed by node policy`;
    throw new Error(`DataPolicyViolation: ${suffix}`);
  }
}

export function ensureAiActionAllowed(
  action: AiActionDefinition,
  nodeConfig: ActionAllowedConfig,
): void {
  const normalizedId = normalizeId(action.id ?? "");
  assertAiFeatureEnabled(normalizedId, nodeConfig);

  const actionPolicy = normalizePolicy(action.dataPolicy);
  assertDataPolicy(actionPolicy, nodeConfig.ai);
}

export async function dispatchAiAction<I, O>(
  registry: AiRegistry,
  actionId: string,
  ctx: AiActionContext,
  input: I,
): Promise<O> {
  const normalizedId = normalizeId(actionId);
  if (!normalizedId) {
    throw new Error("actionId is required");
  }

  const action = registry.getAction(normalizedId);
  if (!action) {
    throw new Error(`Unknown AI action: ${normalizedId}`);
  }

  if (!ctx || !ctx.nodeConfig) {
    throw new Error("nodeConfig is required to dispatch an AI action");
  }

  ensureAiActionAllowed(action.definition, ctx.nodeConfig);
  return await action.handler(ctx, input) as O;
}

export function assertActionsInAllowlist(
  enabledActions: readonly string[],
  allowedActions: readonly string[],
): void {
  const allowlist = new Set(normalizeActionList(allowedActions));
  const disallowed = normalizeActionList(enabledActions).filter((id) => !allowlist.has(id));

  if (disallowed.length > 0) {
    const suffix = disallowed.length === 1 ? disallowed[0] : disallowed.join(", ");
    throw new Error(`AI actions not allowed by takos-profile: ${suffix}`);
  }
}
