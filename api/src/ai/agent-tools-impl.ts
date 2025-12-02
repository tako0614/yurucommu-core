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
} from "@takos/platform/ai/agent-tools";
import { requireAuthenticated, checkDataPolicy } from "@takos/platform/ai/agent-tools";
import type { AiRegistry } from "@takos/platform/ai/action-registry";
import type { TakosConfig } from "@takos/platform/config/takos-config";

/**
 * Agent Tools の実装を作成
 */
export function createAgentTools(options: {
  aiRegistry: AiRegistry;
  getConfig: () => TakosConfig;
  updateConfig: (path: string, value: unknown) => Promise<void>;
}): AgentTools {
  const { aiRegistry, getConfig, updateConfig } = options;

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
        coreVersion: config.profile?.core_version || "unknown",
        distroName: config.profile?.name || "takos",
        distroVersion: config.profile?.version || "unknown",
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
          sendPublicPosts: config.ai.data_policy.sendPublicPosts ?? false,
          sendCommunityPosts: config.ai.data_policy.sendCommunityPosts ?? false,
          sendDm: config.ai.data_policy.sendDm ?? false,
          sendProfile: config.ai.data_policy.sendProfile ?? false,
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
