import { describe, expect, it, vi } from "vitest";
import { OpenAiAdapter } from "./provider-adapters";

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
});

