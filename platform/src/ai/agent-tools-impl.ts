/**
 * AI Agent Tools Implementation
 *
 * PLAN.md 6.4.2 で定義された tool 群の実装
 */

import type {
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
  AgentTools,
} from "./agent-tools.js";
import { dispatchAiAction, type AiRegistry, type AiActionDefinition } from "./action-registry.js";
import type { ProposalQueue, ProposalMetadata } from "./proposal-queue.js";
import { assertToolAllowedForAgent, type AgentToolId } from "./agent-policy.js";
import {
  buildAiProviderRegistry,
  DEFAULT_TAKOS_AI_CONFIG,
  mergeTakosAiConfig,
  type AiProviderRegistry,
} from "./provider-registry.js";
import type { TakosAiConfig } from "../config/takos-config.js";
import type { AppAuthContext } from "../app/runtime/types.js";

/**
 * 設定変更の禁止リスト（PLAN.md 6.4.3）
 */
const FORBIDDEN_CONFIG_PATHS = [
  // ノード同一性に関わる情報
  "node.url",
  "node.instance_name",
  "node.registration",
  // federation の有無や範囲に直接影響する情報
  "activitypub.federation_enabled",
  "activitypub.blocked_instances",
  // メタデータ / システム内部情報
  "metadata",
];

/**
 * パスが禁止リストに含まれるかチェック
 */
function isForbiddenConfigPath(path: string): boolean {
  const normalizedPath = path.toLowerCase();
  return FORBIDDEN_CONFIG_PATHS.some((forbidden) =>
    normalizedPath === forbidden.toLowerCase() ||
    normalizedPath.startsWith(`${forbidden.toLowerCase()}.`)
  );
}

/**
 * パスが許可リストに含まれるかチェック
 */
function isAllowedConfigPath(path: string, allowlist: string[]): boolean {
  const normalizedPath = path.toLowerCase();
  return allowlist.some((allowed) =>
    normalizedPath === allowed.toLowerCase() ||
    normalizedPath.startsWith(`${allowed.toLowerCase()}.`)
  );
}

/**
 * オブジェクトからドット記法のパスで値を取得
 */
function getValueByPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Agent Tools Factory Options
 */
export interface AgentToolsFactoryOptions {
  /** AI Action Registry */
  actionRegistry: AiRegistry;
  /** AI Provider registry (pre-built) */
  providerRegistry?: AiProviderRegistry | null;
  /** Build provider registry on demand */
  buildProviderRegistry?: (config: TakosAiConfig | undefined, env?: Record<string, unknown>) => AiProviderRegistry;
  /** 提案キュー（手動承認モード用） */
  proposalQueue?: ProposalQueue;
  /** 設定変更の allowlist */
  configAllowlist?: string[];
  /** Workspace 操作用のコールバック */
  workspaceOps?: {
    applyPatch: (workspaceId: string, filePath: string, patch: string) => Promise<{ success: boolean; message: string }>;
    getDefaultWorkspaceId: () => string;
  };
  /** 設定保存用のコールバック */
  configOps?: {
    saveConfig: (path: string, value: unknown) => Promise<void>;
  };
  /** 任意の監査ロガー */
  auditLog?: (event: { tool: string; agentType?: string | null; userId?: string | null; success: boolean; message?: string }) => Promise<void> | void;
  /** 手動承認モードかどうか（デフォルト: false） */
  requireApproval?: boolean;
}

/**
 * Core Kernel サービスのメタ情報
 */
const SERVICE_METADATA: Record<string, { description: string; methods: Array<{ name: string; description: string; parameters: Array<{ name: string; type: string; required: boolean }>; returnType: string }> }> = {
  posts: {
    description: "投稿（Microblog）の操作",
    methods: [
      { name: "createPost", description: "新規投稿を作成", parameters: [{ name: "input", type: "CreatePostInput", required: true }], returnType: "Post" },
      { name: "updatePost", description: "投稿を更新", parameters: [{ name: "input", type: "UpdatePostInput", required: true }], returnType: "Post" },
      { name: "deletePost", description: "投稿を削除", parameters: [{ name: "id", type: "string", required: true }], returnType: "void" },
      { name: "getPost", description: "投稿を取得", parameters: [{ name: "id", type: "string", required: true }], returnType: "Post | null" },
      { name: "listTimeline", description: "タイムラインを取得", parameters: [{ name: "params", type: "TimelineParams", required: false }], returnType: "PostPage" },
      { name: "reactToPost", description: "投稿にリアクション", parameters: [{ name: "input", type: "ReactToPostInput", required: true }], returnType: "void" },
    ],
  },
  users: {
    description: "ユーザーの操作",
    methods: [
      { name: "getUser", description: "ユーザー情報を取得", parameters: [{ name: "userId", type: "string", required: true }], returnType: "User | null" },
      { name: "searchUsers", description: "ユーザーを検索", parameters: [{ name: "params", type: "UserSearchParams", required: false }], returnType: "UserPage" },
      { name: "follow", description: "ユーザーをフォロー", parameters: [{ name: "targetUserId", type: "string", required: true }], returnType: "void" },
      { name: "unfollow", description: "フォローを解除", parameters: [{ name: "targetUserId", type: "string", required: true }], returnType: "void" },
      { name: "block", description: "ユーザーをブロック", parameters: [{ name: "targetUserId", type: "string", required: true }], returnType: "void" },
      { name: "mute", description: "ユーザーをミュート", parameters: [{ name: "targetUserId", type: "string", required: true }], returnType: "void" },
      { name: "listFollowers", description: "フォロワー一覧を取得", parameters: [{ name: "params", type: "PaginationParams", required: false }], returnType: "UserPage" },
      { name: "listFollowing", description: "フォロー中を取得", parameters: [{ name: "params", type: "PaginationParams", required: false }], returnType: "UserPage" },
    ],
  },
  communities: {
    description: "コミュニティの操作",
    methods: [
      { name: "createCommunity", description: "コミュニティを作成", parameters: [{ name: "input", type: "CreateCommunityInput", required: true }], returnType: "Community" },
      { name: "updateCommunity", description: "コミュニティを更新", parameters: [{ name: "input", type: "UpdateCommunityInput", required: true }], returnType: "Community" },
      { name: "getCommunity", description: "コミュニティを取得", parameters: [{ name: "communityId", type: "string", required: true }], returnType: "Community | null" },
      { name: "listCommunities", description: "コミュニティ一覧を取得", parameters: [{ name: "params", type: "CommunityListParams", required: false }], returnType: "CommunityPage" },
      { name: "joinCommunity", description: "コミュニティに参加", parameters: [{ name: "communityId", type: "string", required: true }], returnType: "void" },
      { name: "leaveCommunity", description: "コミュニティから退出", parameters: [{ name: "communityId", type: "string", required: true }], returnType: "void" },
    ],
  },
  dm: {
    description: "DM（ダイレクトメッセージ）の操作",
    methods: [
      { name: "openThread", description: "DMスレッドを開く", parameters: [{ name: "input", type: "OpenThreadInput", required: true }], returnType: "{ threadId: string; messages: DmMessage[] }" },
      { name: "sendMessage", description: "DMを送信", parameters: [{ name: "input", type: "SendMessageInput", required: true }], returnType: "DmMessage" },
      { name: "listThreads", description: "DMスレッド一覧を取得", parameters: [{ name: "params", type: "ListThreadsParams", required: false }], returnType: "DmThreadPage" },
      { name: "listMessages", description: "メッセージ一覧を取得", parameters: [{ name: "params", type: "ListMessagesParams", required: true }], returnType: "DmMessagePage" },
    ],
  },
  stories: {
    description: "ストーリーの操作",
    methods: [
      { name: "createStory", description: "ストーリーを作成", parameters: [{ name: "input", type: "CreateStoryInput", required: true }], returnType: "Story" },
      { name: "getStory", description: "ストーリーを取得", parameters: [{ name: "id", type: "string", required: true }], returnType: "Story | null" },
      { name: "listStories", description: "ストーリー一覧を取得", parameters: [{ name: "params", type: "ListStoriesParams", required: false }], returnType: "StoryPage" },
      { name: "deleteStory", description: "ストーリーを削除", parameters: [{ name: "id", type: "string", required: true }], returnType: "void" },
    ],
  },
};

/**
 * Agent Tools ファクトリ
 */
export function createAgentTools(options: AgentToolsFactoryOptions): AgentTools {
  const {
    actionRegistry,
    proposalQueue,
    configAllowlist = ["ai.enabled", "ai.default_provider", "ai.enabled_actions", "ui.theme", "ui.accent_color"],
    workspaceOps,
    configOps,
    providerRegistry,
    buildProviderRegistry,
    auditLog,
    requireApproval = false,
  } = options;

  const resolveProviders = (
    aiConfig: TakosAiConfig | undefined,
    env?: Record<string, unknown>,
  ): AiProviderRegistry | null => {
    if (providerRegistry) return providerRegistry;
    if (typeof buildProviderRegistry === "function") {
      return buildProviderRegistry(aiConfig, env);
    }
    try {
      const merged = mergeTakosAiConfig(DEFAULT_TAKOS_AI_CONFIG, aiConfig ?? {});
      return buildAiProviderRegistry(merged, (env ?? {}) as Record<string, string | undefined>);
    } catch (error) {
      console.warn("agent-tools: failed to resolve AI provider registry", error);
      return null;
    }
  };

  const ensureAiPlanAllowed = (ctx: ToolContext): void => {
    const features = ctx.auth.plan?.features ?? ["*"];
    if (!features.includes("*") && !features.includes("ai")) {
      throw new Error("AI features are not available on this plan");
    }
    const limit = ctx.auth.plan?.limits?.aiRequests;
    if (typeof limit === "number" && limit <= 0) {
      throw new Error("AI request quota is not available on this plan");
    }
  };

  const ensureAgentToolAllowed = (ctx: ToolContext, toolId: AgentToolId): void => {
    if (!ctx.auth.agentType) return;
    assertToolAllowedForAgent(ctx.auth.agentType, toolId);
  };

  const toAppAuthContext = (ctx: ToolContext): AppAuthContext => {
    const planLimits = ctx.auth.plan?.limits ?? {};
    const baseLimits = {
      storage: planLimits.storage ?? Number.MAX_SAFE_INTEGER,
      fileSize: planLimits.fileSize ?? Number.MAX_SAFE_INTEGER,
      aiRequests: planLimits.aiRequests ?? Number.MAX_SAFE_INTEGER,
      dmMessagesPerDay: Number.MAX_SAFE_INTEGER,
      dmMediaSize: Number.MAX_SAFE_INTEGER,
    };
    return {
      userId: ctx.auth.userId ?? null,
      sessionId: null,
      isAuthenticated: ctx.auth.isAuthenticated,
      plan: {
        name: ctx.auth.plan?.name ?? "self-hosted",
        limits: baseLimits,
        features: ctx.auth.plan?.features ?? ["*"],
      },
      limits: baseLimits,
    };
  };

  const withAudit = async <T,>(
    ctx: ToolContext,
    tool: AgentToolId,
    run: () => Promise<T>,
  ): Promise<T> => {
    try {
      const result = await run();
      await auditLog?.({ tool, agentType: ctx.auth.agentType, userId: ctx.auth.userId, success: true });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await auditLog?.({ tool, agentType: ctx.auth.agentType, userId: ctx.auth.userId, success: false, message });
      throw error;
    }
  };

  const describeNodeCapabilities = async (
    ctx: ToolContext,
    input: DescribeNodeCapabilitiesInput,
  ): Promise<DescribeNodeCapabilitiesOutput> => {
    const config = ctx.nodeConfig;
    const allActions = actionRegistry.listActions();
    const enabledActions = config.ai?.enabled_actions ?? [];

    return {
      coreVersion: config.schema_version ?? "1.0",
      distroName: config.distro?.name ?? "takos-oss",
      distroVersion: config.distro?.version ?? "0.1.0",
      availableActions: input.level === "full" ? allActions : allActions.map((a: AiActionDefinition) => ({
        id: a.id,
        label: a.label,
        description: a.description,
        inputSchema: a.inputSchema,
        outputSchema: a.outputSchema,
        providerCapabilities: a.providerCapabilities,
        dataPolicy: a.dataPolicy,
      })),
      enabledActions,
      features: {
        activitypub: true,
        communities: true,
        stories: true,
        dm: true,
      },
      dataPolicy: config.ai?.data_policy ? {
        sendPublicPosts: config.ai.data_policy.send_public_posts ?? true,
        sendCommunityPosts: config.ai.data_policy.send_community_posts ?? false,
        sendDm: config.ai.data_policy.send_dm ?? false,
        sendProfile: config.ai.data_policy.send_profile ?? true,
      } : undefined,
    };
  };

  const inspectService = async (
    ctx: ToolContext,
    input: InspectServiceInput,
  ): Promise<InspectServiceOutput> => {
    if (input.serviceName) {
      const meta = SERVICE_METADATA[input.serviceName];
      if (!meta) {
        return { services: [] };
      }
      return {
        services: [{
          name: input.serviceName,
          description: meta.description,
          methods: meta.methods,
        }],
      };
    }

    return {
      services: Object.entries(SERVICE_METADATA).map(([name, meta]) => ({
        name,
        description: meta.description,
        methods: meta.methods,
      })),
    };
  };

  const updateTakosConfig = async (
    ctx: ToolContext,
    input: UpdateTakosConfigInput,
  ): Promise<UpdateTakosConfigOutput> => {
    ensureAgentToolAllowed(ctx, "tool.updateTakosConfig");
    // 認証チェック
    if (!ctx.auth.isAuthenticated) {
      throw new Error("Authentication required");
    }

    // 禁止リストチェック
    if (isForbiddenConfigPath(input.path)) {
      throw new Error(`ForbiddenKey: ${input.path} cannot be modified by AI`);
    }

    // 許可リストチェック
    if (!isAllowedConfigPath(input.path, configAllowlist)) {
      throw new Error(`NotAllowed: ${input.path} is not in the allowlist for AI modification`);
    }

    const previousValue = getValueByPath(ctx.nodeConfig, input.path);

    // 手動承認モードの場合は提案キューに追加
    if (requireApproval && proposalQueue) {
      const metadata: ProposalMetadata = {
        agentType: "system",
        reason: input.confirmMessage ?? `AI requested to update ${input.path}`,
      };
      const proposal = await proposalQueue.create({
        type: "config_change",
        path: input.path,
        currentValue: previousValue,
        proposedValue: input.value,
      }, metadata);

      return {
        success: false, // 提案として保存されたが、まだ適用されていない
        updatedPath: input.path,
        newValue: input.value,
        previousValue,
      };
    }

    // 直接適用モード
    if (configOps?.saveConfig) {
      await configOps.saveConfig(input.path, input.value);
    }

    return {
      success: true,
      updatedPath: input.path,
      newValue: input.value,
      previousValue,
    };
  };

  const applyCodePatch = async (
    ctx: ToolContext,
    input: ApplyCodePatchInput,
  ): Promise<ApplyCodePatchOutput> => {
    ensureAgentToolAllowed(ctx, "tool.applyCodePatch");
    // 認証チェック
    if (!ctx.auth.isAuthenticated) {
      throw new Error("Authentication required");
    }

    // Workspace 操作が利用可能かチェック
    if (!workspaceOps) {
      throw new Error("Workspace operations not configured");
    }

    const workspaceId = input.workspaceId ?? workspaceOps.getDefaultWorkspaceId();

    // 手動承認モードの場合は提案キューに追加
    if (requireApproval && proposalQueue) {
      const metadata: ProposalMetadata = {
        agentType: "dev",
        reason: input.description ?? `Apply patch to ${input.filePath}`,
      };
      await proposalQueue.create({
        type: "code_patch",
        workspaceId,
        filePath: input.filePath,
        patch: input.patch,
        description: input.description,
      }, metadata);

      return {
        success: false, // 提案として保存されたが、まだ適用されていない
        workspaceId,
        filePath: input.filePath,
        message: "Patch proposal created, awaiting approval",
      };
    }

    // 直接適用モード
    const result = await workspaceOps.applyPatch(workspaceId, input.filePath, input.patch);
    return {
      success: result.success,
      workspaceId,
      filePath: input.filePath,
      message: result.message,
    };
  };

  const runAIAction = async (
    ctx: ToolContext,
    input: RunAIActionInput,
  ): Promise<RunAIActionOutput> => {
    ensureAgentToolAllowed(ctx, "tool.runAIAction");
    ensureAiPlanAllowed(ctx);

    // アクションが登録されているかチェック
    const action = actionRegistry.getAction(input.actionId);
    if (!action) {
      return {
        success: false,
        output: null,
        error: `Action not found: ${input.actionId}`,
      };
    }

    // アクションが有効化されているかチェック
    const enabledActions = ctx.nodeConfig.ai?.enabled_actions ?? [];
    if (!enabledActions.includes(input.actionId)) {
      return {
        success: false,
        output: null,
        error: `Action not enabled: ${input.actionId}`,
      };
    }

    try {
      const aiConfig = mergeTakosAiConfig(
        DEFAULT_TAKOS_AI_CONFIG,
        (ctx.nodeConfig as any)?.ai ?? {},
      );
      const providers = resolveProviders(aiConfig, ctx.env);
      if (!providers) {
        return {
          success: false,
          output: null,
          error: "AI providers are not configured for this node",
        };
      }

      const appAuth = toAppAuthContext(ctx);

      const output = await dispatchAiAction(
        actionRegistry,
        input.actionId,
        {
          auth: {
            userId: ctx.auth.userId,
            roles: ctx.auth.isAuthenticated ? ["authenticated"] : [],
            agentType: ctx.auth.agentType,
          },
          nodeConfig: { ...ctx.nodeConfig, ai: aiConfig } as any,
          providers,
          services: ctx.services,
          appAuth,
        },
        input.input,
      );

      auditLog?.({
        tool: "tool.runAIAction",
        agentType: ctx.auth.agentType,
        userId: ctx.auth.userId,
        success: true,
      });

      return { success: true, output };
    } catch (error) {
      auditLog?.({
        tool: "tool.runAIAction",
        agentType: ctx.auth.agentType,
        userId: ctx.auth.userId,
        success: false,
        message: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        output: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  return {
    describeNodeCapabilities,
    inspectService,
    updateTakosConfig,
    applyCodePatch,
    runAIAction,
    getTimeline: async (ctx: ToolContext, input: GetTimelineInput): Promise<GetTimelineOutput> =>
      withAudit(ctx, "tool.getTimeline", async () => {
        ensureAgentToolAllowed(ctx, "tool.getTimeline");
        if (!ctx.services) throw new Error("Core services are not available");
        const auth = toAppAuthContext(ctx);

        const limit = input.limit ?? 50;
        const cursor = input.cursor;
        const visibility = input.visibility;
        const onlyMedia = input.only_media;
        const includeDirect = input.include_direct;

        if (input.type === "home") {
          if (!auth.isAuthenticated || !auth.userId) throw new Error("Authentication required");
          const following = await ctx.services.users.listFollowing(auth, { limit: 1000, offset: 0 });
          const actorIds = new Set<string>([auth.userId]);
          for (const entry of following.users ?? []) {
            const id = (entry as any)?.id?.toString?.() ?? "";
            if (id) actorIds.add(id);
          }

          if (!ctx.services.objects) {
            const page = await ctx.services.posts.listTimeline(auth, { limit, offset: cursor ? parseInt(cursor, 10) : 0 } as any);
            const posts = page.posts ?? [];
            return {
              type: input.type,
              items: posts,
              posts,
              nextCursor: page.next_cursor ?? null,
              hasMore: page.next_offset != null,
            };
          }

          const page = await ctx.services.objects.getTimeline(auth, {
            type: ["Note", "Article", "Question"],
            visibility: visibility ?? ["public", "unlisted", "followers", "community"],
            limit,
            cursor,
            actor: Array.from(actorIds),
            onlyMedia,
            includeDirect,
          });
          return {
            type: input.type,
            items: page.items,
            posts: page.items,
            nextCursor: page.nextCursor,
            hasMore: page.hasMore,
          };
        }

        if (!ctx.services.objects) {
          const page = await ctx.services.posts.listTimeline(auth, { limit, offset: cursor ? parseInt(cursor, 10) : 0 } as any);
          const posts = page.posts ?? [];
          return {
            type: input.type,
            items: posts,
            posts,
            nextCursor: page.next_cursor ?? null,
            hasMore: page.next_offset != null,
          };
        }

        const page = await ctx.services.objects.getTimeline(auth, {
          type: ["Note", "Article", "Question"],
          visibility: visibility ?? ["public", "unlisted", "community"],
          limit,
          cursor,
          onlyMedia,
          includeDirect,
        });
        return {
          type: input.type,
          items: page.items,
          posts: page.items,
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
        };
      }),

    getPost: async (ctx: ToolContext, input: GetPostInput): Promise<GetPostOutput> =>
      withAudit(ctx, "tool.getPost", async () => {
        ensureAgentToolAllowed(ctx, "tool.getPost");
        if (!ctx.services) throw new Error("Core services are not available");
        const auth = toAppAuthContext(ctx);

        if (ctx.services.objects) {
          const obj =
            (await ctx.services.objects.get(auth, input.id)) ??
            (await ctx.services.objects.getByLocalId(auth, input.id).catch(() => null));
          if (obj) {
            if (input.includeThread && typeof (obj as any).context === "string") {
              const thread = await ctx.services.objects.getThread(auth, (obj as any).context);
              return { post: obj, thread };
            }
            return { post: obj, thread: null };
          }
        }

        const post = await ctx.services.posts.getPost(auth, input.id);
        return { post, thread: null };
      }),

    getUser: async (ctx: ToolContext, input: GetUserInput): Promise<GetUserOutput> =>
      withAudit(ctx, "tool.getUser", async () => {
        ensureAgentToolAllowed(ctx, "tool.getUser");
        if (!ctx.services) throw new Error("Core services are not available");
        const auth = toAppAuthContext(ctx);
        const user = await ctx.services.users.getUser(auth, input.id);
        return { user };
      }),

    searchPosts: async (ctx: ToolContext, input: SearchPostsInput): Promise<SearchPostsOutput> =>
      withAudit(ctx, "tool.searchPosts", async () => {
        ensureAgentToolAllowed(ctx, "tool.searchPosts");
        if (!ctx.services) throw new Error("Core services are not available");
        const auth = toAppAuthContext(ctx);
        const page = await ctx.services.posts.searchPosts(auth, {
          query: input.query,
          limit: input.limit,
          offset: input.offset,
        });
        return {
          posts: page.posts ?? [],
          next_offset: page.next_offset ?? null,
          next_cursor: page.next_cursor ?? null,
        };
      }),

    searchUsers: async (ctx: ToolContext, input: SearchUsersInput): Promise<SearchUsersOutput> =>
      withAudit(ctx, "tool.searchUsers", async () => {
        ensureAgentToolAllowed(ctx, "tool.searchUsers");
        if (!ctx.services) throw new Error("Core services are not available");
        const auth = toAppAuthContext(ctx);
        const page = await ctx.services.users.searchUsers(auth, {
          query: input.query,
          limit: input.limit,
          offset: input.offset,
          local_only: input.local_only,
        } as any);
        return {
          users: page.users ?? [],
          next_offset: page.next_offset ?? null,
          next_cursor: page.next_cursor ?? null,
        };
      }),

    getNotifications: async (
      ctx: ToolContext,
      input: GetNotificationsInput,
    ): Promise<GetNotificationsOutput> =>
      withAudit(ctx, "tool.getNotifications", async () => {
        ensureAgentToolAllowed(ctx, "tool.getNotifications");
        if (!ctx.services) throw new Error("Core services are not available");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");
        const notifications = await ctx.services.users.listNotifications(auth, { since: input.since });
        return { notifications };
      }),

    // NOTE: DM サービスは App 層に移行済み (11-default-app.md)
    // AI ツールからの DM アクセスは /api/dm/* エンドポイント経由で行う
    getDmThreads: async (ctx: ToolContext, _input: GetDmThreadsInput): Promise<GetDmThreadsOutput> =>
      withAudit(ctx, "tool.getDmThreads", async () => {
        ensureAgentToolAllowed(ctx, "tool.getDmThreads");
        // DM サービスは App 層に移行済み - REST API を使用してください
        throw new Error("DM service has been moved to App layer. Use REST API /api/dm/threads instead.");
      }),

    getDmMessages: async (ctx: ToolContext, _input: GetDmMessagesInput): Promise<GetDmMessagesOutput> =>
      withAudit(ctx, "tool.getDmMessages", async () => {
        ensureAgentToolAllowed(ctx, "tool.getDmMessages");
        // DM サービスは App 層に移行済み - REST API を使用してください
        throw new Error("DM service has been moved to App layer. Use REST API /api/dm/threads/:threadId/messages instead.");
      }),

    createPost: async (ctx: ToolContext, input: CreatePostToolInput): Promise<CreatePostToolOutput> =>
      withAudit(ctx, "tool.createPost", async () => {
        ensureAgentToolAllowed(ctx, "tool.createPost");
        if (!ctx.services) throw new Error("Core services are not available");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");
        const post = await ctx.services.posts.createPost(auth, {
          content: input.content,
          visibility: input.visibility as any,
          community_id: input.community_id ?? null,
          in_reply_to_id: input.reply_to ?? null,
          media_ids: input.media_ids,
          sensitive: input.sensitive,
          content_warning: input.spoiler_text ?? null,
          poll: input.poll,
        } as any);
        return { post };
      }),

    follow: async (ctx: ToolContext, input: FollowInput): Promise<FollowOutput> =>
      withAudit(ctx, "tool.follow", async () => {
        ensureAgentToolAllowed(ctx, "tool.follow");
        if (!ctx.services) throw new Error("Core services are not available");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");
        await ctx.services.users.follow(auth, input.targetUserId);
        return { success: true };
      }),

    unfollow: async (ctx: ToolContext, input: FollowInput): Promise<FollowOutput> =>
      withAudit(ctx, "tool.unfollow", async () => {
        ensureAgentToolAllowed(ctx, "tool.unfollow");
        if (!ctx.services) throw new Error("Core services are not available");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");
        await ctx.services.users.unfollow(auth, input.targetUserId);
        return { success: true };
      }),

    getBookmarks: async (ctx: ToolContext, input: GetBookmarksInput): Promise<GetBookmarksOutput> =>
      withAudit(ctx, "tool.getBookmarks", async () => {
        ensureAgentToolAllowed(ctx, "tool.getBookmarks");
        if (!ctx.services) throw new Error("Core services are not available");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");
        const page = await ctx.services.posts.listBookmarks(auth, { limit: input.limit, offset: input.offset });
        return page as any;
      }),
  };
}
