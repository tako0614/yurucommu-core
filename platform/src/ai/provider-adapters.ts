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

export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ChatCompletionOptions = {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stream?: boolean;
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
}

// OpenAI adapter (also works for OpenAI-compatible and OpenRouter)

type OpenAiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OpenAiRequest = {
  model: string;
  messages: OpenAiMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
};

type OpenAiChoice = {
  index: number;
  message: {
    role: string;
    content: string;
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
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
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
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
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
}

// Claude (Anthropic) adapter

type ClaudeMessage = {
  role: "user" | "assistant";
  content: string;
};

type ClaudeRequest = {
  model: string;
  messages: ClaudeMessage[];
  system?: string;
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
};

type ClaudeContentBlock = {
  type: "text";
  text: string;
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
      } else {
        claudeMessages.push({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        });
      }
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

    // Extract text content from Claude's content blocks
    const textContent = data.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

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
          },
          finishReason: data.stop_reason,
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
      } else {
        claudeMessages.push({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        });
      }
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

type GeminiRequest = {
  contents: GeminiContent[];
  systemInstruction?: { parts: Array<{ text: string }> };
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
  };
};

type GeminiCandidate = {
  content: {
    parts: Array<{ text: string }>;
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

export class GeminiAdapter implements AiProviderAdapter {
  readonly type: AiProviderType = "gemini";

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

    const textContent = data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text)
      .join("") ?? "";

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
          },
          finishReason: data.candidates?.[0]?.finishReason ?? null,
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
