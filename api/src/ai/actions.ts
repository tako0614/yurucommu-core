import type {
  AiAction,
  AiActionContext,
  AiActionDefinition,
  AiActionHandler,
  AiRegistry,
  AiProviderRegistry,
  JsonSchema,
  AiProviderClient,
} from "@takos/platform/server";
import { aiActionRegistry, chatCompletion } from "@takos/platform/server";
import type { ChatMessage } from "@takos/platform/server";

type SummaryInput = {
  text: string;
  maxSentences?: number;
  language?: string;
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
    usedAi: { type: "boolean" },
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
  },
  required: ["text", "targetLanguage"],
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

/**
 * Get AI provider client from context if available
 */
function getProviderClient(ctx: AiActionContext): AiProviderClient | null {
  const providers = ctx.providers as AiProviderRegistry | undefined;
  if (!providers) return null;
  try {
    return providers.require();
  } catch {
    return null;
  }
}

/**
 * Call AI provider for chat completion
 */
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

const summaryHandler: AiActionHandler<SummaryInput, SummaryOutput> = async (ctx, input) => {
  const text = normalizeText(input?.text);
  if (!text) {
    return { summary: "", sentences: [], originalLength: 0, usedAi: false };
  }

  const maxSentences = clamp(Number(input?.maxSentences) || 3, 1, 6);
  const language = input?.language || "";

  // Try to use AI provider if available
  const client = getProviderClient(ctx);
  if (client) {
    const languageHint = language ? ` Respond in ${language}.` : "";
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: `You are a helpful assistant that summarizes content concisely. Provide a summary in ${maxSentences} sentences or less.${languageHint} Return only the summary text, no additional commentary.`,
      },
      {
        role: "user",
        content: `Please summarize the following content:\n\n${text}`,
      },
    ];

    const aiResponse = await callAiProvider(client, messages);
    if (aiResponse) {
      const sentences = splitSentences(aiResponse);
      return {
        summary: aiResponse,
        sentences: sentences.length > 0 ? sentences : [aiResponse],
        originalLength: text.length,
        usedAi: true,
      };
    }
  }

  // Fallback to simple sentence extraction
  return buildSummaryFallback(text, maxSentences);
};

const tagSuggestHandler: AiActionHandler<TagSuggestInput, TagSuggestOutput> = async (
  ctx,
  input,
) => {
  const text = normalizeText(input?.text);
  if (!text) {
    return { tags: [], usedAi: false };
  }

  const maxTags = clamp(Number(input?.maxTags) || 5, 1, 12);

  // Try to use AI provider if available
  const client = getProviderClient(ctx);
  if (client) {
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: `You are a helpful assistant that suggests relevant hashtags for social media posts. Suggest up to ${maxTags} hashtags that are relevant, popular, and help with discoverability. Return only the hashtags, one per line, without the # symbol.`,
      },
      {
        role: "user",
        content: `Suggest hashtags for this post:\n\n${text}`,
      },
    ];

    const aiResponse = await callAiProvider(client, messages);
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
  }

  // Fallback to keyword extraction
  return { tags: pickTagsFallback(text, maxTags), usedAi: false };
};

const translationHandler: AiActionHandler<TranslationInput, TranslationOutput> = async (
  ctx,
  input,
) => {
  const text = normalizeText(input?.text);
  const targetLanguage = normalizeText(input?.targetLanguage);

  if (!text || !targetLanguage) {
    return { translatedText: text || "", usedAi: false };
  }

  const sourceLanguage = input?.sourceLanguage;

  // Try to use AI provider if available
  const client = getProviderClient(ctx);
  if (client) {
    const sourceHint = sourceLanguage
      ? `from ${sourceLanguage} `
      : "";
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: `You are a professional translator. Translate the following text ${sourceHint}to ${targetLanguage}. Preserve the original meaning and tone. Return only the translated text, no additional commentary.`,
      },
      {
        role: "user",
        content: text,
      },
    ];

    const aiResponse = await callAiProvider(client, messages);
    if (aiResponse) {
      return {
        translatedText: aiResponse,
        detectedLanguage: sourceLanguage || "auto-detected",
        usedAi: true,
      };
    }
  }

  // Fallback: return original text with a note
  return {
    translatedText: text,
    detectedLanguage: sourceLanguage || "unknown",
    usedAi: false,
  };
};


const dmModeratorHandler: AiActionHandler<DmModeratorInput, DmModeratorOutput> = async (
  ctx,
  input,
) => {
  const messages = Array.isArray(input?.messages) ? input.messages : [];
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

  // Try to use AI provider for more sophisticated analysis
  const client = getProviderClient(ctx);
  if (client) {
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

    const aiResponse = await callAiProvider(client, chatMessages);
    if (aiResponse) {
      try {
        // Try to parse JSON response
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as {
            flagged?: boolean;
            reasons?: string[];
            summary?: string;
          };

          const allReasons = Array.from(
            new Set([
              ...quickReasons,
              ...(parsed.reasons || []),
            ]),
          );

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

const summaryAction: AiAction<SummaryInput, SummaryOutput> = {
  definition: {
    id: "ai.summary",
    label: "Summarize content",
    description: "Summarize public posts or timelines into a concise digest using AI when available.",
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
    description: "Suggest relevant hashtags for a draft post using AI when available.",
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
    description: "Translate text content to a target language using AI.",
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
    description: "Review DM conversations for safety issues using AI-powered analysis.",
    inputSchema: dmModeratorInputSchema,
    outputSchema: dmModeratorOutputSchema,
    providerCapabilities: ["chat"],
    dataPolicy: {
      sendDm: true,
      notes: "DM content is sent to AI provider for safety analysis.",
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
