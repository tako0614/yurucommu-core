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

  it("proxies block tool to App layer when fetchAppApi is provided", async () => {
    const fetchAppApi = vi.fn(async (path: string, init?: RequestInit) => {
      expect(path).toBe("/blocks");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body ?? "{}"));
      expect(body).toMatchObject({ targetId: "u2" });
      return new Response(JSON.stringify({ ids: ["u2"] }), { status: 200 });
    });

    const tools = createAgentTools({ actionRegistry: createRegistryStub(), fetchAppApi });

    const result = await tools.block(
      {
        auth: {
          userId: "u1",
          isAuthenticated: true,
          agentType: "user",
          plan: { name: "self-hosted", limits: { aiRequests: 999 }, features: ["*"] },
        },
        nodeConfig: {} as any,
        services: { posts: {} as any, users: {} as any },
      },
      { targetUserId: "u2" },
    );

    expect(result).toEqual({ success: true, ids: ["u2"] });
    expect(fetchAppApi).toHaveBeenCalledOnce();
  });

  it("proxies getCommunities to App layer when fetchAppApi is provided", async () => {
    const fetchAppApi = vi.fn(async (path: string) => {
      expect(path).toContain("/communities");
      expect(path).toContain("q=test");
      return new Response(JSON.stringify({ communities: [{ id: "c1" }], next_offset: null }), { status: 200 });
    });

    const tools = createAgentTools({ actionRegistry: createRegistryStub(), fetchAppApi });

    const result = await tools.getCommunities(
      {
        auth: {
          userId: "u1",
          isAuthenticated: true,
          agentType: "user",
          plan: { name: "self-hosted", limits: { aiRequests: 999 }, features: ["*"] },
        },
        nodeConfig: {} as any,
        services: { posts: {} as any, users: {} as any },
      },
      { q: "test", limit: 10, offset: 0 },
    );

    expect(result.communities).toHaveLength(1);
    expect(result.next_offset).toBeNull();
    expect(fetchAppApi).toHaveBeenCalledOnce();
  });

  it("lists media via MediaService.listStorage", async () => {
    const listStorage = vi.fn().mockResolvedValue({ files: [{ key: "k1" }], next_offset: null });
    const tools = createAgentTools({ actionRegistry: createRegistryStub() });

    const result = await tools.listMedia(
      {
        auth: {
          userId: "u1",
          isAuthenticated: true,
          agentType: "user",
          plan: { name: "self-hosted", limits: { aiRequests: 999 }, features: ["*"] },
        },
        nodeConfig: {} as any,
        services: { posts: {} as any, users: {} as any, media: { listStorage } as any, storage: {} as any },
      },
      { limit: 10, offset: 0 },
    );

    expect(result.files).toHaveLength(1);
    expect(listStorage).toHaveBeenCalledOnce();
  });

  it("returns followers via UserService.listFollowers", async () => {
    const listFollowers = vi.fn().mockResolvedValue({ users: [{ id: "u2" }], next_offset: null, next_cursor: null });
    const tools = createAgentTools({ actionRegistry: createRegistryStub() });

    const result = await tools.getFollowers(
      {
        auth: {
          userId: "u1",
          isAuthenticated: true,
          agentType: "user",
          plan: { name: "self-hosted", limits: { aiRequests: 999 }, features: ["*"] },
        },
        nodeConfig: {} as any,
        services: { posts: {} as any, users: { listFollowers } as any },
      },
      { limit: 10, offset: 0 },
    );

    expect(result.users).toHaveLength(1);
    expect(listFollowers).toHaveBeenCalledOnce();
  });

  it("proxies getStories to App layer when fetchAppApi is provided", async () => {
    const fetchAppApi = vi.fn(async (path: string) => {
      expect(path).toContain("/stories");
      return new Response(JSON.stringify({ stories: [{ id: "s1" }], next_offset: null }), { status: 200 });
    });

    const tools = createAgentTools({ actionRegistry: createRegistryStub(), fetchAppApi });

    const result = await tools.getStories(
      {
        auth: {
          userId: "u1",
          isAuthenticated: true,
          agentType: "user",
          plan: { name: "self-hosted", limits: { aiRequests: 999 }, features: ["*"] },
        },
        nodeConfig: {} as any,
        services: { posts: {} as any, users: {} as any },
      },
      { limit: 10, offset: 0 },
    );

    expect(result.stories).toHaveLength(1);
    expect(fetchAppApi).toHaveBeenCalledOnce();
  });

  it("calls CoreServices.posts.updatePost with mapped fields", async () => {
    const updatePost = vi.fn().mockResolvedValue({ id: "p1", content: "edited" });
    const tools = createAgentTools({ actionRegistry: createRegistryStub() });

    const result = await tools.editPost(
      {
        auth: {
          userId: "u1",
          isAuthenticated: true,
          agentType: "user",
          plan: { name: "self-hosted", limits: { aiRequests: 999 }, features: ["*"] },
        },
        nodeConfig: {} as any,
        services: { posts: { updatePost } as any, users: {} as any },
      },
      { id: "p1", content: "edited", spoiler_text: "cw", media_ids: ["m1"] },
    );

    expect(result.post).toMatchObject({ id: "p1" });
    expect(updatePost).toHaveBeenCalledOnce();
    const [, input] = updatePost.mock.calls[0];
    expect(input).toMatchObject({ id: "p1", content: "edited", content_warning: "cw", media_ids: ["m1"] });
  });

  it("creates poll via CoreServices.posts.createPost with poll payload", async () => {
    const createPost = vi.fn().mockResolvedValue({ id: "p2" });
    const tools = createAgentTools({ actionRegistry: createRegistryStub() });

    const result = await tools.createPoll(
      {
        auth: {
          userId: "u1",
          isAuthenticated: true,
          agentType: "user",
          plan: { name: "self-hosted", limits: { aiRequests: 999 }, features: ["*"] },
        },
        nodeConfig: {} as any,
        services: { posts: { createPost } as any, users: {} as any },
      },
      { content: "q", options: ["a", "b"], multiple: true, expires_in: 3600 },
    );

    expect(result.post).toMatchObject({ id: "p2" });
    expect(createPost).toHaveBeenCalledOnce();
    const [, input] = createPost.mock.calls[0];
    expect(input).toMatchObject({
      content: "q",
      poll: { options: ["a", "b"], multiple: true, expires_in: 3600 },
    });
  });

  it("deletes posts via CoreServices.posts.deletePost", async () => {
    const deletePost = vi.fn().mockResolvedValue(undefined);
    const tools = createAgentTools({ actionRegistry: createRegistryStub() });

    const result = await tools.deletePost(
      {
        auth: {
          userId: "u1",
          isAuthenticated: true,
          agentType: "user",
          plan: { name: "self-hosted", limits: { aiRequests: 999 }, features: ["*"] },
        },
        nodeConfig: {} as any,
        services: { posts: { deletePost } as any, users: {} as any },
      },
      { id: "p1" },
    );

    expect(result).toEqual({ success: true });
    expect(deletePost).toHaveBeenCalledWith(expect.anything(), "p1");
  });

  it("supports unreact via reactionId", async () => {
    const removeReaction = vi.fn().mockResolvedValue(undefined);
    const tools = createAgentTools({ actionRegistry: createRegistryStub() });

    const result = await tools.unreact(
      {
        auth: {
          userId: "u1",
          isAuthenticated: true,
          agentType: "user",
          plan: { name: "self-hosted", limits: { aiRequests: 999 }, features: ["*"] },
        },
        nodeConfig: {} as any,
        services: { posts: { removeReaction } as any, users: {} as any },
      },
      { reactionId: "r1" },
    );

    expect(result).toEqual({ removed: true });
    expect(removeReaction).toHaveBeenCalledWith(expect.anything(), "r1");
  });

  it("bookmarks and unbookmarks posts via PostService", async () => {
    const addBookmark = vi.fn().mockResolvedValue(undefined);
    const removeBookmark = vi.fn().mockResolvedValue(undefined);
    const tools = createAgentTools({ actionRegistry: createRegistryStub() });

    const ctx = {
      auth: {
        userId: "u1",
        isAuthenticated: true,
        agentType: "user",
        plan: { name: "self-hosted", limits: { aiRequests: 999 }, features: ["*"] },
      },
      nodeConfig: {} as any,
      services: { posts: { addBookmark, removeBookmark } as any, users: {} as any },
    };

    await expect(tools.bookmark(ctx as any, { post_id: "p1" })).resolves.toEqual({ success: true });
    await expect(tools.unbookmark(ctx as any, { post_id: "p1" })).resolves.toEqual({ success: true });
    expect(addBookmark).toHaveBeenCalledWith(expect.anything(), "p1");
    expect(removeBookmark).toHaveBeenCalledWith(expect.anything(), "p1");
  });

  it("proxies createStory and deleteStory to App layer when fetchAppApi is provided", async () => {
    const fetchAppApi = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === "/stories") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body ?? "{}"));
        expect(body).toMatchObject({ items: [{ id: "a" }], visible_to_friends: true });
        return new Response(JSON.stringify({ id: "s1" }), { status: 201 });
      }
      if (path === "/stories/s1") {
        expect(init?.method).toBe("DELETE");
        return new Response(JSON.stringify({ deleted: true }), { status: 200 });
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const tools = createAgentTools({ actionRegistry: createRegistryStub(), fetchAppApi });
    const ctx = {
      auth: {
        userId: "u1",
        isAuthenticated: true,
        agentType: "user",
        plan: { name: "self-hosted", limits: { aiRequests: 999 }, features: ["*"] },
      },
      nodeConfig: {} as any,
      services: { posts: {} as any, users: {} as any },
    };

    const created = await tools.createStory(ctx as any, { items: [{ id: "a" }], visible_to_friends: true });
    expect(created.story).toMatchObject({ id: "s1" });

    const deleted = await tools.deleteStory(ctx as any, { id: "s1" });
    expect(deleted).toEqual({ deleted: true });
    expect(fetchAppApi).toHaveBeenCalled();
  });

  it("uploads files via MediaService.upload (base64)", async () => {
    const upload = vi.fn().mockResolvedValue({ key: "k1", url: "/media/k1" });
    const tools = createAgentTools({ actionRegistry: createRegistryStub() });

    const result = await tools.uploadFile(
      {
        auth: {
          userId: "u1",
          isAuthenticated: true,
          agentType: "user",
          plan: { name: "self-hosted", limits: { aiRequests: 999 }, features: ["*"] },
        },
        nodeConfig: {} as any,
        services: { posts: {} as any, users: {} as any, media: { upload } as any },
      },
      { base64: Buffer.from("hello", "utf8").toString("base64"), filename: "hello.txt", contentType: "text/plain" },
    );

    expect(result.media).toMatchObject({ key: "k1" });
    expect(upload).toHaveBeenCalledOnce();
    const [, input] = upload.mock.calls[0];
    expect(input).toMatchObject({ filename: "hello.txt", contentType: "text/plain" });
  });

  it("updates media metadata via MediaService.updateMetadata", async () => {
    const updateMetadata = vi.fn().mockResolvedValue({ key: "k1", alt: "a", description: "d" });
    const tools = createAgentTools({ actionRegistry: createRegistryStub() });

    const result = await tools.updateMedia(
      {
        auth: {
          userId: "u1",
          isAuthenticated: true,
          agentType: "user",
          plan: { name: "self-hosted", limits: { aiRequests: 999 }, features: ["*"] },
        },
        nodeConfig: {} as any,
        services: { posts: {} as any, users: {} as any, media: { updateMetadata } as any },
      },
      { idOrKey: "k1", alt: "a", description: "d" },
    );

    expect(result.media).toMatchObject({ key: "k1", alt: "a" });
    expect(updateMetadata).toHaveBeenCalledWith(expect.anything(), "k1", expect.objectContaining({ alt: "a", description: "d" }));
  });

  it("lists folders from StorageService.list", async () => {
    const list = vi.fn().mockResolvedValue({
      objects: [
        { key: "user-uploads/u1/2024/01/a.png", size: 1 },
        { key: "user-uploads/u1/2024/02/b.png", size: 1 },
        { key: "user-uploads/u1/root.png", size: 1 },
      ],
      cursor: undefined,
      truncated: false,
    });
    const tools = createAgentTools({ actionRegistry: createRegistryStub() });

    const result = await tools.listFolders(
      {
        auth: {
          userId: "u1",
          isAuthenticated: true,
          agentType: "user",
          plan: { name: "self-hosted", limits: { aiRequests: 999 }, features: ["*"] },
        },
        nodeConfig: {} as any,
        services: { posts: {} as any, users: {} as any, storage: { list } as any },
      },
      {},
    );

    expect(result.folders).toEqual(["2024"]);
    expect(list).toHaveBeenCalled();
  });

  it("proxies createDmThread and sendDm to App layer when fetchAppApi is provided", async () => {
    const fetchAppApi = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === "/dm/with/alice") {
        expect(init?.method ?? "GET").toBe("GET");
        return new Response(JSON.stringify({ threadId: "t1", participants: ["u1", "alice"] }), { status: 200 });
      }
      if (path === "/dm/send") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body ?? "{}"));
        expect(body).toMatchObject({ content: "hi", recipients: ["alice"] });
        return new Response(JSON.stringify({ id: "m1", content: "hi" }), { status: 201 });
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const tools = createAgentTools({ actionRegistry: createRegistryStub(), fetchAppApi });
    const ctx = {
      auth: {
        userId: "u1",
        isAuthenticated: true,
        agentType: "user",
        plan: { name: "self-hosted", limits: { aiRequests: 999 }, features: ["*"] },
      },
      nodeConfig: {} as any,
      services: { posts: {} as any, users: {} as any },
    };

    const thread = await tools.createDmThread(ctx as any, { handle: "@alice" });
    expect(thread.threadId).toBe("t1");

    const sent = await tools.sendDm(ctx as any, { recipients: ["alice"], content: "hi" });
    expect(sent.message).toMatchObject({ id: "m1" });
    expect(fetchAppApi).toHaveBeenCalled();
  });

  it("proxies joinCommunity/leaveCommunity to App layer when fetchAppApi is provided", async () => {
    const fetchAppApi = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === "/communities/c1/join") {
        expect(init?.method).toBe("POST");
        return new Response(JSON.stringify({ community_id: "c1", joined: true }), { status: 200 });
      }
      if (path === "/communities/c1/leave") {
        expect(init?.method).toBe("POST");
        return new Response(JSON.stringify({ community_id: "c1", left: true }), { status: 200 });
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const tools = createAgentTools({ actionRegistry: createRegistryStub(), fetchAppApi });
    const ctx = {
      auth: {
        userId: "u1",
        isAuthenticated: true,
        agentType: "user",
        plan: { name: "self-hosted", limits: { aiRequests: 999 }, features: ["*"] },
      },
      nodeConfig: {} as any,
      services: { posts: {} as any, users: {} as any },
    };

    await expect(tools.joinCommunity(ctx as any, { communityId: "c1" })).resolves.toMatchObject({ joined: true });
    await expect(tools.leaveCommunity(ctx as any, { communityId: "c1" })).resolves.toMatchObject({ left: true });
    expect(fetchAppApi).toHaveBeenCalled();
  });

  it("posts to community via CoreServices.posts.createPost", async () => {
    const createPost = vi.fn().mockResolvedValue({ id: "p1" });
    const tools = createAgentTools({ actionRegistry: createRegistryStub() });

    const result = await tools.postToCommunity(
      {
        auth: {
          userId: "u1",
          isAuthenticated: true,
          agentType: "user",
          plan: { name: "self-hosted", limits: { aiRequests: 999 }, features: ["*"] },
        },
        nodeConfig: {} as any,
        services: { posts: { createPost } as any, users: {} as any },
      },
      { communityId: "c1", content: "hello" },
    );

    expect(result.post).toMatchObject({ id: "p1" });
    const [, input] = createPost.mock.calls[0];
    expect(input).toMatchObject({ community_id: "c1", visibility: "community", content: "hello" });
  });

  it("proxies createCommunity/updateCommunity/createChannel/deleteChannel to App layer when fetchAppApi is provided", async () => {
    const fetchAppApi = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === "/communities") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body ?? "{}"));
        expect(body).toMatchObject({ name: "c1" });
        return new Response(JSON.stringify({ id: "c1" }), { status: 201 });
      }
      if (path === "/communities/c1") {
        expect(init?.method).toBe("PATCH");
        const body = JSON.parse(String(init?.body ?? "{}"));
        expect(body).toMatchObject({ description: "d" });
        return new Response(JSON.stringify({ id: "c1", description: "d" }), { status: 200 });
      }
      if (path === "/communities/c1/channels") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body ?? "{}"));
        expect(body).toMatchObject({ name: "general" });
        return new Response(JSON.stringify({ id: "ch1", name: "general" }), { status: 201 });
      }
      if (path === "/communities/c1/channels/ch1") {
        if (init?.method === "PATCH") {
          const body = JSON.parse(String(init?.body ?? "{}"));
          expect(body).toMatchObject({ description: "new" });
          return new Response(JSON.stringify({ id: "ch1", description: "new" }), { status: 200 });
        }
        expect(init?.method).toBe("DELETE");
        return new Response(JSON.stringify({ deleted: true }), { status: 200 });
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const tools = createAgentTools({ actionRegistry: createRegistryStub(), fetchAppApi });
    const ctx = {
      auth: {
        userId: "u1",
        isAuthenticated: true,
        agentType: "power",
        plan: { name: "self-hosted", limits: { aiRequests: 999 }, features: ["*"] },
      },
      nodeConfig: {} as any,
      services: { posts: {} as any, users: {} as any },
    };

    await expect(tools.createCommunity(ctx as any, { name: "c1" })).resolves.toMatchObject({ community: { id: "c1" } });
    await expect(tools.updateCommunity(ctx as any, { communityId: "c1", description: "d" })).resolves.toMatchObject({
      community: { id: "c1", description: "d" },
    });
    await expect(tools.createChannel(ctx as any, { communityId: "c1", name: "general" })).resolves.toMatchObject({
      channel: { id: "ch1" },
    });
    await expect(tools.updateChannel(ctx as any, { communityId: "c1", channelId: "ch1", description: "new" })).resolves.toMatchObject({
      channel: { id: "ch1", description: "new" },
    });
    await expect(tools.deleteChannel(ctx as any, { communityId: "c1", channelId: "ch1" })).resolves.toMatchObject({
      deleted: true,
    });
    expect(fetchAppApi).toHaveBeenCalled();
  });
});
