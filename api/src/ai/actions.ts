import type {
  AiAction,
  AiActionDefinition,
  AiActionHandler,
  AiRegistry,
  AiProviderRegistry,
  JsonSchema,
} from "@takos/platform/server";
import { aiActionRegistry } from "@takos/platform/server";

type SummaryInput = {
  text: string;
  maxSentences?: number;
  language?: string;
};

type SummaryOutput = {
  summary: string;
  sentences: string[];
  originalLength: number;
};

type TagSuggestInput = {
  text: string;
  maxTags?: number;
};

type TagSuggestOutput = {
  tags: string[];
};

type TranslationInput = {
  text: string;
  targetLanguage: string;
  sourceLanguage?: string;
};

type TranslationOutput = {
  translatedText: string;
  detectedLanguage?: string;
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
  },
  required: ["text"],
  additionalProperties: false,
};

const summaryOutputSchema: JsonSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    sentences: { type: "array", items: { type: "string" } },
    originalLength: { type: "number" },
  },
  required: ["summary", "sentences", "originalLength"],
};

const tagSuggestInputSchema: JsonSchema = {
  type: "object",
  properties: {
    text: { type: "string", description: "Draft post content" },
    maxTags: { type: "number", description: "Maximum tags to return (default 5)" },
  },
  required: ["text"],
  additionalProperties: false,
};

const tagSuggestOutputSchema: JsonSchema = {
  type: "object",
  properties: {
    tags: { type: "array", items: { type: "string" } },
  },
  required: ["tags"],
};

const translationInputSchema: JsonSchema = {
  type: "object",
  properties: {
    text: { type: "string", description: "Text to translate" },
    targetLanguage: { type: "string", description: "Target language code (e.g., 'en', 'ja', 'es')" },
    sourceLanguage: { type: "string", description: "Optional source language code" },
  },
  required: ["text", "targetLanguage"],
  additionalProperties: false,
};

const translationOutputSchema: JsonSchema = {
  type: "object",
  properties: {
    translatedText: { type: "string" },
    detectedLanguage: { type: "string" },
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

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const normalizeText = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const splitSentences = (text: string): string[] => {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
};

const buildSummary = (text: string, maxSentences: number): SummaryOutput => {
  const sentences = splitSentences(text);
  const limited = sentences.slice(0, maxSentences);
  const chosen = limited.length ? limited : [text.slice(0, 240).trim()];
  return {
    summary: chosen.join(" "),
    sentences: chosen,
    originalLength: text.length,
  };
};

const pickTags = (text: string, maxTags: number): string[] => {
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

const summaryHandler: AiActionHandler<SummaryInput, SummaryOutput> = async (_ctx, input) => {
  const text = normalizeText(input?.text);
  if (!text) {
    return { summary: "", sentences: [], originalLength: 0 };
  }
  const maxSentences = clamp(Number(input?.maxSentences) || 3, 1, 6);
  return buildSummary(text, maxSentences);
};

const tagSuggestHandler: AiActionHandler<TagSuggestInput, TagSuggestOutput> = async (
  _ctx,
  input,
) => {
  const text = normalizeText(input?.text);
  if (!text) {
    return { tags: [] };
  }
  const maxTags = clamp(Number(input?.maxTags) || 5, 1, 12);
  return { tags: pickTags(text, maxTags) };
};

const translationHandler: AiActionHandler<TranslationInput, TranslationOutput> = async (
  ctx,
  input,
) => {
  const text = normalizeText(input?.text);
  const targetLanguage = normalizeText(input?.targetLanguage);

  if (!text || !targetLanguage) {
    return { translatedText: text || "" };
  }

  // For now, this is a placeholder that would be enhanced by actual AI provider
  // In a real implementation, this would call the AI provider to translate
  // The AI provider integration would happen through ctx.provider

  // Simple passthrough for now - in production this would use the AI provider
  return {
    translatedText: text,
    detectedLanguage: input?.sourceLanguage || "unknown",
  };
};


const dmModeratorHandler: AiActionHandler<DmModeratorInput, DmModeratorOutput> = async (
  _ctx,
  input,
) => {
  const messages = Array.isArray(input?.messages) ? input.messages : [];
  const normalized = messages
    .map((msg) => ({ from: normalizeText(msg.from), text: normalizeText(msg.text) }))
    .filter((msg) => msg.text.length > 0);

  const reasons = new Set<string>();
  for (const msg of normalized) {
    const text = msg.text.toLowerCase();
    for (const flag of DM_RED_FLAGS) {
      if (text.includes(flag)) {
        reasons.add(`contains_${flag}`);
      }
    }
    if (text.length > 1000) {
      reasons.add("very_long_message");
    }
  }

  const flagged = reasons.size > 0;
  const summary = summarizeDm(normalized);

  return {
    flagged,
    reasons: Array.from(reasons),
    ...(summary ? { summary } : {}),
  };
};

const summaryAction: AiAction<SummaryInput, SummaryOutput> = {
  definition: {
    id: "ai.summary",
    label: "Summarize content",
    description: "Summarize public posts or timelines into a concise digest.",
    inputSchema: summaryInputSchema,
    outputSchema: summaryOutputSchema,
    providerCapabilities: ["chat"],
    dataPolicy: {
      sendPublicPosts: true,
    },
  },
  handler: summaryHandler,
};

const tagSuggestAction: AiAction<TagSuggestInput, TagSuggestOutput> = {
  definition: {
    id: "ai.tag-suggest",
    label: "Hashtag suggestions",
    description: "Suggest tags for a draft post based on its text and media descriptions.",
    inputSchema: tagSuggestInputSchema,
    outputSchema: tagSuggestOutputSchema,
    providerCapabilities: ["chat"],
    dataPolicy: {
      sendPublicPosts: true,
    },
  },
  handler: tagSuggestHandler,
};

const translationAction: AiAction<TranslationInput, TranslationOutput> = {
  definition: {
    id: "ai.translation",
    label: "Translate content",
    description: "Translate text content to a target language.",
    inputSchema: translationInputSchema,
    outputSchema: translationOutputSchema,
    providerCapabilities: ["chat"],
    dataPolicy: {
      sendPublicPosts: true,
    },
  },
  handler: translationHandler,
};

const dmModeratorAction: AiAction<DmModeratorInput, DmModeratorOutput> = {
  definition: {
    id: "ai.dm-moderator",
    label: "DM safety review",
    description: "Review or summarize DM conversations for safety or moderation support.",
    inputSchema: dmModeratorInputSchema,
    outputSchema: dmModeratorOutputSchema,
    providerCapabilities: ["chat"],
    dataPolicy: {
      sendDm: true,
      notes: "DM content may be inspected for safety signals before invoking a provider.",
    },
  },
  handler: dmModeratorHandler,
};

export const builtinAiActions: AiAction<unknown, unknown>[] = [
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
