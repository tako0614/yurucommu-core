import type {
  AiAction,
  AiActionContext,
  AiActionDefinition,
  AiActionHandler,
  AiRegistry,
  AiProviderRegistry,
  JsonSchema,
  AiProviderClient,
  EffectiveAiDataPolicy,
  AiPayloadSlices,
  AiCallResult,
  AgentType,
} from "@takos/platform/server";
import { aiActionRegistry, chatCompletion } from "@takos/platform/server";
import type { ChatMessage } from "@takos/platform/server";
import type { AiAuditLogger } from "../lib/ai-audit";

type ChatActionInput = {
  messages: ChatMessage[];
  system?: string;
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  publicPosts?: unknown;
  communityPosts?: unknown;
  dmMessages?: unknown;
  profile?: unknown;
}

type ChatActionOutput = {
  provider: string | null;
  model: string | null;
  message: ChatMessage | null;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  redacted?: { field: string; reason: string }[];
  raw?: unknown;
  usedAi: boolean;
};

type SummaryInput = {
  text: string;
  maxSentences?: number;
  language?: string;
};

const chatMessageSchema: JsonSchema = {
  type: "object",
  properties: {
    role: { type: "string", enum: ["user", "assistant", "system"] },
    content: { type: "string" },
  },
  required: ["role", "content"],
  additionalProperties: false,
};

const chatInputSchema: JsonSchema = {
  type: "object",
  properties: {
    messages: {
      type: "array",
      items: chatMessageSchema,
      minItems: 1,
    },
    system: { type: "string", description: "Optional system prompt to prepend" },
    provider: { type: "string", description: "Provider ID to use for this call" },
    model: { type: "string", description: "Model ID to use for this call" },
    temperature: { type: "number", description: "Sampling temperature (0-2)" },
    maxTokens: { type: "number", description: "Max tokens to generate (1-8192)" },
    publicPosts: { type: ["object", "array", "string"] },
    communityPosts: { type: ["object", "array", "string"] },
    dmMessages: { type: ["object", "array", "string"] },
    profile: { type: ["object", "array", "string"] },
  },
  required: ["messages"],
  additionalProperties: false,
};

const chatOutputSchema: JsonSchema = {
  type: "object",
  properties: {
    provider: { type: ["string", "null"] },
    model: { type: ["string", "null"] },
    message: {
      anyOf: [chatMessageSchema, { type: "null" }],
    },
    usage: {
      type: "object",
      properties: {
        promptTokens: { type: "number" },
        completionTokens: { type: "number" },
        totalTokens: { type: "number" },
      },
      additionalProperties: true,
    },
    redacted: {
      type: "array",
      items: {
        type: "object",
        properties: {
          field: { type: "string" },
          reason: { type: "string" },
        },
        required: ["field", "reason"],
        additionalProperties: false,
      },
    },
    raw: {},
    usedAi: { type: "boolean" },
  },
  required: ["provider", "model", "message", "usedAi"],
};

type SummaryOutput = {
  summary: string;
  sentences: string[];
  originalLength: number;
  usedAi?: boolean;
};

type TagSuggestInput = {
  text: string;
  maxTags?: number;
};

type TagSuggestOutput = {
  tags: string[];
  usedAi?: boolean;
};

type TranslationInput = {
  text: string;
  targetLanguage: string;
  sourceLanguage?: string;
};

type TranslationOutput = {
  translatedText: string;
  detectedLanguage?: string;
  usedAi?: boolean;
};


type DmModeratorMessage = {
  from?: string;
  text?: string;
};

type DmModeratorInput = {
  messages: DmModeratorMessage[];
};

type DmModeratorOutput = {
  flagged: boolean;
  reasons: string[];
  summary?: string;
  usedAi?: boolean;
};

type PlanSnapshot = {
  features?: string[];
  limits?: Partial<{ aiRequests: number }>;
};

type ActionAuthContext = {
  userId: string | null;
  agentType: AgentType | null;
  plan: PlanSnapshot | null;
};

const resolveAuthContext = (ctx: AiActionContext): ActionAuthContext => {
  const auth = (ctx as any)?.auth ?? {};
  const user = (ctx as any)?.user;
  const appAuth = (ctx as any)?.appAuth;
  const userId =
    auth.userId ??
    auth.user_id ??
    appAuth?.userId ??
    (user && typeof (user as any).id === "string" ? (user as any).id : null) ??
    null;
  const agentType = (auth.agentType ?? (ctx as any)?.agentType ?? null) as AgentType | null;
  const plan =
    (auth.plan as PlanSnapshot | undefined) ??
    (appAuth?.plan
      ? {
          features: appAuth.plan.features ?? [],
          limits: { aiRequests: appAuth.plan.limits?.aiRequests },
        }
      : null);
  return { userId: userId ?? null, agentType, plan };
};

const getProviders = (ctx: AiActionContext): AiProviderRegistry | null => {
  const providers = (ctx as any)?.providers as AiProviderRegistry | undefined;
  return providers ?? null;
};

const getAuditLogger = (ctx: AiActionContext): AiAuditLogger | null => {
  const logger = (ctx as any)?.aiAudit;
  return typeof logger === "function" ? (logger as AiAuditLogger) : null;
};

function ensurePlanAllowsAi(ctx: AiActionContext): void {
  const { plan } = resolveAuthContext(ctx);
  if (!plan) return;
  const features = Array.isArray(plan.features) ? plan.features : [];
  if (!features.includes("*") && !features.includes("ai")) {
    throw new Error("PlanGuard: AI features require an upgraded plan");
  }
  const limit = plan.limits?.aiRequests;
  if (typeof limit === "number" && limit <= 0) {
    throw new Error("PlanGuard: AI request quota is unavailable for this plan");
  }
}

const AGENT_DATA_POLICY: Partial<Record<AgentType, Partial<EffectiveAiDataPolicy>>> = {
  user: { sendPublicPosts: true, sendCommunityPosts: true, sendDm: true, sendProfile: true },
  system: { sendPublicPosts: true, sendCommunityPosts: true, sendDm: true, sendProfile: true },
  dev: { sendPublicPosts: true, sendCommunityPosts: true, sendDm: false, sendProfile: true },
};

const applyAgentDataPolicy = (
  agentType: AgentType | null,
  policy: Partial<EffectiveAiDataPolicy>,
): Partial<EffectiveAiDataPolicy> => {
  const agentPolicy = agentType ? AGENT_DATA_POLICY[agentType] : null;
  if (!agentPolicy) return policy;
  const merged: Partial<EffectiveAiDataPolicy> = { ...policy };
  for (const key of ["sendPublicPosts", "sendCommunityPosts", "sendDm", "sendProfile"] as const) {
    if (agentPolicy[key] === false) {
      merged[key] = false;
    } else if (agentPolicy[key] === true && merged[key] === undefined) {
      merged[key] = true;
    }
  }
  return merged;
};

const buildActionPolicyFromPayload = (
  payload: AiPayloadSlices,
  basePolicy: Partial<EffectiveAiDataPolicy> = {},
  agentType: AgentType | null = null,
): Partial<EffectiveAiDataPolicy> => {
  const dynamicPolicy: Partial<EffectiveAiDataPolicy> = {
    ...basePolicy,
    sendPublicPosts: basePolicy.sendPublicPosts ?? hasPayloadSlice(payload.publicPosts),
    sendCommunityPosts: basePolicy.sendCommunityPosts ?? hasPayloadSlice(payload.communityPosts),
    sendDm: basePolicy.sendDm ?? hasPayloadSlice(payload.dmMessages),
    sendProfile: basePolicy.sendProfile ?? hasPayloadSlice(payload.profile),
  };
  return applyAgentDataPolicy(agentType, dynamicPolicy);
};

async function callProviderWithPolicy<TResult>(
  ctx: AiActionContext,
  params: {
    actionId: string;
    payload: AiPayloadSlices;
    actionPolicy: Partial<EffectiveAiDataPolicy>;
    providerId?: string;
    model?: string | null;
    execute: (provider: AiProviderClient) => Promise<TResult>;
  },
): Promise<AiCallResult<AiPayloadSlices, TResult> | null> {
  const providers = getProviders(ctx);
  if (!providers) return null;
  ensurePlanAllowsAi(ctx);

  const auditLog = getAuditLogger(ctx);
  const { userId, agentType } = resolveAuthContext(ctx);
  const actionPolicy = buildActionPolicyFromPayload(params.payload, params.actionPolicy, agentType);

  try {
    const call = await providers.callWithPolicy(
      {
        payload: params.payload,
        actionPolicy,
        providerId: params.providerId,
        actionId: params.actionId,
        onViolation: (report) => {
          auditLog?.({
            actionId: params.actionId,
            providerId: report.providerId ?? params.providerId ?? "(unknown)",
            model: params.model ?? null,
            policy: report.policy,
            redacted: [],
            agentType,
            userId,
            status: "blocked",
            error: "DataPolicyViolation",
          });
        },
      },
      async (prepared) => {
        await auditLog?.({
          actionId: params.actionId,
          providerId: prepared.provider.id,
          model: params.model ?? prepared.provider.model ?? null,
          policy: prepared.policy,
          redacted: prepared.redacted,
          agentType,
          userId,
          status: "attempt",
        });
        return params.execute(prepared.provider);
      },
    );

    await auditLog?.({
      actionId: params.actionId,
      providerId: call.provider.id,
      model: params.model ?? (call.result as any)?.model ?? call.provider.model ?? null,
      policy: call.policy,
      redacted: call.redacted,
      agentType,
      userId,
      status: "success",
    });

    return call;
  } catch (error: unknown) {
    auditLog?.({
      actionId: params.actionId,
      providerId: params.providerId ?? "(unknown)",
      model: params.model ?? null,
      policy: providers.combinePolicy(actionPolicy),
      redacted: [],
      agentType,
      userId,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

const summaryInputSchema: JsonSchema = {
  type: "object",
  properties: {
    text: { type: "string", description: "Content to summarize" },
    maxSentences: {
      type: "number",
      description: "Maximum number of sentences to include in the summary",
    },
    language: { type: "string", description: "Optional hint for the summary language" },
    objectIds: {
      type: "array",
      items: { type: "string" },
      description: "Optional list of object IDs to summarize (falls back to text when absent)",
    },
  },
  required: [],
  additionalProperties: false,
};

const summaryOutputSchema: JsonSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    sentences: { type: "array", items: { type: "string" } },
    originalLength: { type: "number" },
    usedAi: { type: "boolean" },
  },
  required: ["summary", "sentences", "originalLength"],
};

const tagSuggestInputSchema: JsonSchema = {
  type: "object",
  properties: {
    text: { type: "string", description: "Draft post content" },
    maxTags: { type: "number", description: "Maximum tags to return (default 5)" },
    objectIds: {
      type: "array",
      items: { type: "string" },
      description: "Optional list of object IDs to derive tags from",
    },
  },
  required: [],
  additionalProperties: false,
};

const tagSuggestOutputSchema: JsonSchema = {
  type: "object",
  properties: {
    tags: { type: "array", items: { type: "string" } },
    usedAi: { type: "boolean" },
  },
  required: ["tags"],
};

const translationInputSchema: JsonSchema = {
  type: "object",
  properties: {
    text: { type: "string", description: "Text to translate" },
    targetLanguage: { type: "string", description: "Target language code (e.g., 'en', 'ja', 'es')" },
    sourceLanguage: { type: "string", description: "Optional source language code" },
    objectIds: {
      type: "array",
      items: { type: "string" },
      description: "Optional list of object IDs to translate",
    },
  },
  required: ["targetLanguage"],
  additionalProperties: false,
};

const translationOutputSchema: JsonSchema = {
  type: "object",
  properties: {
    translatedText: { type: "string" },
    detectedLanguage: { type: "string" },
    usedAi: { type: "boolean" },
  },
  required: ["translatedText"],
};


const dmModeratorInputSchema: JsonSchema = {
  type: "object",
  properties: {
    messages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          from: { type: "string" },
          text: { type: "string" },
        },
        required: ["text"],
        additionalProperties: false,
      },
    },
  },
  required: ["messages"],
  additionalProperties: false,
};

const dmModeratorOutputSchema: JsonSchema = {
  type: "object",
  properties: {
    flagged: { type: "boolean" },
    reasons: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
    usedAi: { type: "boolean" },
  },
  required: ["flagged", "reasons"],
};

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "to",
  "was",
  "were",
  "will",
  "with",
]);

const DM_RED_FLAGS = ["scam", "spam", "abuse", "threat", "violence", "phish"];

const CHAT_ACTION_ID = "ai.chat";
const SUMMARY_ACTION_ID = "ai.summary";
const TAG_SUGGEST_ACTION_ID = "ai.tag-suggest";
const TRANSLATION_ACTION_ID = "ai.translation";
const DM_MODERATOR_ACTION_ID = "ai.dm-moderator";

const chatActionPolicy: Partial<EffectiveAiDataPolicy> = {
  notes: "Context slices (public/community/DM/profile) are optional and checked per-call.",
};
const summaryActionPolicy: Partial<EffectiveAiDataPolicy> = { sendPublicPosts: true };
const tagSuggestActionPolicy: Partial<EffectiveAiDataPolicy> = { sendPublicPosts: true };
const translationActionPolicy: Partial<EffectiveAiDataPolicy> = { sendPublicPosts: true };
const dmModeratorActionPolicy: Partial<EffectiveAiDataPolicy> = {
  sendDm: true,
  notes: "DM content is sent to AI provider for safety analysis.",
};

const ACTION_AGENT_ALLOWLIST: Partial<Record<string, AgentType[]>> = {
  [DM_MODERATOR_ACTION_ID]: ["system", "user", "dev"],
};

const ensureAgentAllowedForAction = (ctx: AiActionContext, actionId: string): void => {
  const allowed = ACTION_AGENT_ALLOWLIST[actionId];
  if (!allowed) return;
  const { agentType } = resolveAuthContext(ctx);
  if (!agentType) return;
  if (!allowed.includes(agentType)) {
    throw new Error(`AgentPolicyViolation: ${agentType} cannot run ${actionId}`);
  }
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const normalizeText = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const hasPayloadSlice = (value: unknown): boolean => {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
};

const normalizeChatMessages = (input: unknown): ChatMessage[] => {
  if (!Array.isArray(input)) return [];
  const allowedRoles = new Set<ChatMessage["role"]>(["user", "assistant", "system"]);
  const normalized: ChatMessage[] = [];

  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const roleRaw = (item as any).role;
    const content = normalizeText((item as any).content);
    if (!content) continue;
    const role = typeof roleRaw === "string" ? roleRaw.trim().toLowerCase() : "";
    if (!allowedRoles.has(role as ChatMessage["role"])) continue;
    normalized.push({ role: role as ChatMessage["role"], content });
  }

  return normalized;
};

const splitSentences = (text: string): string[] => {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
};

const buildSummaryFallback = (text: string, maxSentences: number): SummaryOutput => {
  const sentences = splitSentences(text);
  const limited = sentences.slice(0, maxSentences);
  const chosen = limited.length ? limited : [text.slice(0, 240).trim()];
  return {
    summary: chosen.join(" "),
    sentences: chosen,
    originalLength: text.length,
    usedAi: false,
  };
};

const pickTagsFallback = (text: string, maxTags: number): string[] => {
  const hashtags = Array.from(text.matchAll(/#([a-zA-Z0-9_]{2,})/g)).map((match) =>
    match[1].toLowerCase(),
  );
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .map((word) => word.trim())
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));

  const counts = new Map<string, number>();
  for (const word of words) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([word]) => word);
  const tags = Array.from(new Set([...hashtags, ...sorted]));
  return tags.slice(0, maxTags);
};

const summarizeDm = (messages: DmModeratorMessage[]): string => {
  const lastMessages = messages.slice(-3);
  return lastMessages
    .map((msg) => normalizeText(msg.text).slice(0, 140))
    .filter(Boolean)
    .join(" / ");
};

const buildChatFallback = (messages: ChatMessage[]): ChatMessage => {
  const lastUser = [...messages].reverse().find((msg) => msg.role === "user");
  if (lastUser?.content) {
    const snippet = lastUser.content.slice(0, 240);
    return { role: "assistant", content: `AI provider unavailable. Echoing: ${snippet}` };
  }
  return { role: "assistant", content: "AI provider unavailable." };
};

type ObjectPayloadResult = {
  payload: AiPayloadSlices;
  text: string;
  sourceIds: string[];
};

const normalizeObjectIds = (value: unknown): string[] => {
  if (typeof value === "string") {
    return value.trim() ? [value.trim()] : [];
  }
  if (Array.isArray(value)) {
    return value
      .map((id) => (typeof id === "string" ? id.trim() : ""))
      .filter((id) => id.length > 0);
  }
  return [];
};

const extractObjectText = (object: any): string => {
  if (!object) return "";
  if (typeof object === "string") return object;
  if (typeof object.content === "string") return object.content;
  if (object.content && typeof object.content === "object") {
    const nested = (object.content as any).content ?? (object.content as any).text;
    if (typeof nested === "string") return nested;
  }
  if (typeof object.summary === "string") return object.summary;
  return "";
};

const pushObjectText = (
  payload: AiPayloadSlices,
  text: string,
  visibility: string | null | undefined,
): void => {
  if (!text) return;
  const normalized = visibility?.toLowerCase?.() ?? "";
  if (normalized === "direct") {
    if (!Array.isArray(payload.dmMessages)) payload.dmMessages = [];
    (payload.dmMessages as string[]).push(text);
    return;
  }
  if (normalized === "community" || normalized === "followers") {
    if (!Array.isArray(payload.communityPosts)) payload.communityPosts = [];
    (payload.communityPosts as string[]).push(text);
    return;
  }
  if (!Array.isArray(payload.publicPosts)) payload.publicPosts = [];
  (payload.publicPosts as string[]).push(text);
};

async function resolveObjectPayload(
  ctx: AiActionContext,
  rawIds: unknown,
): Promise<ObjectPayloadResult | null> {
  const ids = normalizeObjectIds(rawIds);
  if (!ids.length) return null;
  const objects = (ctx as any)?.services?.objects;
  const appAuth = (ctx as any)?.appAuth;
  if (!objects || !appAuth) return null;

  const payload: AiPayloadSlices = {};
  const texts: string[] = [];

  for (const id of ids) {
    let object = await objects.get(appAuth, id).catch(() => null);
    if (!object && typeof objects.getByLocalId === "function") {
      object = await objects.getByLocalId(appAuth, id).catch(() => null);
    }
    if (!object) continue;
    const text = extractObjectText(object);
    if (!text) continue;
    pushObjectText(payload, text, (object as any).visibility ?? null);
    texts.push(text);
  }

  if (!texts.length) return null;
  return { payload, text: texts.join("\n\n"), sourceIds: ids };
}

async function callAiProvider(
  client: AiProviderClient,
  messages: ChatMessage[],
): Promise<string | null> {
  try {
    const result = await chatCompletion(client, messages, {
      temperature: 0.7,
      maxTokens: 1024,
    });
    return result.choices[0]?.message?.content ?? null;
  } catch (error) {
    console.error("[ai-actions] Provider call failed:", error);
    return null;
  }
}

const chatActionHandler: AiActionHandler<ChatActionInput, ChatActionOutput> = async (ctx, input) => {
  const system = normalizeText(input?.system);
  const messages = normalizeChatMessages(input?.messages);
  if (system) {
    messages.unshift({ role: "system", content: system });
  }

  if (!messages.length) {
    throw new Error("messages are required for ai.chat");
  }

  const providerId = normalizeText(input?.provider) || undefined;
  const model = normalizeText(input?.model) || null;
  const temperature = typeof input?.temperature === "number"
    ? clamp(input.temperature, 0, 2)
    : undefined;
  const maxTokens = typeof input?.maxTokens === "number"
    ? clamp(Math.floor(input.maxTokens), 1, 8192)
    : undefined;

  const payload = {
    publicPosts: (input as any)?.publicPosts ?? (input as any)?.public_posts,
    communityPosts: (input as any)?.communityPosts ?? (input as any)?.community_posts,
    dmMessages: (input as any)?.dmMessages ?? (input as any)?.dm_messages,
    profile: (input as any)?.profile,
  };

  const actionPolicy = {
    sendPublicPosts: hasPayloadSlice(payload.publicPosts),
    sendCommunityPosts: hasPayloadSlice(payload.communityPosts),
    sendDm: hasPayloadSlice(payload.dmMessages),
    sendProfile: hasPayloadSlice(payload.profile),
  };

  try {
    const call = await callProviderWithPolicy(ctx, {
      actionId: CHAT_ACTION_ID,
      payload,
      actionPolicy,
      providerId,
      model,
      execute: async (provider) =>
        chatCompletion(provider, messages, {
          model: model ?? undefined,
          temperature,
          maxTokens,
        }),
    });

    if (call) {
      const completion = call.result;
      return {
        provider: completion.provider || call.provider.id,
        model: completion.model || model || call.provider.model || null,
        message: completion.choices[0]?.message ?? null,
        usage: completion.usage,
        raw: completion.raw,
        redacted: call.redacted.length
          ? call.redacted.map((r) => ({ field: String(r.field), reason: r.reason }))
          : undefined,
        usedAi: true,
      };
    }
  } catch (error: any) {
    const message = error?.message || "";
    if (/DataPolicyViolation/i.test(message) || /PlanGuard/i.test(message)) {
      throw error;
    }
    console.error("[ai-actions] ai.chat provider call failed:", error);
  }

  return {
    provider: null,
    model,
    message: buildChatFallback(messages),
    usedAi: false,
  };
};

const summaryHandler: AiActionHandler<SummaryInput, SummaryOutput> = async (ctx, input) => {
  const maxSentences = clamp(Number(input?.maxSentences) || 3, 1, 6);
  const language = input?.language || "";
  const objectIds = (input as any)?.objectIds ?? (input as any)?.object_ids;
  const objectContext = await resolveObjectPayload(ctx, objectIds);
  const text = normalizeText(input?.text);
  const contentParts = [text, objectContext?.text].filter(Boolean);
  const contentText = contentParts.join("\n\n");

  if (!contentText) {
    return { summary: "", sentences: [], originalLength: 0, usedAi: false };
  }

  const payload: AiPayloadSlices = objectContext?.payload ? { ...objectContext.payload } : {};
  if (text) {
    if (!Array.isArray(payload.publicPosts)) payload.publicPosts = [];
    (payload.publicPosts as string[]).push(text);
  }

  try {
    const call = await callProviderWithPolicy(ctx, {
      actionId: SUMMARY_ACTION_ID,
      payload,
      actionPolicy: summaryActionPolicy,
      execute: async (provider) => {
        const languageHint = language ? ` Respond in ${language}.` : "";
        const messages: ChatMessage[] = [
          {
            role: "system",
            content: `You are a helpful assistant that summarizes content concisely. Provide a summary in ${maxSentences} sentences or less.${languageHint} Return only the summary text, no additional commentary.`,
          },
          {
            role: "user",
            content: `Please summarize the following content:\n\n${contentText}`,
          },
        ];
        return callAiProvider(provider, messages);
      },
    });

    const aiResponse = call?.result ?? null;
    if (aiResponse) {
      const sentences = splitSentences(aiResponse);
      return {
        summary: aiResponse,
        sentences: sentences.length > 0 ? sentences : [aiResponse],
        originalLength: contentText.length,
        usedAi: true,
      };
    }
  } catch (error: any) {
    const message = error?.message || "";
    if (/DataPolicyViolation/i.test(message) || /PlanGuard/i.test(message)) {
      throw error;
    }
    console.error("[ai-actions] ai.summary provider call failed:", error);
  }

  // Fallback to simple sentence extraction
  return buildSummaryFallback(contentText, maxSentences);
};

const tagSuggestHandler: AiActionHandler<TagSuggestInput, TagSuggestOutput> = async (
  ctx,
  input,
) => {
  const objectIds = (input as any)?.objectIds ?? (input as any)?.object_ids;
  const objectContext = await resolveObjectPayload(ctx, objectIds);
  const text = normalizeText(input?.text);
  const contentText = [text, objectContext?.text].filter(Boolean).join("\n\n");

  if (!contentText) {
    return { tags: [], usedAi: false };
  }

  const maxTags = clamp(Number(input?.maxTags) || 5, 1, 12);
  const payload: AiPayloadSlices = objectContext?.payload ? { ...objectContext.payload } : {};
  if (text) {
    if (!Array.isArray(payload.publicPosts)) payload.publicPosts = [];
    (payload.publicPosts as string[]).push(text);
  }

  try {
    const call = await callProviderWithPolicy(ctx, {
      actionId: TAG_SUGGEST_ACTION_ID,
      payload,
      actionPolicy: tagSuggestActionPolicy,
      execute: async (provider) => {
        const messages: ChatMessage[] = [
          {
            role: "system",
            content: `You are a helpful assistant that suggests relevant hashtags for social media posts. Suggest up to ${maxTags} hashtags that are relevant, popular, and help with discoverability. Return only the hashtags, one per line, without the # symbol.`,
          },
          {
            role: "user",
            content: `Suggest hashtags for this post:\n\n${contentText}`,
          },
        ];
        return callAiProvider(provider, messages);
      },
    });

    const aiResponse = call?.result ?? null;
    if (aiResponse) {
      const tags = aiResponse
        .split(/[\n,]/)
        .map((tag) => tag.trim().replace(/^#/, "").toLowerCase())
        .filter((tag) => tag.length > 0 && tag.length <= 50)
        .slice(0, maxTags);

      if (tags.length > 0) {
        return { tags, usedAi: true };
      }
    }
  } catch (error: any) {
    const message = error?.message || "";
    if (/DataPolicyViolation/i.test(message) || /PlanGuard/i.test(message)) {
      throw error;
    }
    console.error("[ai-actions] ai.tag-suggest provider call failed:", error);
  }

  // Fallback to keyword extraction
  return { tags: pickTagsFallback(contentText, maxTags), usedAi: false };
};

const translationHandler: AiActionHandler<TranslationInput, TranslationOutput> = async (
  ctx,
  input,
) => {
  const targetLanguage = normalizeText(input?.targetLanguage);

  if (!targetLanguage) {
    return { translatedText: "", usedAi: false };
  }

  const objectIds = (input as any)?.objectIds ?? (input as any)?.object_ids;
  const objectContext = await resolveObjectPayload(ctx, objectIds);
  const text = normalizeText(input?.text);
  const contentText = [text, objectContext?.text].filter(Boolean).join("\n\n");

  if (!contentText) {
    return { translatedText: text || "", usedAi: false };
  }

  const sourceLanguage = input?.sourceLanguage;
  const payload: AiPayloadSlices = objectContext?.payload ? { ...objectContext.payload } : {};
  if (text) {
    if (!Array.isArray(payload.publicPosts)) payload.publicPosts = [];
    (payload.publicPosts as string[]).push(text);
  }

  try {
    const call = await callProviderWithPolicy(ctx, {
      actionId: TRANSLATION_ACTION_ID,
      payload,
      actionPolicy: translationActionPolicy,
      execute: async (provider) => {
        const sourceHint = sourceLanguage ? `from ${sourceLanguage} ` : "";
        const messages: ChatMessage[] = [
          {
            role: "system",
            content: `You are a professional translator. Translate the following text ${sourceHint}to ${targetLanguage}. Preserve the original meaning and tone. Return only the translated text, no additional commentary.`,
          },
          {
            role: "user",
            content: contentText,
          },
        ];
        return callAiProvider(provider, messages);
      },
    });

    const aiResponse = call?.result ?? null;
    if (aiResponse) {
      return {
        translatedText: aiResponse,
        detectedLanguage: sourceLanguage || "auto-detected",
        usedAi: true,
      };
    }
  } catch (error: any) {
    const message = error?.message || "";
    if (/DataPolicyViolation/i.test(message) || /PlanGuard/i.test(message)) {
      throw error;
    }
    console.error("[ai-actions] ai.translation provider call failed:", error);
  }

  // Fallback: return original text with a note
  return {
    translatedText: contentText,
    detectedLanguage: sourceLanguage || "unknown",
    usedAi: false,
  };
};


const dmModeratorHandler: AiActionHandler<DmModeratorInput, DmModeratorOutput> = async (
  ctx,
  input,
) => {
  const messages = Array.isArray(input?.messages) ? input.messages : [];
  ensureAgentAllowedForAction(ctx, DM_MODERATOR_ACTION_ID);
  const normalized = messages
    .map((msg) => ({ from: normalizeText(msg.from), text: normalizeText(msg.text) }))
    .filter((msg) => msg.text.length > 0);

  if (normalized.length === 0) {
    return { flagged: false, reasons: [], usedAi: false };
  }

  // First, do quick keyword-based checks (always run, even with AI)
  const quickReasons = new Set<string>();
  for (const msg of normalized) {
    const text = msg.text.toLowerCase();
    for (const flag of DM_RED_FLAGS) {
      if (text.includes(flag)) {
        quickReasons.add(`contains_${flag}`);
      }
    }
    if (text.length > 1000) {
      quickReasons.add("very_long_message");
    }
  }

  try {
    const call = await callProviderWithPolicy(ctx, {
      actionId: DM_MODERATOR_ACTION_ID,
      payload: { dmMessages: normalized },
      actionPolicy: dmModeratorActionPolicy,
      execute: async (provider) => {
        const conversationText = normalized
          .map((msg) => `${msg.from || "Unknown"}: ${msg.text}`)
          .join("\n");

        const chatMessages: ChatMessage[] = [
          {
            role: "system",
            content: `You are a content moderation assistant. Analyze the following conversation for potential safety issues such as:
- Scams or phishing attempts
- Harassment or threats
- Spam or unwanted solicitation
- Inappropriate or harmful content

Respond in JSON format with the following structure:
{
  "flagged": true/false,
  "reasons": ["reason1", "reason2"],
  "summary": "brief summary of the conversation and any concerns"
}

Be conservative - only flag content that has clear safety issues. Return valid JSON only.`,
          },
          {
            role: "user",
            content: `Analyze this conversation:\n\n${conversationText}`,
          },
        ];

        return callAiProvider(provider, chatMessages);
      },
    });

    const aiResponse = call?.result ?? null;
    if (aiResponse) {
      try {
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as {
            flagged?: boolean;
            reasons?: string[];
            summary?: string;
          };

          const allReasons = Array.from(new Set([...quickReasons, ...(parsed.reasons || [])]));

          return {
            flagged: parsed.flagged === true || quickReasons.size > 0,
            reasons: allReasons,
            summary: parsed.summary || summarizeDm(normalized),
            usedAi: true,
          };
        }
      } catch {
        // JSON parsing failed, fall through to keyword-based result
      }
    }
  } catch (error: any) {
    const message = error?.message || "";
    if (/DataPolicyViolation/i.test(message) || /PlanGuard/i.test(message)) {
      throw error;
    }
    console.error("[ai-actions] ai.dm-moderator provider call failed:", error);
  }

  // Fallback to keyword-based analysis
  const flagged = quickReasons.size > 0;
  const summary = summarizeDm(normalized);

  return {
    flagged,
    reasons: Array.from(quickReasons),
    ...(summary ? { summary } : {}),
    usedAi: false,
  };
};

const chatAction: AiAction<ChatActionInput, ChatActionOutput> = {
  definition: {
    id: CHAT_ACTION_ID,
    label: "AI chat",
    description: "General chat completion with optional context slices and provider selection.",
    inputSchema: chatInputSchema,
    outputSchema: chatOutputSchema,
    providerCapabilities: ["chat"],
    dataPolicy: chatActionPolicy,
  },
  handler: chatActionHandler,
};

const summaryAction: AiAction<SummaryInput, SummaryOutput> = {
  definition: {
    id: SUMMARY_ACTION_ID,
    label: "Summarize content",
    description: "Summarize public posts or timelines into a concise digest using AI when available.",
    inputSchema: summaryInputSchema,
    outputSchema: summaryOutputSchema,
    providerCapabilities: ["chat"],
    dataPolicy: summaryActionPolicy,
  },
  handler: summaryHandler,
};

const tagSuggestAction: AiAction<TagSuggestInput, TagSuggestOutput> = {
  definition: {
    id: TAG_SUGGEST_ACTION_ID,
    label: "Hashtag suggestions",
    description: "Suggest relevant hashtags for a draft post using AI when available.",
    inputSchema: tagSuggestInputSchema,
    outputSchema: tagSuggestOutputSchema,
    providerCapabilities: ["chat"],
    dataPolicy: tagSuggestActionPolicy,
  },
  handler: tagSuggestHandler,
};

const translationAction: AiAction<TranslationInput, TranslationOutput> = {
  definition: {
    id: TRANSLATION_ACTION_ID,
    label: "Translate content",
    description: "Translate text content to a target language using AI.",
    inputSchema: translationInputSchema,
    outputSchema: translationOutputSchema,
    providerCapabilities: ["chat"],
    dataPolicy: translationActionPolicy,
  },
  handler: translationHandler,
};

const dmModeratorAction: AiAction<DmModeratorInput, DmModeratorOutput> = {
  definition: {
    id: DM_MODERATOR_ACTION_ID,
    label: "DM safety review",
    description: "Review DM conversations for safety issues using AI-powered analysis.",
    inputSchema: dmModeratorInputSchema,
    outputSchema: dmModeratorOutputSchema,
    providerCapabilities: ["chat"],
    dataPolicy: dmModeratorActionPolicy,
  },
  handler: dmModeratorHandler,
};

export const builtinAiActions: AiAction<unknown, unknown>[] = [
  chatAction as AiAction<unknown, unknown>,
  summaryAction as AiAction<unknown, unknown>,
  tagSuggestAction as AiAction<unknown, unknown>,
  translationAction as AiAction<unknown, unknown>,
  dmModeratorAction as AiAction<unknown, unknown>,
];


export function registerBuiltinAiActions(registry: AiRegistry = aiActionRegistry): void {
  for (const action of builtinAiActions) {
    const existing = registry.getAction(action.definition.id);
    if (existing) continue;
    registry.register(action);
  }
}

export function getBuiltinActionDefinitions(): AiActionDefinition[] {
  return builtinAiActions.map((action) => action.definition);
}

export function getDefaultProviderId(providers?: AiProviderRegistry | null): string | undefined {
  if (!providers) return undefined;
  return providers.getDefaultProviderId();
}
