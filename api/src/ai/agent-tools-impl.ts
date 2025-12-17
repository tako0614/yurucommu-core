/**
 * AI Agent Tools Implementation
 *
 * PLAN.md 6.4.2 で定義された tool の実装
 */

import type {
  AgentTools,
  ToolContext,
  DescribeNodeCapabilitiesInput,
  DescribeNodeCapabilitiesOutput,
  InspectServiceInput,
  InspectServiceOutput,
  UpdateTakosConfigInput,
  UpdateTakosConfigOutput,
  ApplyCodePatchInput,
  ApplyCodePatchOutput,
  RunAIActionInput,
  RunAIActionOutput,
  GetTimelineInput,
  GetTimelineOutput,
  GetPostInput,
  GetPostOutput,
  GetUserInput,
  GetUserOutput,
  SearchPostsInput,
  SearchPostsOutput,
  SearchUsersInput,
  SearchUsersOutput,
  GetNotificationsInput,
  GetNotificationsOutput,
  GetDmThreadsInput,
  GetDmThreadsOutput,
  GetDmMessagesInput,
  GetDmMessagesOutput,
  CreatePostToolInput,
  CreatePostToolOutput,
  FollowInput,
  FollowOutput,
  GetBookmarksInput,
  GetBookmarksOutput,
} from "@takos/platform/ai/agent-tools";
import { requireAuthenticated, checkDataPolicy } from "@takos/platform/ai/agent-tools";
import type { AiRegistry } from "@takos/platform/ai/action-registry";
import type { TakosConfig } from "@takos/platform/config/takos-config";

/**
 * App Layer fetch function type
 * App Layer REST API を呼び出すための関数
 */
export type AppFetchFn = (path: string, init?: RequestInit) => Promise<Response>;

/**
 * Agent Tools の実装を作成
 */
export function createAgentTools(options: {
  aiRegistry: AiRegistry;
  getConfig: () => TakosConfig;
  updateConfig: (path: string, value: unknown) => Promise<void>;
  /** App Layer REST API を呼び出す関数 */
  fetchApp?: AppFetchFn;
}): AgentTools {
  const { aiRegistry, getConfig, updateConfig, fetchApp } = options;

  /**
   * App Layer API を呼び出すヘルパー
   */
  const callAppApi = async <T>(
    ctx: ToolContext,
    path: string,
    init?: RequestInit,
  ): Promise<T> => {
    // fetchApp が提供されていればそれを使用
    if (fetchApp) {
      const res = await fetchApp(path, init);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`App API error (${res.status}): ${text}`);
      }
      return res.json() as Promise<T>;
    }

    // services 経由で fetch する（将来の拡張用）
    throw new Error("App API access not configured. Provide fetchApp option.");
  };

  return {
    /**
     * 1. describeNodeCapabilities
     */
    async describeNodeCapabilities(
      ctx: ToolContext,
      input: DescribeNodeCapabilitiesInput,
    ): Promise<DescribeNodeCapabilitiesOutput> {
      const config = ctx.nodeConfig;
      const level = input.level || "basic";

      const availableActions = aiRegistry.listActions();
      const enabledActions = config.ai?.enabled_actions || [];

      const output: DescribeNodeCapabilitiesOutput = {
        coreVersion: (config.gates?.core_version as string) || "unknown",
        distroName: config.distro?.name || "takos",
        distroVersion: config.distro?.version || "unknown",
        availableActions: level === "full" ? availableActions : [],
        enabledActions,
        features: {
          activitypub: true,
          communities: true,
          stories: true,
          dm: true,
        },
      };

      if (level === "full" && config.ai?.data_policy) {
        output.dataPolicy = {
          sendPublicPosts: config.ai.data_policy.send_public_posts ?? false,
          sendCommunityPosts: config.ai.data_policy.send_community_posts ?? false,
          sendDm: config.ai.data_policy.send_dm ?? false,
          sendProfile: config.ai.data_policy.send_profile ?? false,
        };
      }

      return output;
    },

    /**
     * 2. inspectService
     */
    async inspectService(
      ctx: ToolContext,
      input: InspectServiceInput,
    ): Promise<InspectServiceOutput> {
      // Core Kernel サービス API のメタデータを返す
      // 実際の実装では、各サービスの型定義から自動生成することも可能

      const services = [
        {
          name: "posts",
          description: "Post creation, update, deletion, and timeline operations",
          methods: [
            {
              name: "createPost",
              description: "Create a new post",
              parameters: [
                { name: "ctx", type: "AppAuthContext", required: true },
                { name: "input", type: "CreatePostInput", required: true },
              ],
              returnType: "Promise<Post>",
            },
            {
              name: "updatePost",
              description: "Update an existing post",
              parameters: [
                { name: "ctx", type: "AppAuthContext", required: true },
                { name: "input", type: "UpdatePostInput", required: true },
              ],
              returnType: "Promise<Post>",
            },
            {
              name: "deletePost",
              description: "Delete a post",
              parameters: [
                { name: "ctx", type: "AppAuthContext", required: true },
                { name: "id", type: "string", required: true },
              ],
              returnType: "Promise<void>",
            },
            {
              name: "listTimeline",
              description: "List posts from timeline",
              parameters: [
                { name: "ctx", type: "AppAuthContext", required: true },
                { name: "params", type: "TimelineParams", required: true },
              ],
              returnType: "Promise<PostPage>",
            },
          ],
        },
        {
          name: "dm",
          description: "Direct message and chat operations",
          methods: [
            {
              name: "openThread",
              description: "Open or create a DM thread",
              parameters: [
                { name: "ctx", type: "AppAuthContext", required: true },
                { name: "input", type: "OpenThreadInput", required: true },
              ],
              returnType: "Promise<{ threadId: string; messages: DmMessage[] }>",
            },
            {
              name: "sendMessage",
              description: "Send a DM message",
              parameters: [
                { name: "ctx", type: "AppAuthContext", required: true },
                { name: "input", type: "SendMessageInput", required: true },
              ],
              returnType: "Promise<DmMessage>",
            },
            {
              name: "listThreads",
              description: "List DM threads",
              parameters: [
                { name: "ctx", type: "AppAuthContext", required: true },
                { name: "params", type: "ListThreadsParams", required: true },
              ],
              returnType: "Promise<DmThreadPage>",
            },
          ],
        },
        {
          name: "stories",
          description: "Story creation and retrieval (24-hour ephemeral content)",
          methods: [
            {
              name: "createStory",
              description: "Create a new story",
              parameters: [
                { name: "ctx", type: "AppAuthContext", required: true },
                { name: "input", type: "CreateStoryInput", required: true },
              ],
              returnType: "Promise<Story>",
            },
            {
              name: "listStories",
              description: "List stories",
              parameters: [
                { name: "ctx", type: "AppAuthContext", required: true },
                { name: "params", type: "ListStoriesParams", required: true },
              ],
              returnType: "Promise<StoryPage>",
            },
          ],
        },
        {
          name: "users",
          description: "User management and social graph operations",
          methods: [
            {
              name: "getUserProfile",
              description: "Get user profile",
              parameters: [
                { name: "ctx", type: "AppAuthContext", required: true },
                { name: "userId", type: "string", required: true },
              ],
              returnType: "Promise<User | null>",
            },
            {
              name: "followUser",
              description: "Follow a user",
              parameters: [
                { name: "ctx", type: "AppAuthContext", required: true },
                { name: "targetUserId", type: "string", required: true },
              ],
              returnType: "Promise<void>",
            },
          ],
        },
        {
          name: "communities",
          description: "Community and channel management",
          methods: [
            {
              name: "createCommunity",
              description: "Create a new community",
              parameters: [
                { name: "ctx", type: "AppAuthContext", required: true },
                { name: "input", type: "CreateCommunityInput", required: true },
              ],
              returnType: "Promise<Community>",
            },
            {
              name: "listCommunities",
              description: "List communities",
              parameters: [
                { name: "ctx", type: "AppAuthContext", required: true },
                { name: "params", type: "ListCommunitiesParams", required: true },
              ],
              returnType: "Promise<CommunityPage>",
            },
          ],
        },
      ];

      // フィルタリング
      if (input.serviceName) {
        const filtered = services.filter((s) => s.name === input.serviceName);
        return { services: filtered };
      }

      return { services };
    },

    /**
     * 3. updateTakosConfig
     */
    async updateTakosConfig(
      ctx: ToolContext,
      input: UpdateTakosConfigInput,
    ): Promise<UpdateTakosConfigOutput> {
      requireAuthenticated(ctx);

      const { path, value } = input;

      // Allowlist チェック（AI が変更可能なキーのみ許可）
      const allowedPaths = [
        "ai.enabled_actions",
        "ai.default_provider",
        "custom.ai.",
      ];

      const isAllowed = allowedPaths.some((allowed) => {
        if (allowed.endsWith(".")) {
          return path.startsWith(allowed);
        }
        return path === allowed;
      });

      if (!isAllowed) {
        throw new Error(`AI is not allowed to modify config path: ${path}`);
      }

      // 前の値を取得
      const config = getConfig();
      const previousValue = getValueByPath(config, path);

      // 更新実行
      await updateConfig(path, value);

      return {
        success: true,
        updatedPath: path,
        newValue: value,
        previousValue,
      };
    },

    /**
     * 4. applyCodePatch
     */
    async applyCodePatch(
      ctx: ToolContext,
      input: ApplyCodePatchInput,
    ): Promise<ApplyCodePatchOutput> {
      requireAuthenticated(ctx);

      const workspaceId = input.workspaceId || "default";
      const { filePath, patch, description } = input;

      // Note: この実装は概念的なものです
      // 実際の実装では、Workspace Store APIを通じてパッチを適用します
      // 詳細は api/src/routes/app-manager.ts の apply-patch エンドポイントを参照

      // 今のところ、Workspace API経由での適用が必要なため、
      // 直接的なツール実装ではなく、適用方法を案内します

      return {
        success: false,
        workspaceId,
        filePath,
        message: [
          "Code patch application requires using the Workspace API:",
          `POST /-/app/workspaces/${workspaceId}/apply-patch`,
          "with the patch content in the request body.",
          "This tool provides the conceptual interface;",
          "actual implementation should use the Workspace management endpoints.",
        ].join("\n"),
      };

      // Production implementation would:
      // 1. Validate workspace exists
      // 2. Apply patch to workspace file
      // 3. Run validation
      // 4. Return result
    },

    /**
     * 5. runAIAction
     */
    async runAIAction(
      ctx: ToolContext,
      input: RunAIActionInput,
    ): Promise<RunAIActionOutput> {
      const { actionId, input: actionInput } = input;

      // 有効化チェック
      const enabledActions = ctx.nodeConfig.ai?.enabled_actions || [];
      if (!enabledActions.includes(actionId)) {
        throw new Error(`AI Action "${actionId}" is not enabled in this node`);
      }

      // アクション取得
      const action = aiRegistry.getAction(actionId);
      if (!action) {
        throw new Error(`AI Action "${actionId}" not found`);
      }

      // データポリシーチェック
      if (action.definition.dataPolicy) {
        checkDataPolicy(ctx, action.definition.dataPolicy);
      }

      // 実行
      try {
        const actionContext = {
          nodeConfig: ctx.nodeConfig,
          auth: ctx.auth,
          env: ctx.env,
        };

        const output = await action.handler(actionContext, actionInput);

        return {
          success: true,
          output,
        };
      } catch (error: unknown) {
        return {
          success: false,
          output: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    /**
     * 6. getTimeline
     */
    async getTimeline(
      ctx: ToolContext,
      input: GetTimelineInput,
    ): Promise<GetTimelineOutput> {
      requireAuthenticated(ctx);

      const params = new URLSearchParams();
      if (input.limit) params.set("limit", String(input.limit));
      if (input.cursor) params.set("cursor", input.cursor);
      if (input.only_media) params.set("only_media", "true");
      if (input.include_direct) params.set("include_direct", "true");
      if (input.visibility?.length) params.set("visibility", input.visibility.join(","));

      const path = `/timeline/${input.type}?${params.toString()}`;
      const data = await callAppApi<{ items?: unknown[]; posts?: unknown[]; nextCursor?: string | null }>(ctx, path);

      const items = data.items ?? data.posts ?? [];
      return {
        type: input.type,
        items,
        posts: items,
        nextCursor: data.nextCursor ?? null,
        hasMore: !!data.nextCursor,
      };
    },

    /**
     * 7. getPost
     */
    async getPost(
      ctx: ToolContext,
      input: GetPostInput,
    ): Promise<GetPostOutput> {
      const path = `/objects/${encodeURIComponent(input.id)}${input.includeThread ? "?include_thread=true" : ""}`;
      try {
        const data = await callAppApi<{ post?: unknown; thread?: unknown[] }>(ctx, path);
        return {
          post: data.post ?? data,
          thread: data.thread ?? null,
        };
      } catch {
        return { post: null };
      }
    },

    /**
     * 8. getUser
     */
    async getUser(
      ctx: ToolContext,
      input: GetUserInput,
    ): Promise<GetUserOutput> {
      const path = `/users/${encodeURIComponent(input.id)}`;
      try {
        const user = await callAppApi<unknown>(ctx, path);
        return { user };
      } catch {
        return { user: null };
      }
    },

    /**
     * 9. searchPosts
     */
    async searchPosts(
      ctx: ToolContext,
      input: SearchPostsInput,
    ): Promise<SearchPostsOutput> {
      const params = new URLSearchParams();
      params.set("q", input.query);
      if (input.limit) params.set("limit", String(input.limit));
      if (input.offset) params.set("offset", String(input.offset));

      const path = `/search/posts?${params.toString()}`;
      const data = await callAppApi<{ posts?: unknown[]; items?: unknown[]; next_offset?: number | null; nextCursor?: string | null }>(ctx, path);

      return {
        posts: data.posts ?? data.items ?? [],
        next_offset: data.next_offset ?? null,
        next_cursor: data.nextCursor ?? null,
      };
    },

    /**
     * 10. searchUsers
     */
    async searchUsers(
      ctx: ToolContext,
      input: SearchUsersInput,
    ): Promise<SearchUsersOutput> {
      const params = new URLSearchParams();
      params.set("q", input.query);
      if (input.limit) params.set("limit", String(input.limit));
      if (input.offset) params.set("offset", String(input.offset));
      if (input.local_only) params.set("local_only", "true");

      const path = `/search/users?${params.toString()}`;
      const data = await callAppApi<{ users?: unknown[]; items?: unknown[]; next_offset?: number | null; nextCursor?: string | null }>(ctx, path);

      return {
        users: data.users ?? data.items ?? [],
        next_offset: data.next_offset ?? null,
        next_cursor: data.nextCursor ?? null,
      };
    },

    /**
     * 11. getNotifications
     */
    async getNotifications(
      ctx: ToolContext,
      input: GetNotificationsInput,
    ): Promise<GetNotificationsOutput> {
      requireAuthenticated(ctx);

      const params = new URLSearchParams();
      if (input.since) params.set("since", input.since);

      const path = `/notifications?${params.toString()}`;
      const data = await callAppApi<{ notifications?: unknown[]; items?: unknown[] }>(ctx, path);

      return {
        notifications: data.notifications ?? data.items ?? [],
      };
    },

    /**
     * 12. getDmThreads
     */
    async getDmThreads(
      ctx: ToolContext,
      input: GetDmThreadsInput,
    ): Promise<GetDmThreadsOutput> {
      requireAuthenticated(ctx);
      checkDataPolicy(ctx, { sendDm: true });

      const params = new URLSearchParams();
      if (input.limit) params.set("limit", String(input.limit));
      if (input.offset) params.set("offset", String(input.offset));

      const path = `/dm/threads?${params.toString()}`;
      const data = await callAppApi<{ threads?: unknown[]; next_offset?: number | null }>(ctx, path);

      return {
        threads: data.threads ?? [],
        next_offset: data.next_offset ?? null,
      };
    },

    /**
     * 13. getDmMessages
     */
    async getDmMessages(
      ctx: ToolContext,
      input: GetDmMessagesInput,
    ): Promise<GetDmMessagesOutput> {
      requireAuthenticated(ctx);
      checkDataPolicy(ctx, { sendDm: true });

      const params = new URLSearchParams();
      if (input.limit) params.set("limit", String(input.limit));
      if (input.offset) params.set("offset", String(input.offset));
      if (input.since_id) params.set("since_id", input.since_id);
      if (input.max_id) params.set("max_id", input.max_id);

      const path = `/dm/threads/${encodeURIComponent(input.thread_id)}/messages?${params.toString()}`;
      const data = await callAppApi<{ messages?: unknown[]; next_offset?: number | null }>(ctx, path);

      return {
        messages: data.messages ?? [],
        next_offset: data.next_offset ?? null,
      };
    },

    /**
     * 14. createPost
     */
    async createPost(
      ctx: ToolContext,
      input: CreatePostToolInput,
    ): Promise<CreatePostToolOutput> {
      requireAuthenticated(ctx);

      // Data policy check based on visibility
      if (input.visibility === "direct") {
        checkDataPolicy(ctx, { sendDm: true });
      } else if (input.visibility === "community") {
        checkDataPolicy(ctx, { sendCommunityPosts: true });
      } else {
        checkDataPolicy(ctx, { sendPublicPosts: true });
      }

      const body = {
        content: input.content,
        visibility: input.visibility ?? "public",
        community_id: input.community_id,
        in_reply_to: input.reply_to,
        media_ids: input.media_ids,
        sensitive: input.sensitive,
        spoiler_text: input.spoiler_text,
        poll: input.poll,
      };

      const post = await callAppApi<unknown>(ctx, "/objects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      return { post };
    },

    /**
     * 15. follow
     */
    async follow(
      ctx: ToolContext,
      input: FollowInput,
    ): Promise<FollowOutput> {
      requireAuthenticated(ctx);

      await callAppApi<unknown>(ctx, `/users/${encodeURIComponent(input.targetUserId)}/follow`, {
        method: "POST",
      });

      return { success: true };
    },

    /**
     * 15. unfollow
     */
    async unfollow(
      ctx: ToolContext,
      input: FollowInput,
    ): Promise<FollowOutput> {
      requireAuthenticated(ctx);

      await callAppApi<unknown>(ctx, `/users/${encodeURIComponent(input.targetUserId)}/unfollow`, {
        method: "POST",
      });

      return { success: true };
    },

    /**
     * 16. getBookmarks
     */
    async getBookmarks(
      ctx: ToolContext,
      input: GetBookmarksInput,
    ): Promise<GetBookmarksOutput> {
      requireAuthenticated(ctx);

      const params = new URLSearchParams();
      if (input.limit) params.set("limit", String(input.limit));
      if (input.offset) params.set("offset", String(input.offset));

      const path = `/bookmarks?${params.toString()}`;
      const data = await callAppApi<{ items?: unknown[]; bookmarks?: unknown[]; next_offset?: number | null }>(ctx, path);

      return {
        items: data.items ?? data.bookmarks ?? [],
        next_offset: data.next_offset ?? null,
      };
    },
  };
}

/**
 * ドット記法のパスから値を取得
 */
function getValueByPath(obj: any, path: string): unknown {
  const keys = path.split(".");
  let current = obj;

  for (const key of keys) {
    if (current == null || typeof current !== "object") {
      return undefined;
    }
    current = current[key];
  }

  return current;
}
