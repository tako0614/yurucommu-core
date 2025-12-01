import type {
  AiProviderType,
  TakosAiConfig,
  TakosAiDataPolicy,
  TakosAiProviderConfig,
} from "../config/takos-config";

type EnvLookup = Record<string, string | undefined>;

const DEFAULT_BASE_URLS: Partial<Record<AiProviderType, string>> = {
  openai: "https://api.openai.com/v1",
  claude: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  openrouter: "https://openrouter.ai/api/v1",
};

const AUTH_HEADERS: Record<AiProviderType, { header: string; prefix?: string }> = {
  openai: { header: "Authorization", prefix: "Bearer " },
  "openai-compatible": { header: "Authorization", prefix: "Bearer " },
  claude: { header: "x-api-key" },
  gemini: { header: "x-goog-api-key" },
  openrouter: { header: "Authorization", prefix: "Bearer " },
};

export type AiProviderClient = {
  id: string;
  type: AiProviderType;
  baseUrl: string;
  model?: string;
  apiKey: string;
  headers: Record<string, string>;
};

export type AiProviderResolution = {
  providers: Map<string, AiProviderClient>;
  defaultProviderId?: string;
  dataPolicy: EffectiveAiDataPolicy;
  errors: string[];
  warnings: string[];
};

export type EffectiveAiDataPolicy = {
  sendPublicPosts: boolean;
  sendCommunityPosts: boolean;
  sendDm: boolean;
  sendProfile: boolean;
  notes?: string;
};

const DEFAULT_DATA_POLICY: EffectiveAiDataPolicy = {
  sendPublicPosts: false,
  sendCommunityPosts: false,
  sendDm: false,
  sendProfile: false,
};

export function normalizeAiDataPolicy(policy?: TakosAiDataPolicy): EffectiveAiDataPolicy {
  return {
    ...DEFAULT_DATA_POLICY,
    sendPublicPosts: policy?.send_public_posts ?? DEFAULT_DATA_POLICY.sendPublicPosts,
    sendCommunityPosts: policy?.send_community_posts ?? DEFAULT_DATA_POLICY.sendCommunityPosts,
    sendDm: policy?.send_dm ?? DEFAULT_DATA_POLICY.sendDm,
    sendProfile: policy?.send_profile ?? DEFAULT_DATA_POLICY.sendProfile,
    notes: policy?.notes,
  };
}

export function combineDataPolicies(
  nodePolicy: EffectiveAiDataPolicy,
  actionPolicy?: Partial<EffectiveAiDataPolicy>,
): EffectiveAiDataPolicy {
  const fallback = actionPolicy ?? {};
  return {
    sendPublicPosts: nodePolicy.sendPublicPosts && (fallback.sendPublicPosts ?? true),
    sendCommunityPosts: nodePolicy.sendCommunityPosts && (fallback.sendCommunityPosts ?? true),
    sendDm: nodePolicy.sendDm && (fallback.sendDm ?? true),
    sendProfile: nodePolicy.sendProfile && (fallback.sendProfile ?? true),
    notes: fallback.notes ?? nodePolicy.notes,
  };
}

export type AiPayloadSlices = {
  publicPosts?: unknown;
  communityPosts?: unknown;
  dmMessages?: unknown;
  profile?: unknown;
  [key: string]: unknown;
};

export type AiRedaction = {
  field: keyof AiPayloadSlices;
  reason: string;
};

export type AiRedactionResult<T extends AiPayloadSlices> = {
  payload: T;
  policy: EffectiveAiDataPolicy;
  redacted: AiRedaction[];
};

export type AiPolicyOptions<T extends AiPayloadSlices> = {
  payload: T;
  actionPolicy?: Partial<EffectiveAiDataPolicy>;
  providerId?: string;
  onRedaction?: (result: AiRedactionResult<T>) => void;
};

export type AiPolicyContext<T extends AiPayloadSlices> = AiRedactionResult<T> & {
  provider: AiProviderClient;
};

export type AiCallResult<T extends AiPayloadSlices, TResult> = AiPolicyContext<T> & {
  result: TResult;
};

export type AiCallExecutor<T extends AiPayloadSlices, TResult> = (
  ctx: AiPolicyContext<T>,
) => Promise<TResult>;

export function redactPayload<T extends AiPayloadSlices>(
  payload: T,
  policy: EffectiveAiDataPolicy,
): AiRedactionResult<T> {
  const clone = { ...payload } as T;
  const redacted: AiRedaction[] = [];

  const redact = (allowed: boolean, field: keyof AiPayloadSlices, reason: string) => {
    if (allowed) return;
    if (field in clone) {
      delete (clone as any)[field];
      redacted.push({ field, reason });
    }
  };

  redact(policy.sendPublicPosts, "publicPosts", "sendPublicPosts not allowed by policy");
  redact(policy.sendCommunityPosts, "communityPosts", "sendCommunityPosts not allowed by policy");
  redact(policy.sendDm, "dmMessages", "sendDm not allowed by policy");
  redact(policy.sendProfile, "profile", "sendProfile not allowed by policy");

  return { payload: clone, policy, redacted };
}

export function resolveAiProviders(
  aiConfig: TakosAiConfig | undefined,
  env: EnvLookup,
): AiProviderResolution {
  const providers = new Map<string, AiProviderClient>();
  const errors: string[] = [];
  const warnings: string[] = [];
  const dataPolicy = normalizeAiDataPolicy(aiConfig?.data_policy);

  const entries = Object.entries(aiConfig?.providers ?? {});
  for (const [providerId, providerConfig] of entries) {
    const resolved = resolveSingleProvider(providerId, providerConfig, env);
    if (resolved.error) {
      errors.push(resolved.error);
      continue;
    }
    if (resolved.provider) {
      providers.set(providerId, resolved.provider);
    }
    if (resolved.warning) {
      warnings.push(resolved.warning);
    }
  }

  let defaultProviderId = aiConfig?.default_provider;
  if (defaultProviderId && !providers.has(defaultProviderId)) {
    errors.push(`ai.default_provider "${defaultProviderId}" is not defined or failed to resolve`);
    defaultProviderId = undefined;
  }

  if (!defaultProviderId && providers.size > 0) {
    defaultProviderId = providers.keys().next().value;
    if (providers.size > 1) {
      warnings.push(`ai.default_provider not set; using "${defaultProviderId}" as default`);
    }
  }

  return {
    providers,
    defaultProviderId,
    dataPolicy,
    errors,
    warnings,
  };
}

type ResolveResult = {
  provider?: AiProviderClient;
  error?: string;
  warning?: string;
};

function resolveSingleProvider(
  providerId: string,
  providerConfig: TakosAiProviderConfig,
  env: EnvLookup,
): ResolveResult {
  const baseUrl = resolveBaseUrl(providerId, providerConfig);
  if (!baseUrl) {
    return {
      error: `ai.providers.${providerId}.base_url is required for type "${providerConfig.type}"`,
    };
  }

  const apiKeyEnv = providerConfig.api_key_env?.trim();
  if (!apiKeyEnv) {
    return {
      error: `ai.providers.${providerId}.api_key_env is required to resolve credentials`,
    };
  }

  const envValue = env?.[apiKeyEnv];
  if (!envValue || String(envValue).trim() === "") {
    return {
      error: `ai.providers.${providerId}: environment variable "${apiKeyEnv}" is missing`,
    };
  }

  const auth = AUTH_HEADERS[providerConfig.type] ?? AUTH_HEADERS["openai-compatible"];
  const apiKey = String(envValue).trim();
  const headers: Record<string, string> = {
    [auth.header]: auth.prefix ? `${auth.prefix}${apiKey}` : apiKey,
  };

  return {
    provider: {
      id: providerId,
      type: providerConfig.type,
      baseUrl,
      model: providerConfig.model,
      apiKey,
      headers,
    },
  };
}

function resolveBaseUrl(
  providerId: string,
  providerConfig: TakosAiProviderConfig,
): string | null {
  const configured = typeof providerConfig.base_url === "string" ? providerConfig.base_url.trim() : "";
  if (configured) return configured;

  const preset = DEFAULT_BASE_URLS[providerConfig.type];
  if (preset) return preset;

  return null;
}

export class AiProviderRegistry {
  private readonly providers: Map<string, AiProviderClient>;
  private readonly defaultProviderId?: string;
  private readonly policy: EffectiveAiDataPolicy;
  readonly warnings: string[];

  constructor(resolution: AiProviderResolution) {
    if (resolution.errors.length > 0) {
      throw new Error(`AI provider configuration error: ${resolution.errors.join("; ")}`);
    }
    this.providers = new Map(resolution.providers);
    this.defaultProviderId = resolution.defaultProviderId;
    this.policy = resolution.dataPolicy;
    this.warnings = resolution.warnings;
  }

  list(): AiProviderClient[] {
    return Array.from(this.providers.values());
  }

  get(providerId?: string): AiProviderClient | null {
    const id = providerId ?? this.defaultProviderId;
    if (!id) return null;
    return this.providers.get(id) ?? null;
  }

  require(providerId?: string): AiProviderClient {
    const client = this.get(providerId);
    if (client) return client;
    const requested = providerId ?? this.defaultProviderId ?? "(unset)";
    throw new Error(`AI provider "${requested}" is not configured`);
  }

  getDefaultProviderId(): string | undefined {
    return this.defaultProviderId;
  }

  getDataPolicy(): EffectiveAiDataPolicy {
    return this.policy;
  }

  combinePolicy(actionPolicy?: Partial<EffectiveAiDataPolicy>): EffectiveAiDataPolicy {
    return combineDataPolicies(this.policy, actionPolicy);
  }

  redact<T extends AiPayloadSlices>(
    payload: T,
    actionPolicy?: Partial<EffectiveAiDataPolicy>,
  ): AiRedactionResult<T> {
    const policy = this.combinePolicy(actionPolicy);
    return redactPayload(payload, policy);
  }

  prepareCall<T extends AiPayloadSlices>(
    options: AiPolicyOptions<T>,
  ): AiPolicyContext<T> {
    const provider = this.require(options.providerId);
    const redaction = this.redact(options.payload, options.actionPolicy);

    if (redaction.redacted.length > 0 && typeof options.onRedaction === "function") {
      try {
        options.onRedaction(redaction);
      } catch (error) {
        console.error("AiProviderRegistry onRedaction callback failed", error);
      }
    }

    return {
      provider,
      ...redaction,
    };
  }

  async callWithPolicy<T extends AiPayloadSlices, TResult>(
    options: AiPolicyOptions<T>,
    execute: AiCallExecutor<T, TResult>,
  ): Promise<AiCallResult<T, TResult>> {
    const prepared = this.prepareCall(options);
    const result = await execute(prepared);
    return { ...prepared, result };
  }
}

export function buildAiProviderRegistry(
  aiConfig: TakosAiConfig | undefined,
  env: EnvLookup,
): AiProviderRegistry {
  const resolution = resolveAiProviders(aiConfig, env);
  return new AiProviderRegistry(resolution);
}
