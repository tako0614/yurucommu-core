import { describe, expect, it, vi } from "vitest";
import { createAgentTools } from "./agent-tools-impl";

const createRegistryStub = () =>
  ({
    register: () => undefined,
    getAction: () => null,
    listActions: () => [],
  }) as any;

describe("agent tools implementation", () => {
  it("blocks createPost for guest agents", async () => {
    const tools = createAgentTools({ actionRegistry: createRegistryStub() });

    await expect(
      tools.createPost(
        {
          auth: { userId: "u1", isAuthenticated: true, agentType: "guest" },
          nodeConfig: {} as any,
          services: {
            posts: { createPost: vi.fn() } as any,
            users: {} as any,
            communities: {} as any,
            dm: {} as any,
          },
        },
        { content: "hello" },
      ),
    ).rejects.toThrow(/not allowed/i);
  });

  it("calls CoreServices.posts.createPost with mapped fields", async () => {
    const createPost = vi.fn().mockResolvedValue({ id: "p1", content: "hello" });
    const tools = createAgentTools({ actionRegistry: createRegistryStub() });

    const result = await tools.createPost(
      {
        auth: {
          userId: "u1",
          isAuthenticated: true,
          agentType: "user",
          plan: { name: "self-hosted", limits: { aiRequests: 999 }, features: ["*"] },
        },
        nodeConfig: {} as any,
        services: {
          posts: { createPost } as any,
          users: {} as any,
          communities: {} as any,
          dm: {} as any,
        },
      },
      { content: "hello", reply_to: "p0", spoiler_text: "cw" },
    );

    expect(result.post).toMatchObject({ id: "p1" });
    expect(createPost).toHaveBeenCalledOnce();
    const [, input] = createPost.mock.calls[0];
    expect(input).toMatchObject({
      content: "hello",
      in_reply_to_id: "p0",
      content_warning: "cw",
    });
  });
});

