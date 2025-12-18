import { describe, expect, it, vi } from "vitest";
import { ClaudeAdapter, OpenAiAdapter } from "./provider-adapters";
import { GeminiAdapter } from "./provider-adapters";

const makeClient = () =>
  ({
    id: "p1",
    type: "openai",
    baseUrl: "https://example.ai/v1",
    model: "gpt-test",
    apiKey: "k",
    headers: { Authorization: "Bearer k" },
    requiresExternalNetwork: true,
  }) as any;

describe("provider-adapters OpenAiAdapter", () => {
  it("passes tools/tool_choice/response_format through to request body", async () => {
    const adapter = new OpenAiAdapter();
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      const parsed = JSON.parse(init.body);
      expect(parsed.tools).toEqual([{ type: "function", function: { name: "tool.echo" } }]);
      expect(parsed.tool_choice).toEqual("auto");
      expect(parsed.response_format).toEqual({ type: "json_object" });
      return new Response(
        JSON.stringify({
          id: "chatcmpl_1",
          object: "chat.completion",
          created: 1,
          model: "gpt-test",
          choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200 },
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    await adapter.chatCompletion(
      makeClient(),
      [{ role: "user", content: "hi" }],
      {
        tools: [{ type: "function", function: { name: "tool.echo" } }],
        toolChoice: "auto",
        responseFormat: { type: "json_object" },
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("returns tool_calls payload on the assistant message when present", async () => {
    const adapter = new OpenAiAdapter();
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          id: "chatcmpl_2",
          object: "chat.completion",
          created: 1,
          model: "gpt-test",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "",
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: { name: "tool.echo", arguments: "{\"x\":1}" },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
        { status: 200 },
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await adapter.chatCompletion(makeClient(), [{ role: "user", content: "hi" }]);
    expect((result.choices[0]?.message as any)?.tool_calls).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("passes tool role messages with tool_call_id through to request body", async () => {
    const adapter = new OpenAiAdapter();
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      const parsed = JSON.parse(init.body);
      expect(parsed.messages).toMatchObject([
        { role: "assistant", content: "", tool_calls: [{ id: "call_1" }] },
        { role: "tool", content: "{\"ok\":true}", tool_call_id: "call_1" },
      ]);
      return new Response(
        JSON.stringify({
          id: "chatcmpl_3",
          object: "chat.completion",
          created: 1,
          model: "gpt-test",
          choices: [{ index: 0, message: { role: "assistant", content: "done" }, finish_reason: "stop" }],
        }),
        { status: 200 },
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    await adapter.chatCompletion(makeClient(), [
      { role: "assistant", content: "", tool_calls: [{ id: "call_1" }] } as any,
      { role: "tool", content: "{\"ok\":true}", tool_call_id: "call_1" } as any,
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});

describe("provider-adapters ClaudeAdapter", () => {
  it("maps OpenAI function tools into Claude tools/tool_choice payload", async () => {
    const adapter = new ClaudeAdapter();
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      const parsed = JSON.parse(init.body);
      expect(Array.isArray(parsed.tools)).toBe(true);
      expect(parsed.tools[0]).toMatchObject({
        name: "tool.echo",
        input_schema: { type: "object" },
      });
      expect(parsed.tool_choice).toMatchObject({ type: "auto" });
      return new Response(
        JSON.stringify({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-test",
          stop_reason: "stop",
          content: [{ type: "text", text: "ok" }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200 },
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    await adapter.chatCompletion(
      {
        ...makeClient(),
        type: "claude",
        baseUrl: "https://example.ai",
        model: "claude-test",
      },
      [{ role: "user", content: "hi" }],
      {
        tools: [{ type: "function", function: { name: "tool.echo", parameters: { type: "object" } } }],
        toolChoice: "auto",
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("normalizes Claude tool_use blocks into OpenAI-style tool_calls", async () => {
    const adapter = new ClaudeAdapter();
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          id: "msg_2",
          type: "message",
          role: "assistant",
          model: "claude-test",
          stop_reason: "tool_use",
          content: [
            { type: "tool_use", id: "toolu_1", name: "tool.echo", input: { x: 1 } },
          ],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200 },
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await adapter.chatCompletion(
      {
        ...makeClient(),
        type: "claude",
        baseUrl: "https://example.ai",
        model: "claude-test",
      },
      [{ role: "user", content: "hi" }],
      {
        tools: [{ type: "function", function: { name: "tool.echo", parameters: { type: "object" } } }],
        toolChoice: "auto",
      },
    );

    expect((result.choices[0]?.message as any)?.tool_calls).toMatchObject([
      { id: "toolu_1", type: "function", function: { name: "tool.echo", arguments: "{\"x\":1}" } },
    ]);
    expect(result.choices[0]?.finishReason).toBe("tool_calls");
    vi.unstubAllGlobals();
  });
});

describe("provider-adapters GeminiAdapter", () => {
  it("maps OpenAI function tools into Gemini tools/toolConfig payload", async () => {
    const adapter = new GeminiAdapter();
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      const parsed = JSON.parse(init.body);
      expect(Array.isArray(parsed.tools)).toBe(true);
      const decls = parsed.tools[0]?.functionDeclarations ?? [];
      expect(decls[0]).toMatchObject({ name: "tool.echo" });
      expect(parsed.toolConfig?.functionCallingConfig?.mode).toBe("AUTO");
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "ok" }], role: "model" }, finishReason: "stop" }],
        }),
        { status: 200 },
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    await adapter.chatCompletion(
      {
        ...makeClient(),
        type: "gemini",
        baseUrl: "https://example.ai/v1beta",
        model: "gemini-1.5-flash",
        apiKey: "k",
      },
      [{ role: "user", content: "hi" }],
      {
        tools: [{ type: "function", function: { name: "tool.echo", parameters: { type: "object" } } }],
        toolChoice: "auto",
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("normalizes Gemini functionCall parts into OpenAI-style tool_calls", async () => {
    const adapter = new GeminiAdapter();
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  { functionCall: { name: "tool.echo", args: { x: 1 } } },
                ],
              },
              finishReason: "STOP",
            },
          ],
        }),
        { status: 200 },
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await adapter.chatCompletion(
      {
        ...makeClient(),
        type: "gemini",
        baseUrl: "https://example.ai/v1beta",
        model: "gemini-1.5-flash",
        apiKey: "k",
      },
      [{ role: "user", content: "hi" }],
      {
        tools: [{ type: "function", function: { name: "tool.echo", parameters: { type: "object" } } }],
        toolChoice: "auto",
      },
    );

    expect((result.choices[0]?.message as any)?.tool_calls).toMatchObject([
      { type: "function", function: { name: "tool.echo", arguments: "{\"x\":1}" } },
    ]);
    expect(result.choices[0]?.finishReason).toBe("tool_calls");
    vi.unstubAllGlobals();
  });
});
