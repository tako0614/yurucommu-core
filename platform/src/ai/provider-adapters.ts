/**
 * AI Provider Adapters
 *
 * This module provides unified adapters for different AI providers.
 * Each provider has its own API format, but we normalize them to a
 * common interface for consistent usage throughout the application.
 *
 * Supported providers:
 * - OpenAI (and OpenAI-compatible APIs)
 * - Claude (Anthropic)
 * - Gemini (Google)
 * - OpenRouter
 */

import type { AiProviderClient } from "./provider-registry.js";
import type { AiProviderType } from "../config/takos-config.js";

// Common types for AI interactions

export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ChatMessage = {
  role: ChatRole;
  content: string;
  tool_calls?: unknown;
  tool_call_id?: string;
};

export type ChatCompletionOptions = {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stream?: boolean;
  tools?: unknown;
  toolChoice?: unknown;
  responseFormat?: unknown;
};

export type ChatCompletionChoice = {
  index: number;
  message: ChatMessage;
  finishReason: string | null;
};

export type ChatCompletionUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type ChatCompletionResult = {
  id: string;
  provider: string;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: ChatCompletionUsage;
  raw?: unknown;
};

export type StreamChunk = {
  id: string;
  delta: {
    role?: ChatRole;
    content?: string;
  };
  finishReason: string | null;
};

export type StreamCallback = (chunk: StreamChunk) => void;

export type ChatCompletionStreamResult = {
  id: string;
  provider: string;
  model: string;
  stream: ReadableStream<Uint8Array>;
};

// Embedding types

export type EmbeddingOptions = {
  model?: string;
  dimensions?: number;
};

export type EmbeddingData = {
  index: number;
  embedding: number[];
};

export type EmbeddingUsage = {
  promptTokens: number;
  totalTokens: number;
};

export type EmbeddingResult = {
  provider: string;
  model: string;
  embeddings: EmbeddingData[];
  usage?: EmbeddingUsage;
  raw?: unknown;
};

// Provider adapter interface

export interface AiProviderAdapter {
  readonly type: AiProviderType;

  chatCompletion(
    client: AiProviderClient,
    messages: ChatMessage[],
    options?: ChatCompletionOptions,
  ): Promise<ChatCompletionResult>;

  chatCompletionStream(
    client: AiProviderClient,
    messages: ChatMessage[],
    options?: ChatCompletionOptions,
  ): Promise<ChatCompletionStreamResult>;

  embed(
    client: AiProviderClient,
    input: string | string[],
    options?: EmbeddingOptions,
  ): Promise<EmbeddingResult>;
}

// OpenAI adapter (also works for OpenAI-compatible and OpenRouter)

type OpenAiMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: unknown;
  tool_call_id?: string;
};

type OpenAiRequest = {
  model: string;
  messages: OpenAiMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
  tools?: unknown;
  tool_choice?: unknown;
  response_format?: unknown;
};

type OpenAiChoice = {
  index: number;
  message: {
    role: string;
    content: string;
    tool_calls?: unknown;
  };
  finish_reason: string | null;
};

type OpenAiUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

type OpenAiResponse = {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAiChoice[];
  usage?: OpenAiUsage;
};

type OpenAiEmbeddingRequest = {
  model: string;
  input: string | string[];
  dimensions?: number;
  encoding_format?: "float" | "base64";
};

type OpenAiEmbeddingData = {
  object: "embedding";
  index: number;
  embedding: number[];
};

type OpenAiEmbeddingUsage = {
  prompt_tokens: number;
  total_tokens: number;
};

type OpenAiEmbeddingResponse = {
  object: "list";
  data: OpenAiEmbeddingData[];
  model: string;
  usage: OpenAiEmbeddingUsage;
};

export class OpenAiAdapter implements AiProviderAdapter {
  readonly type: AiProviderType = "openai";

  async chatCompletion(
    client: AiProviderClient,
    messages: ChatMessage[],
    options?: ChatCompletionOptions,
  ): Promise<ChatCompletionResult> {
    const model = options?.model ?? client.model;
    if (!model) {
      throw new Error("Model is required for OpenAI chat completion");
    }

    const baseUrl = client.baseUrl.replace(/\/$/, "");
    const url = `${baseUrl}/chat/completions`;

    const body: OpenAiRequest = {
      model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        tool_calls: (m as any)?.tool_calls,
        tool_call_id: (m as any)?.tool_call_id,
      })),
      stream: false,
    };

    if (options?.temperature !== undefined) {
      body.temperature = options.temperature;
    }
    if (options?.maxTokens !== undefined) {
      body.max_tokens = options.maxTokens;
    }
    if (options?.topP !== undefined) {
      body.top_p = options.topP;
    }
    if (options?.tools !== undefined) {
      body.tools = options.tools;
    }
    if (options?.toolChoice !== undefined) {
      body.tool_choice = options.toolChoice;
    }
    if (options?.responseFormat !== undefined) {
      body.response_format = options.responseFormat;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...client.headers,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `OpenAI API error (${response.status}): ${errorText || response.statusText}`,
      );
    }

    const data = (await response.json()) as OpenAiResponse;

    return {
      id: data.id,
      provider: client.id,
      model: data.model,
      choices: data.choices.map((choice) => ({
        index: choice.index,
        message: {
          role: choice.message.role as ChatRole,
          content: choice.message.content,
          tool_calls: (choice.message as any)?.tool_calls,
        },
        finishReason: choice.finish_reason,
      })),
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
      raw: data,
    };
  }

  async chatCompletionStream(
    client: AiProviderClient,
    messages: ChatMessage[],
    options?: ChatCompletionOptions,
  ): Promise<ChatCompletionStreamResult> {
    const model = options?.model ?? client.model;
    if (!model) {
      throw new Error("Model is required for OpenAI chat completion");
    }

    const baseUrl = client.baseUrl.replace(/\/$/, "");
    const url = `${baseUrl}/chat/completions`;

    const body: OpenAiRequest = {
      model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        tool_calls: (m as any)?.tool_calls,
        tool_call_id: (m as any)?.tool_call_id,
      })),
      stream: true,
    };

    if (options?.temperature !== undefined) {
      body.temperature = options.temperature;
    }
    if (options?.maxTokens !== undefined) {
      body.max_tokens = options.maxTokens;
    }
    if (options?.topP !== undefined) {
      body.top_p = options.topP;
    }
    if (options?.tools !== undefined) {
      body.tools = options.tools;
    }
    if (options?.toolChoice !== undefined) {
      body.tool_choice = options.toolChoice;
    }
    if (options?.responseFormat !== undefined) {
      body.response_format = options.responseFormat;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...client.headers,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `OpenAI API error (${response.status}): ${errorText || response.statusText}`,
      );
    }

    if (!response.body) {
      throw new Error("OpenAI streaming response has no body");
    }

    return {
      id: `stream-${Date.now()}`,
      provider: client.id,
      model,
      stream: response.body,
    };
  }

  async embed(
    client: AiProviderClient,
    input: string | string[],
    options?: EmbeddingOptions,
  ): Promise<EmbeddingResult> {
    const model = options?.model ?? "text-embedding-3-small";

    const baseUrl = client.baseUrl.replace(/\/$/, "");
    const url = `${baseUrl}/embeddings`;

    const body: OpenAiEmbeddingRequest = {
      model,
      input,
      encoding_format: "float",
    };

    if (options?.dimensions !== undefined) {
      body.dimensions = options.dimensions;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...client.headers,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `OpenAI Embedding API error (${response.status}): ${errorText || response.statusText}`,
      );
    }

    const data = (await response.json()) as OpenAiEmbeddingResponse;

    return {
      provider: client.id,
      model: data.model,
      embeddings: data.data.map((item) => ({
        index: item.index,
        embedding: item.embedding,
      })),
      usage: {
        promptTokens: data.usage.prompt_tokens,
        totalTokens: data.usage.total_tokens,
      },
      raw: data,
    };
  }
}

// Claude (Anthropic) adapter

type ClaudeRequestContentBlock =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input?: unknown;
    }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    };

type ClaudeMessage = {
  role: "user" | "assistant";
  content: ClaudeRequestContentBlock[];
};

type ClaudeRequest = {
  model: string;
  messages: ClaudeMessage[];
  system?: string;
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  tools?: unknown;
  tool_choice?: unknown;
};

type ClaudeContentBlock =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input?: unknown;
    };

type ClaudeResponse = {
  id: string;
  type: "message";
  role: "assistant";
  content: ClaudeContentBlock[];
  model: string;
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
};

export class ClaudeAdapter implements AiProviderAdapter {
  readonly type: AiProviderType = "claude";

  private parseToolArgs(raw: unknown): unknown {
    if (typeof raw !== "string" || raw.trim() === "") return {};
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  private normalizeTools(options?: ChatCompletionOptions): { tools?: unknown; tool_choice?: unknown } {
    const rawTools = options?.tools;
    if (!Array.isArray(rawTools) || rawTools.length === 0) return {};

    const converted: Array<{ name: string; description?: string; input_schema?: unknown }> = [];
    for (const item of rawTools as any[]) {
      const maybeFunction = item?.type === "function" ? item?.function : null;
      const name = typeof maybeFunction?.name === "string" ? maybeFunction.name.trim() : "";
      if (!name) continue;
      const description = typeof maybeFunction?.description === "string" ? maybeFunction.description : undefined;
      const inputSchema = maybeFunction?.parameters ?? {};
      converted.push({ name, description, input_schema: inputSchema });
    }

    if (converted.length === 0) {
      // If tools are not OpenAI-style, pass through as-is (advanced usage).
      return { tools: rawTools };
    }

    const toolChoice = options?.toolChoice;
    if (toolChoice === "none") {
      return {};
    }
    if (toolChoice && typeof toolChoice === "object") {
      const forced = (toolChoice as any)?.function?.name ?? (toolChoice as any)?.name;
      const forcedName = typeof forced === "string" ? forced.trim() : "";
      if (forcedName) {
        return { tools: converted, tool_choice: { type: "tool", name: forcedName } };
      }
    }
    // default/auto
    return { tools: converted, tool_choice: { type: "auto" } };
  }

  async chatCompletion(
    client: AiProviderClient,
    messages: ChatMessage[],
    options?: ChatCompletionOptions,
  ): Promise<ChatCompletionResult> {
    const model = options?.model ?? client.model;
    if (!model) {
      throw new Error("Model is required for Claude chat completion");
    }

    const baseUrl = client.baseUrl.replace(/\/$/, "");
    const url = `${baseUrl}/messages`;

    // Extract system message and convert to Claude format
    let systemPrompt: string | undefined;
    const claudeMessages: ClaudeMessage[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        systemPrompt = msg.content;
        continue;
      }
      if (msg.role === "tool") {
        const toolUseId = typeof (msg as any)?.tool_call_id === "string"
          ? (msg as any).tool_call_id
          : null;
        if (!toolUseId) continue;
        claudeMessages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: toolUseId,
              content: msg.content,
            },
          ],
        });
        continue;
      }

      if (msg.role === "assistant") {
        const blocks: ClaudeRequestContentBlock[] = [];
        if (msg.content) {
          blocks.push({ type: "text", text: msg.content });
        }
        const toolCalls = (msg as any)?.tool_calls;
        if (Array.isArray(toolCalls)) {
          for (const call of toolCalls) {
            const id = typeof call?.id === "string" && call.id.trim()
              ? call.id
              : `toolu_${Date.now()}`;
            const name = typeof call?.function?.name === "string" ? call.function.name : "";
            if (!name) continue;
            blocks.push({
              type: "tool_use",
              id,
              name,
              input: this.parseToolArgs(call?.function?.arguments),
            });
          }
        }
        if (blocks.length === 0) continue;
        claudeMessages.push({ role: "assistant", content: blocks });
        continue;
      }

      // user
      if (!msg.content) continue;
      claudeMessages.push({ role: "user", content: [{ type: "text", text: msg.content }] });
    }

    const body: ClaudeRequest = {
      model,
      messages: claudeMessages,
      max_tokens: options?.maxTokens ?? 4096,
      stream: false,
    };

    if (systemPrompt) {
      body.system = systemPrompt;
    }
    if (options?.temperature !== undefined) {
      body.temperature = options.temperature;
    }
    if (options?.topP !== undefined) {
      body.top_p = options.topP;
    }
    const toolPayload = this.normalizeTools(options);
    if (toolPayload.tools !== undefined) {
      body.tools = toolPayload.tools;
    }
    if (toolPayload.tool_choice !== undefined) {
      body.tool_choice = toolPayload.tool_choice;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        ...client.headers,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `Claude API error (${response.status}): ${errorText || response.statusText}`,
      );
    }

    const data = (await response.json()) as ClaudeResponse;

    const textContent = data.content
      .filter((block): block is Extract<ClaudeContentBlock, { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join("");

    const toolCalls = data.content
      .filter((block): block is Extract<ClaudeContentBlock, { type: "tool_use" }> => block.type === "tool_use")
      .map((block) => ({
        id: block.id,
        type: "function",
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input ?? {}),
        },
      }));

    return {
      id: data.id,
      provider: client.id,
      model: data.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: textContent,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          },
          finishReason: toolCalls.length > 0 ? "tool_calls" : data.stop_reason,
        },
      ],
      usage: {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
      },
      raw: data,
    };
  }

  async chatCompletionStream(
    client: AiProviderClient,
    messages: ChatMessage[],
    options?: ChatCompletionOptions,
  ): Promise<ChatCompletionStreamResult> {
    const model = options?.model ?? client.model;
    if (!model) {
      throw new Error("Model is required for Claude chat completion");
    }

    const baseUrl = client.baseUrl.replace(/\/$/, "");
    const url = `${baseUrl}/messages`;

    // Extract system message and convert to Claude format
    let systemPrompt: string | undefined;
    const claudeMessages: ClaudeMessage[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        systemPrompt = msg.content;
        continue;
      }
      if (msg.role === "tool") {
        const toolUseId = typeof (msg as any)?.tool_call_id === "string"
          ? (msg as any).tool_call_id
          : null;
        if (!toolUseId) continue;
        claudeMessages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: toolUseId,
              content: msg.content,
            },
          ],
        });
        continue;
      }

      if (msg.role === "assistant") {
        const blocks: ClaudeRequestContentBlock[] = [];
        if (msg.content) {
          blocks.push({ type: "text", text: msg.content });
        }
        const toolCalls = (msg as any)?.tool_calls;
        if (Array.isArray(toolCalls)) {
          for (const call of toolCalls) {
            const id = typeof call?.id === "string" && call.id.trim()
              ? call.id
              : `toolu_${Date.now()}`;
            const name = typeof call?.function?.name === "string" ? call.function.name : "";
            if (!name) continue;
            blocks.push({
              type: "tool_use",
              id,
              name,
              input: this.parseToolArgs(call?.function?.arguments),
            });
          }
        }
        if (blocks.length === 0) continue;
        claudeMessages.push({ role: "assistant", content: blocks });
        continue;
      }

      // user
      if (!msg.content) continue;
      claudeMessages.push({ role: "user", content: [{ type: "text", text: msg.content }] });
    }

    const body: ClaudeRequest = {
      model,
      messages: claudeMessages,
      max_tokens: options?.maxTokens ?? 4096,
      stream: true,
    };

    if (systemPrompt) {
      body.system = systemPrompt;
    }
    if (options?.temperature !== undefined) {
      body.temperature = options.temperature;
    }
    if (options?.topP !== undefined) {
      body.top_p = options.topP;
    }
    const toolPayload = this.normalizeTools(options);
    if (toolPayload.tools !== undefined) {
      body.tools = toolPayload.tools;
    }
    if (toolPayload.tool_choice !== undefined) {
      body.tool_choice = toolPayload.tool_choice;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        ...client.headers,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `Claude API error (${response.status}): ${errorText || response.statusText}`,
      );
    }

    if (!response.body) {
      throw new Error("Claude streaming response has no body");
    }

    // Transform Claude's SSE format to OpenAI-compatible format
    const transformedStream = transformClaudeStream(response.body);

    return {
      id: `stream-${Date.now()}`,
      provider: client.id,
      model,
      stream: transformedStream,
    };
  }

  async embed(
    _client: AiProviderClient,
    _input: string | string[],
    _options?: EmbeddingOptions,
  ): Promise<EmbeddingResult> {
    // Anthropic does not provide a native embedding API.
    // They recommend using Voyage AI (https://www.voyageai.com/) for embeddings.
    // To use embeddings with Anthropic, configure a separate OpenAI-compatible
    // provider pointing to Voyage AI's API.
    throw new Error(
      "Claude/Anthropic does not provide a native embedding API. " +
      "Use a separate provider configured with Voyage AI or another embedding service.",
    );
  }
}

/**
 * Transform Claude's SSE stream to OpenAI-compatible format
 */
function transformClaudeStream(
  claudeStream: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";

  return new ReadableStream({
    async start(controller) {
      const reader = claudeStream.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6);
            if (data === "[DONE]") {
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              continue;
            }

            try {
              const event = JSON.parse(data);
              if (event.type === "content_block_delta" && event.delta?.text) {
                // Convert to OpenAI format
                const openAiChunk = {
                  id: `chatcmpl-${Date.now()}`,
                  object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model: "claude",
                  choices: [
                    {
                      index: 0,
                      delta: { content: event.delta.text },
                      finish_reason: null,
                    },
                  ],
                };
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(openAiChunk)}\n\n`),
                );
              } else if (event.type === "message_stop") {
                const stopChunk = {
                  id: `chatcmpl-${Date.now()}`,
                  object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model: "claude",
                  choices: [
                    {
                      index: 0,
                      delta: {},
                      finish_reason: "stop",
                    },
                  ],
                };
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(stopChunk)}\n\n`),
                );
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

// Gemini adapter

type GeminiContent = {
  role: "user" | "model";
  parts: Array<{ text: string }>;
};

type GeminiResponsePart =
  | { text: string }
  | {
      functionCall: {
        name: string;
        args?: unknown;
      };
    };

type GeminiRequest = {
  contents: GeminiContent[];
  systemInstruction?: { parts: Array<{ text: string }> };
  tools?: unknown;
  toolConfig?: unknown;
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
  };
};

type GeminiCandidate = {
  content: {
    parts: GeminiResponsePart[];
    role: string;
  };
  finishReason: string;
};

type GeminiResponse = {
  candidates: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
};

type GeminiEmbedRequest = {
  model: string;
  content: {
    parts: Array<{ text: string }>;
  };
  outputDimensionality?: number;
};

type GeminiEmbedResponse = {
  embedding: {
    values: number[];
  };
};

type GeminiBatchEmbedRequest = {
  requests: Array<{
    model: string;
    content: {
      parts: Array<{ text: string }>;
    };
    outputDimensionality?: number;
  }>;
};

type GeminiBatchEmbedResponse = {
  embeddings: Array<{
    values: number[];
  }>;
};

export class GeminiAdapter implements AiProviderAdapter {
  readonly type: AiProviderType = "gemini";

  private normalizeTools(options?: ChatCompletionOptions): { tools?: unknown; toolConfig?: unknown } {
    const rawTools = options?.tools;
    if (!Array.isArray(rawTools) || rawTools.length === 0) return {};

    const declarations: Array<{ name: string; description?: string; parameters?: unknown }> = [];
    for (const item of rawTools as any[]) {
      const maybeFunction = item?.type === "function" ? item?.function : null;
      const name = typeof maybeFunction?.name === "string" ? maybeFunction.name.trim() : "";
      if (!name) continue;
      const description = typeof maybeFunction?.description === "string" ? maybeFunction.description : undefined;
      const parameters = maybeFunction?.parameters ?? {};
      declarations.push({ name, description, parameters });
    }

    const toolChoice = options?.toolChoice;
    if (toolChoice === "none") {
      return {};
    }

    // Gemini format: tools[].functionDeclarations + toolConfig.functionCallingConfig
    const tools = declarations.length > 0
      ? [{ functionDeclarations: declarations }]
      : rawTools;

    let toolConfig: any = { functionCallingConfig: { mode: "AUTO" } };
    if (toolChoice && typeof toolChoice === "object") {
      const forced = (toolChoice as any)?.function?.name ?? (toolChoice as any)?.name;
      const forcedName = typeof forced === "string" ? forced.trim() : "";
      if (forcedName) {
        toolConfig = {
          functionCallingConfig: {
            mode: "ANY",
            allowedFunctionNames: [forcedName],
          },
        };
      }
    }

    return { tools, toolConfig };
  }

  async chatCompletion(
    client: AiProviderClient,
    messages: ChatMessage[],
    options?: ChatCompletionOptions,
  ): Promise<ChatCompletionResult> {
    const model = options?.model ?? client.model;
    if (!model) {
      throw new Error("Model is required for Gemini chat completion");
    }

    const baseUrl = client.baseUrl.replace(/\/$/, "");
    const url = `${baseUrl}/models/${model}:generateContent`;

    // Extract system message and convert to Gemini format
    let systemInstruction: { parts: Array<{ text: string }> } | undefined;
    const geminiContents: GeminiContent[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        systemInstruction = { parts: [{ text: msg.content }] };
        continue;
      }
      if (msg.role === "tool") {
        // Not supported yet: tool result unification for Gemini.
        continue;
      } else {
        geminiContents.push({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content }],
        });
      }
    }

    const body: GeminiRequest = {
      contents: geminiContents,
    };

    if (systemInstruction) {
      body.systemInstruction = systemInstruction;
    }
    const toolPayload = this.normalizeTools(options);
    if (toolPayload.tools !== undefined) {
      body.tools = toolPayload.tools;
    }
    if (toolPayload.toolConfig !== undefined) {
      body.toolConfig = toolPayload.toolConfig;
    }

    const generationConfig: GeminiRequest["generationConfig"] = {};
    if (options?.temperature !== undefined) {
      generationConfig.temperature = options.temperature;
    }
    if (options?.maxTokens !== undefined) {
      generationConfig.maxOutputTokens = options.maxTokens;
    }
    if (options?.topP !== undefined) {
      generationConfig.topP = options.topP;
    }
    if (Object.keys(generationConfig).length > 0) {
      body.generationConfig = generationConfig;
    }

    // Gemini uses API key as query parameter
    const urlWithKey = `${url}?key=${client.apiKey}`;

    const response = await fetch(urlWithKey, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `Gemini API error (${response.status}): ${errorText || response.statusText}`,
      );
    }

    const data = (await response.json()) as GeminiResponse;

    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const textContent = parts
      .map((p) => ("text" in p && typeof p.text === "string" ? p.text : ""))
      .join("");

    const toolCalls = parts
      .map((p, index) => {
        if (!("functionCall" in p)) return null;
        const name = p.functionCall?.name;
        if (typeof name !== "string" || name.trim() === "") return null;
        const args = p.functionCall?.args ?? {};
        return {
          id: `call_${index + 1}`,
          type: "function",
          function: {
            name,
            arguments: JSON.stringify(args),
          },
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);

    return {
      id: `gemini-${Date.now()}`,
      provider: client.id,
      model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: textContent,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          },
          finishReason: toolCalls.length > 0
            ? "tool_calls"
            : (data.candidates?.[0]?.finishReason ?? null),
        },
      ],
      usage: data.usageMetadata
        ? {
            promptTokens: data.usageMetadata.promptTokenCount,
            completionTokens: data.usageMetadata.candidatesTokenCount,
            totalTokens: data.usageMetadata.totalTokenCount,
          }
        : undefined,
      raw: data,
    };
  }

  async chatCompletionStream(
    client: AiProviderClient,
    messages: ChatMessage[],
    options?: ChatCompletionOptions,
  ): Promise<ChatCompletionStreamResult> {
    const model = options?.model ?? client.model;
    if (!model) {
      throw new Error("Model is required for Gemini chat completion");
    }

    const baseUrl = client.baseUrl.replace(/\/$/, "");
    const url = `${baseUrl}/models/${model}:streamGenerateContent`;

    // Extract system message and convert to Gemini format
    let systemInstruction: { parts: Array<{ text: string }> } | undefined;
    const geminiContents: GeminiContent[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        systemInstruction = { parts: [{ text: msg.content }] };
        continue;
      }
      if (msg.role === "tool") {
        // Not supported yet: tool result unification for Gemini.
        continue;
      } else {
        geminiContents.push({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content }],
        });
      }
    }

    const body: GeminiRequest = {
      contents: geminiContents,
    };

    if (systemInstruction) {
      body.systemInstruction = systemInstruction;
    }
    const toolPayload = this.normalizeTools(options);
    if (toolPayload.tools !== undefined) {
      body.tools = toolPayload.tools;
    }
    if (toolPayload.toolConfig !== undefined) {
      body.toolConfig = toolPayload.toolConfig;
    }

    const generationConfig: GeminiRequest["generationConfig"] = {};
    if (options?.temperature !== undefined) {
      generationConfig.temperature = options.temperature;
    }
    if (options?.maxTokens !== undefined) {
      generationConfig.maxOutputTokens = options.maxTokens;
    }
    if (options?.topP !== undefined) {
      generationConfig.topP = options.topP;
    }
    if (Object.keys(generationConfig).length > 0) {
      body.generationConfig = generationConfig;
    }

    // Gemini uses API key as query parameter with alt=sse for streaming
    const urlWithKey = `${url}?key=${client.apiKey}&alt=sse`;

    const response = await fetch(urlWithKey, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `Gemini API error (${response.status}): ${errorText || response.statusText}`,
      );
    }

    if (!response.body) {
      throw new Error("Gemini streaming response has no body");
    }

    // Transform Gemini's SSE format to OpenAI-compatible format
    const transformedStream = transformGeminiStream(response.body);

    return {
      id: `stream-${Date.now()}`,
      provider: client.id,
      model,
      stream: transformedStream,
    };
  }

  async embed(
    client: AiProviderClient,
    input: string | string[],
    options?: EmbeddingOptions,
  ): Promise<EmbeddingResult> {
    const model = options?.model ?? "text-embedding-004";
    const baseUrl = client.baseUrl.replace(/\/$/, "");
    const inputs = Array.isArray(input) ? input : [input];

    // Use batch endpoint for multiple inputs, single endpoint for one
    if (inputs.length === 1) {
      const url = `${baseUrl}/models/${model}:embedContent`;
      const urlWithKey = `${url}?key=${client.apiKey}`;

      const body: GeminiEmbedRequest = {
        model: `models/${model}`,
        content: {
          parts: [{ text: inputs[0] }],
        },
      };

      if (options?.dimensions !== undefined) {
        body.outputDimensionality = options.dimensions;
      }

      const response = await fetch(urlWithKey, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(
          `Gemini Embedding API error (${response.status}): ${errorText || response.statusText}`,
        );
      }

      const data = (await response.json()) as GeminiEmbedResponse;

      return {
        provider: client.id,
        model,
        embeddings: [
          {
            index: 0,
            embedding: data.embedding.values,
          },
        ],
        raw: data,
      };
    }

    // Batch embedding for multiple inputs
    const url = `${baseUrl}/models/${model}:batchEmbedContents`;
    const urlWithKey = `${url}?key=${client.apiKey}`;

    const body: GeminiBatchEmbedRequest = {
      requests: inputs.map((text) => {
        const req: GeminiBatchEmbedRequest["requests"][0] = {
          model: `models/${model}`,
          content: {
            parts: [{ text }],
          },
        };
        if (options?.dimensions !== undefined) {
          req.outputDimensionality = options.dimensions;
        }
        return req;
      }),
    };

    const response = await fetch(urlWithKey, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `Gemini Batch Embedding API error (${response.status}): ${errorText || response.statusText}`,
      );
    }

    const data = (await response.json()) as GeminiBatchEmbedResponse;

    return {
      provider: client.id,
      model,
      embeddings: data.embeddings.map((emb, index) => ({
        index,
        embedding: emb.values,
      })),
      raw: data,
    };
  }
}

/**
 * Transform Gemini's SSE stream to OpenAI-compatible format
 */
function transformGeminiStream(
  geminiStream: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";

  return new ReadableStream({
    async start(controller) {
      const reader = geminiStream.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6);

            try {
              const event = JSON.parse(data) as GeminiResponse;
              const text = event.candidates?.[0]?.content?.parts
                ?.map((p) => p.text)
                .join("");

              if (text) {
                // Convert to OpenAI format
                const openAiChunk = {
                  id: `chatcmpl-${Date.now()}`,
                  object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model: "gemini",
                  choices: [
                    {
                      index: 0,
                      delta: { content: text },
                      finish_reason: null,
                    },
                  ],
                };
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(openAiChunk)}\n\n`),
                );
              }

              const finishReason = event.candidates?.[0]?.finishReason;
              if (finishReason) {
                const stopChunk = {
                  id: `chatcmpl-${Date.now()}`,
                  object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model: "gemini",
                  choices: [
                    {
                      index: 0,
                      delta: {},
                      finish_reason: "stop",
                    },
                  ],
                };
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(stopChunk)}\n\n`),
                );
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

// Adapter factory

const adapters: Map<AiProviderType, AiProviderAdapter> = new Map([
  ["openai", new OpenAiAdapter()],
  ["openai-compatible", new OpenAiAdapter()],
  ["openrouter", new OpenAiAdapter()],
  ["claude", new ClaudeAdapter()],
  ["gemini", new GeminiAdapter()],
]);

export function getProviderAdapter(type: AiProviderType): AiProviderAdapter {
  const adapter = adapters.get(type);
  if (!adapter) {
    throw new Error(`No adapter available for provider type: ${type}`);
  }
  return adapter;
}

/**
 * High-level function to perform chat completion with any provider
 */
export async function chatCompletion(
  client: AiProviderClient,
  messages: ChatMessage[],
  options?: ChatCompletionOptions,
): Promise<ChatCompletionResult> {
  const adapter = getProviderAdapter(client.type);
  return adapter.chatCompletion(client, messages, options);
}

/**
 * High-level function to perform streaming chat completion with any provider
 */
export async function chatCompletionStream(
  client: AiProviderClient,
  messages: ChatMessage[],
  options?: ChatCompletionOptions,
): Promise<ChatCompletionStreamResult> {
  const adapter = getProviderAdapter(client.type);
  return adapter.chatCompletionStream(client, messages, options);
}

/**
 * High-level function to generate embeddings with any provider
 *
 * @param client - The AI provider client configuration
 * @param input - A single string or array of strings to embed
 * @param options - Optional settings including model and dimensions
 * @returns The embedding result containing vectors and usage info
 *
 * @example
 * ```typescript
 * // Single text embedding
 * const result = await embed(client, "Hello world");
 * console.log(result.embeddings[0].embedding); // number[]
 *
 * // Batch embedding
 * const results = await embed(client, ["Hello", "World"]);
 * results.embeddings.forEach(e => console.log(e.embedding));
 *
 * // With options
 * const result = await embed(client, "text", {
 *   model: "text-embedding-3-large",
 *   dimensions: 256
 * });
 * ```
 */
export async function embed(
  client: AiProviderClient,
  input: string | string[],
  options?: EmbeddingOptions,
): Promise<EmbeddingResult> {
  const adapter = getProviderAdapter(client.type);
  return adapter.embed(client, input, options);
}
