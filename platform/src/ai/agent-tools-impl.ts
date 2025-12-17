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
  GetCommunitiesInput,
  GetCommunitiesOutput,
  GetCommunityPostsInput,
  GetCommunityPostsOutput,
  ListMediaInput,
  ListMediaOutput,
  GetMediaInput,
  GetMediaOutput,
  DeleteMediaInput,
  DeleteMediaOutput,
  UploadFileInput,
  UploadFileOutput,
  UpdateMediaInput,
  UpdateMediaOutput,
  MoveMediaInput,
  MoveMediaOutput,
  ListFoldersInput,
  ListFoldersOutput,
  CreateFolderInput,
  CreateFolderOutput,
  GetStorageUsageInput,
  GetStorageUsageOutput,
  GenerateImageUrlInput,
  GenerateImageUrlOutput,
  GetFollowersInput,
  GetFollowersOutput,
  GetFollowingInput,
  GetFollowingOutput,
  GetStoriesInput,
  GetStoriesOutput,
  CreatePostToolInput,
  CreatePostToolOutput,
  CreatePollToolInput,
  CreatePollToolOutput,
  EditPostToolInput,
  EditPostToolOutput,
  DeletePostToolInput,
  DeletePostToolOutput,
  CreateStoryToolInput,
  CreateStoryToolOutput,
  DeleteStoryToolInput,
  DeleteStoryToolOutput,
  FollowInput,
  FollowOutput,
  BlockMuteInput,
  BlockMuteOutput,
  ReactToolInput,
  ReactToolOutput,
  UnreactToolInput,
  UnreactToolOutput,
  RepostToolInput,
  RepostToolOutput,
  UnrepostToolInput,
  UnrepostToolOutput,
  BookmarkToolInput,
  BookmarkToolOutput,
  GetBookmarksInput,
  GetBookmarksOutput,
  CreateDmThreadInput,
  CreateDmThreadOutput,
  SendDmInput,
  SendDmOutput,
  JoinCommunityInput,
  JoinCommunityOutput,
  LeaveCommunityInput,
  LeaveCommunityOutput,
  PostToCommunityInput,
  PostToCommunityOutput,
  CreateCommunityInput,
  CreateCommunityOutput,
  UpdateCommunityInput,
  UpdateCommunityOutput,
  CreateChannelInput,
  CreateChannelOutput,
  DeleteChannelInput,
  DeleteChannelOutput,
  UpdateChannelInput,
  UpdateChannelOutput,
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

const decodeBase64ToArrayBuffer = (base64: string): ArrayBuffer => {
  const trimmed = (base64 || "").trim();
  if (!trimmed) return new ArrayBuffer(0);
  if (typeof Buffer !== "undefined") {
    const buf = Buffer.from(trimmed, "base64");
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  if (typeof atob === "function") {
    const binary = atob(trimmed);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }
  throw new Error("Base64 decoding is not supported in this environment");
};

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
  /**
   * App layer API fetcher (Default App)
   * Used for features that have been moved to App layer (e.g. DM, block/mute).
   */
  fetchAppApi?: (path: string, init?: RequestInit) => Promise<Response>;
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
    fetchAppApi,
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

  const callAppApi = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    if (!fetchAppApi) {
      throw new Error("App API access is not configured. Provide fetchAppApi option.");
    }
    const res = await fetchAppApi(path, init);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`App API error (${res.status}): ${text}`);
    }
    return (await res.json().catch(() => ({}))) as T;
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
    // Tool からは Default App (/dm/*) を呼び出す。
    getDmThreads: async (ctx: ToolContext, input: GetDmThreadsInput): Promise<GetDmThreadsOutput> =>
      withAudit(ctx, "tool.getDmThreads", async () => {
        ensureAgentToolAllowed(ctx, "tool.getDmThreads");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");

        const params = new URLSearchParams();
        if (input.limit) params.set("limit", String(input.limit));
        if (input.offset) params.set("offset", String(input.offset));
        const qs = params.toString();
        const data = await callAppApi<{ threads?: unknown[]; next_offset?: number | null }>(
          `/dm/threads${qs ? `?${qs}` : ""}`,
        );
        return {
          threads: data.threads ?? [],
          next_offset: data.next_offset ?? null,
        };
      }),

    getDmMessages: async (ctx: ToolContext, input: GetDmMessagesInput): Promise<GetDmMessagesOutput> =>
      withAudit(ctx, "tool.getDmMessages", async () => {
        ensureAgentToolAllowed(ctx, "tool.getDmMessages");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");

        const params = new URLSearchParams();
        if (input.limit) params.set("limit", String(input.limit));
        if (input.offset) params.set("offset", String(input.offset));
        if (input.since_id) params.set("since_id", String(input.since_id));
        if (input.max_id) params.set("max_id", String(input.max_id));
        const qs = params.toString();
        const data = await callAppApi<{ messages?: unknown[]; next_offset?: number | null }>(
          `/dm/threads/${encodeURIComponent(input.thread_id)}/messages${qs ? `?${qs}` : ""}`,
        );
        return {
          messages: data.messages ?? [],
          next_offset: data.next_offset ?? null,
        };
      }),

    getCommunities: async (ctx: ToolContext, input: GetCommunitiesInput): Promise<GetCommunitiesOutput> =>
      withAudit(ctx, "tool.getCommunities", async () => {
        ensureAgentToolAllowed(ctx, "tool.getCommunities");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");

        const params = new URLSearchParams();
        if (input.q) params.set("q", String(input.q));
        if (input.limit) params.set("limit", String(input.limit));
        if (typeof input.offset === "number") params.set("offset", String(input.offset));
        const qs = params.toString();
        const data = await callAppApi<{ communities?: unknown[]; next_offset?: number | null }>(
          `/communities${qs ? `?${qs}` : ""}`,
        );
        return {
          communities: data.communities ?? [],
          next_offset: data.next_offset ?? null,
        };
      }),

    getCommunityPosts: async (ctx: ToolContext, input: GetCommunityPostsInput): Promise<GetCommunityPostsOutput> =>
      withAudit(ctx, "tool.getCommunityPosts", async () => {
        ensureAgentToolAllowed(ctx, "tool.getCommunityPosts");
        if (!ctx.services) throw new Error("Core services are not available");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");

        const limit = input.limit ?? 20;

        if (ctx.services.objects) {
          const page = await ctx.services.objects.getTimeline(auth, {
            type: ["Note", "Article", "Question"],
            visibility: ["public", "unlisted", "followers", "community"],
            communityId: input.communityId,
            limit,
            cursor: input.cursor,
          });
          return {
            communityId: input.communityId,
            items: page.items,
            posts: page.items,
            nextCursor: page.nextCursor,
            hasMore: page.hasMore,
          };
        }

        const offset = input.cursor ? parseInt(input.cursor, 10) : 0;
        const page = await ctx.services.posts.listTimeline(auth, {
          community_id: input.communityId,
          limit,
          offset: Number.isFinite(offset) ? offset : 0,
        } as any);
        const posts = (page as any).posts ?? [];
        return {
          communityId: input.communityId,
          items: posts,
          posts,
          nextCursor: (page as any).next_cursor ?? ((page as any).next_offset != null ? String((page as any).next_offset) : null),
          hasMore: (page as any).next_offset != null,
        };
      }),

    listMedia: async (ctx: ToolContext, input: ListMediaInput): Promise<ListMediaOutput> =>
      withAudit(ctx, "tool.listMedia", async () => {
        ensureAgentToolAllowed(ctx, "tool.listMedia");
        if (!ctx.services?.media) throw new Error("Core services are not available");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");

        const result = await ctx.services.media.listStorage(auth, {
          limit: input.limit,
          offset: input.offset,
          prefix: input.prefix,
          status: input.status as any,
          bucket: input.bucket,
          includeDeleted: input.includeDeleted,
        });
        return result as any;
      }),

    getMedia: async (ctx: ToolContext, input: GetMediaInput): Promise<GetMediaOutput> =>
      withAudit(ctx, "tool.getMedia", async () => {
        ensureAgentToolAllowed(ctx, "tool.getMedia");
        if (!ctx.services?.media) throw new Error("Core services are not available");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");

        const media = await ctx.services.media.get(auth, input.idOrKey);
        return { media };
      }),

    deleteMedia: async (ctx: ToolContext, input: DeleteMediaInput): Promise<DeleteMediaOutput> =>
      withAudit(ctx, "tool.deleteMedia", async () => {
        ensureAgentToolAllowed(ctx, "tool.deleteMedia");
        if (!ctx.services?.media) throw new Error("Core services are not available");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");

        const res = await ctx.services.media.deleteStorageObject(auth, input.key);
        return { deleted: !!(res as any)?.deleted };
      }),

    uploadFile: async (ctx: ToolContext, input: UploadFileInput): Promise<UploadFileOutput> =>
      withAudit(ctx, "tool.uploadFile", async () => {
        ensureAgentToolAllowed(ctx, "tool.uploadFile");
        if (!ctx.services?.media) throw new Error("Core services are not available");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");
        const file = decodeBase64ToArrayBuffer(input.base64);
        const media = await ctx.services.media.upload(auth, {
          file,
          filename: input.filename,
          contentType: input.contentType,
          folder: input.folder,
          bucket: input.bucket,
          alt: input.alt,
          description: input.description,
          status: input.status as any,
        } as any);
        return { media };
      }),

    uploadMedia: async (ctx: ToolContext, input: UploadFileInput): Promise<UploadFileOutput> =>
      withAudit(ctx, "tool.uploadMedia", async () => {
        ensureAgentToolAllowed(ctx, "tool.uploadMedia");
        if (!ctx.services?.media) throw new Error("Core services are not available");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");
        const file = decodeBase64ToArrayBuffer(input.base64);
        const media = await ctx.services.media.upload(auth, {
          file,
          filename: input.filename,
          contentType: input.contentType,
          folder: input.folder,
          bucket: input.bucket,
          alt: input.alt,
          description: input.description,
          status: input.status as any,
        } as any);
        return { media };
      }),

    updateMedia: async (ctx: ToolContext, input: UpdateMediaInput): Promise<UpdateMediaOutput> =>
      withAudit(ctx, "tool.updateMedia", async () => {
        ensureAgentToolAllowed(ctx, "tool.updateMedia");
        if (!ctx.services?.media) throw new Error("Core services are not available");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");
        const media = await ctx.services.media.updateMetadata(auth, input.idOrKey, {
          alt: input.alt === undefined ? undefined : input.alt ?? undefined,
          description: input.description === undefined ? undefined : input.description ?? undefined,
        } as any);
        if (!media) throw new Error("media not found");
        return { media };
      }),

    moveMedia: async (ctx: ToolContext, input: MoveMediaInput): Promise<MoveMediaOutput> =>
      withAudit(ctx, "tool.moveMedia", async () => {
        ensureAgentToolAllowed(ctx, "tool.moveMedia");
        if (!ctx.services?.media) throw new Error("Core services are not available");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");
        const media = await ctx.services.media.moveObject(auth, input.idOrKey, input.folder);
        if (!media) throw new Error("media not found");
        return { media };
      }),

    listFolders: async (ctx: ToolContext, input: ListFoldersInput): Promise<ListFoldersOutput> =>
      withAudit(ctx, "tool.listFolders", async () => {
        ensureAgentToolAllowed(ctx, "tool.listFolders");
        if (!ctx.services?.storage) throw new Error("Core services are not available");
        const auth = toAppAuthContext(ctx);
        const userId = (auth.userId || "").toString().trim();
        if (!auth.isAuthenticated || !userId) throw new Error("Authentication required");

        const normalizedPrefix = (input.prefix || "").replace(/^\/+/, "");
        const basePrefix = `user-uploads/${userId}`;
        const prefix = normalizedPrefix ? `${basePrefix}/${normalizedPrefix.replace(/\/+$/, "")}` : basePrefix;

        const folders = new Set<string>();
        let cursor: string | undefined;
        const maxFolders = Math.min(500, Math.max(1, input.limit ?? 200));

        do {
          const page = await ctx.services.storage.list(auth, { prefix, limit: 1000, cursor });
          for (const obj of page.objects || []) {
            const key = obj.key || "";
            if (!key.startsWith(basePrefix)) continue;
            const relative = key.slice(basePrefix.length).replace(/^\/+/, "");
            const parts = relative.split("/").filter(Boolean);
            if (parts.length >= 2) folders.add(parts[0]);
            if (folders.size >= maxFolders) break;
          }
          if (folders.size >= maxFolders) break;
          cursor = page.truncated ? page.cursor : undefined;
        } while (cursor);

        return { folders: Array.from(folders).sort() };
      }),

    createFolder: async (ctx: ToolContext, input: CreateFolderInput): Promise<CreateFolderOutput> =>
      withAudit(ctx, "tool.createFolder", async () => {
        ensureAgentToolAllowed(ctx, "tool.createFolder");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");
        const folder = (input.folder || "").replace(/^\/*/, "").replace(/\/*$/, "").trim();
        if (!folder) throw new Error("folder is required");
        // Object storage folders are virtual; nothing to create on the backend.
        return { created: true, folder };
      }),

    getStorageUsage: async (ctx: ToolContext, input: GetStorageUsageInput): Promise<GetStorageUsageOutput> =>
      withAudit(ctx, "tool.getStorageUsage", async () => {
        ensureAgentToolAllowed(ctx, "tool.getStorageUsage");
        if (!ctx.services?.storage) throw new Error("Core services are not available");
        const auth = toAppAuthContext(ctx);
        const userId = (auth.userId || "").toString().trim();
        if (!auth.isAuthenticated || !userId) throw new Error("Authentication required");

        const prefix = (input.prefix || `user-uploads/${userId}`).replace(/^\/+/, "");
        let cursor: string | undefined;
        let usageBytes = 0;
        do {
          const page = await ctx.services.storage.list(auth, { prefix, limit: 1000, cursor });
          for (const obj of page.objects || []) {
            usageBytes += obj.size ?? 0;
          }
          cursor = page.truncated ? page.cursor : undefined;
        } while (cursor);

        return { usageBytes, prefix };
      }),

    generateImageUrl: async (ctx: ToolContext, input: GenerateImageUrlInput): Promise<GenerateImageUrlOutput> =>
      withAudit(ctx, "tool.generateImageUrl", async () => {
        ensureAgentToolAllowed(ctx, "tool.generateImageUrl");
        if (!ctx.services?.media) throw new Error("Core services are not available");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");

        const url = ctx.services.media.getTransformedUrl(input.key, input.options as any);
        return { url };
      }),

    getFollowers: async (ctx: ToolContext, input: GetFollowersInput): Promise<GetFollowersOutput> =>
      withAudit(ctx, "tool.getFollowers", async () => {
        ensureAgentToolAllowed(ctx, "tool.getFollowers");
        if (!ctx.services?.users) throw new Error("Core services are not available");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");

        const page = await ctx.services.users.listFollowers(auth, { limit: input.limit, offset: input.offset });
        return {
          users: (page as any).users ?? [],
          next_offset: (page as any).next_offset ?? null,
          next_cursor: (page as any).next_cursor ?? null,
        };
      }),

    getFollowing: async (ctx: ToolContext, input: GetFollowingInput): Promise<GetFollowingOutput> =>
      withAudit(ctx, "tool.getFollowing", async () => {
        ensureAgentToolAllowed(ctx, "tool.getFollowing");
        if (!ctx.services?.users) throw new Error("Core services are not available");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");

        const page = await ctx.services.users.listFollowing(auth, { limit: input.limit, offset: input.offset });
        return {
          users: (page as any).users ?? [],
          next_offset: (page as any).next_offset ?? null,
          next_cursor: (page as any).next_cursor ?? null,
        };
      }),

    getStories: async (ctx: ToolContext, input: GetStoriesInput): Promise<GetStoriesOutput> =>
      withAudit(ctx, "tool.getStories", async () => {
        ensureAgentToolAllowed(ctx, "tool.getStories");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");

        const params = new URLSearchParams();
        if (input.limit) params.set("limit", String(input.limit));
        if (typeof input.offset === "number") params.set("offset", String(input.offset));
        const qs = params.toString();
        const data = await callAppApi<{ stories?: unknown[]; next_offset?: number | null }>(`/stories${qs ? `?${qs}` : ""}`);

        return { stories: data.stories ?? [], next_offset: data.next_offset ?? null };
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

    createPoll: async (ctx: ToolContext, input: CreatePollToolInput): Promise<CreatePollToolOutput> =>
      withAudit(ctx, "tool.createPoll", async () => {
        ensureAgentToolAllowed(ctx, "tool.createPoll");
        if (!ctx.services) throw new Error("Core services are not available");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");
        const options = Array.isArray(input.options) ? input.options.map((o) => String(o ?? "").trim()).filter(Boolean) : [];
        if (options.length < 2) throw new Error("At least two options are required");
        const post = await ctx.services.posts.createPost(auth, {
          content: input.content ?? "",
          visibility: (input.visibility ?? "public") as any,
          community_id: input.community_id ?? null,
          poll: {
            options,
            multiple: !!input.multiple,
            expires_in: input.expires_in,
          },
        } as any);
        return { post };
      }),

    editPost: async (ctx: ToolContext, input: EditPostToolInput): Promise<EditPostToolOutput> =>
      withAudit(ctx, "tool.editPost", async () => {
        ensureAgentToolAllowed(ctx, "tool.editPost");
        if (!ctx.services) throw new Error("Core services are not available");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");

        const hasAnyField =
          input.content !== undefined ||
          input.media_ids !== undefined ||
          input.sensitive !== undefined ||
          input.spoiler_text !== undefined;
        if (!hasAnyField) throw new Error("No fields to update");

        const post = await ctx.services.posts.updatePost(auth, {
          id: input.id,
          content: input.content,
          media_ids: input.media_ids,
          sensitive: input.sensitive,
          content_warning: input.spoiler_text === undefined ? undefined : input.spoiler_text,
        } as any);
        return { post };
      }),

    deletePost: async (ctx: ToolContext, input: DeletePostToolInput): Promise<DeletePostToolOutput> =>
      withAudit(ctx, "tool.deletePost", async () => {
        ensureAgentToolAllowed(ctx, "tool.deletePost");
        if (!ctx.services) throw new Error("Core services are not available");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");
        await ctx.services.posts.deletePost(auth, input.id);
        return { success: true };
      }),

    createStory: async (ctx: ToolContext, input: CreateStoryToolInput): Promise<CreateStoryToolOutput> =>
      withAudit(ctx, "tool.createStory", async () => {
        ensureAgentToolAllowed(ctx, "tool.createStory");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");

        const path = input.community_id
          ? `/communities/${encodeURIComponent(input.community_id)}/stories`
          : "/stories";

        const story = await callAppApi<unknown>(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: input.items ?? [],
            visible_to_friends: input.visible_to_friends,
            expires_at: input.expires_at,
          }),
        });

        return { story };
      }),

    deleteStory: async (ctx: ToolContext, input: DeleteStoryToolInput): Promise<DeleteStoryToolOutput> =>
      withAudit(ctx, "tool.deleteStory", async () => {
        ensureAgentToolAllowed(ctx, "tool.deleteStory");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");

        const res = await callAppApi<{ deleted?: boolean }>(`/stories/${encodeURIComponent(input.id)}`, {
          method: "DELETE",
        });
        return { deleted: res.deleted ?? true };
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

    block: async (ctx: ToolContext, input: BlockMuteInput): Promise<BlockMuteOutput> =>
      withAudit(ctx, "tool.block", async () => {
        ensureAgentToolAllowed(ctx, "tool.block");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");

        const data = await callAppApi<{ ids?: string[] }>("/blocks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetId: input.targetUserId }),
        });
        return { success: true, ids: data.ids ?? [] };
      }),

    unblock: async (ctx: ToolContext, input: BlockMuteInput): Promise<BlockMuteOutput> =>
      withAudit(ctx, "tool.unblock", async () => {
        ensureAgentToolAllowed(ctx, "tool.unblock");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");

        const data = await callAppApi<{ ids?: string[] }>(`/blocks/${encodeURIComponent(input.targetUserId)}`, {
          method: "DELETE",
        });
        return { success: true, ids: data.ids ?? [] };
      }),

    mute: async (ctx: ToolContext, input: BlockMuteInput): Promise<BlockMuteOutput> =>
      withAudit(ctx, "tool.mute", async () => {
        ensureAgentToolAllowed(ctx, "tool.mute");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");

        const data = await callAppApi<{ ids?: string[] }>("/mutes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetId: input.targetUserId }),
        });
        return { success: true, ids: data.ids ?? [] };
      }),

    unmute: async (ctx: ToolContext, input: BlockMuteInput): Promise<BlockMuteOutput> =>
      withAudit(ctx, "tool.unmute", async () => {
        ensureAgentToolAllowed(ctx, "tool.unmute");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");

        const data = await callAppApi<{ ids?: string[] }>(`/mutes/${encodeURIComponent(input.targetUserId)}`, {
          method: "DELETE",
        });
        return { success: true, ids: data.ids ?? [] };
      }),

    react: async (ctx: ToolContext, input: ReactToolInput): Promise<ReactToolOutput> =>
      withAudit(ctx, "tool.react", async () => {
        ensureAgentToolAllowed(ctx, "tool.react");
        if (!ctx.services) throw new Error("Core services are not available");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");
        await ctx.services.posts.reactToPost(auth, { post_id: input.post_id, emoji: input.emoji });
        return { success: true };
      }),

    unreact: async (ctx: ToolContext, input: UnreactToolInput): Promise<UnreactToolOutput> =>
      withAudit(ctx, "tool.unreact", async () => {
        ensureAgentToolAllowed(ctx, "tool.unreact");
        if (!ctx.services) throw new Error("Core services are not available");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated || !auth.userId) throw new Error("Authentication required");

        if (input.reactionId) {
          await ctx.services.posts.removeReaction(auth, input.reactionId);
          return { removed: true };
        }

        if (!input.post_id) throw new Error("reactionId or post_id is required");
        const reactions = await ctx.services.posts.listReactions(auth, input.post_id);
        const own = (reactions ?? []).find((reaction) => {
          const userId = (reaction as any)?.user_id ?? (reaction as any)?.userId;
          const emoji = (reaction as any)?.emoji;
          if (String(userId ?? "") !== String(auth.userId)) return false;
          if (input.emoji && String(emoji ?? "") !== input.emoji) return false;
          return true;
        });
        if (!own) return { removed: false };
        await ctx.services.posts.removeReaction(auth, (own as any).id);
        return { removed: true };
      }),

    repost: async (ctx: ToolContext, input: RepostToolInput): Promise<RepostToolOutput> =>
      withAudit(ctx, "tool.repost", async () => {
        ensureAgentToolAllowed(ctx, "tool.repost");
        if (!ctx.services) throw new Error("Core services are not available");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");
        const result = await ctx.services.posts.repost(auth, { post_id: input.post_id, comment: input.comment });
        return { reposted: !!result?.reposted, repostId: (result as any)?.id };
      }),

    unrepost: async (ctx: ToolContext, input: UnrepostToolInput): Promise<UnrepostToolOutput> =>
      withAudit(ctx, "tool.unrepost", async () => {
        ensureAgentToolAllowed(ctx, "tool.unrepost");
        if (!ctx.services) throw new Error("Core services are not available");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated || !auth.userId) throw new Error("Authentication required");

        if (input.repostId) {
          await ctx.services.posts.undoRepost(auth, input.repostId);
          return { removed: true };
        }

        if (!input.post_id) throw new Error("repostId or post_id is required");
        const page = await ctx.services.posts.listReposts(auth, { post_id: input.post_id, limit: 100, offset: 0 });
        const own = (page as any)?.items?.find((item: any) => String(item?.user?.id ?? "") === String(auth.userId));
        if (!own) return { removed: false };
        await ctx.services.posts.undoRepost(auth, own.id);
        return { removed: true };
      }),

    bookmark: async (ctx: ToolContext, input: BookmarkToolInput): Promise<BookmarkToolOutput> =>
      withAudit(ctx, "tool.bookmark", async () => {
        ensureAgentToolAllowed(ctx, "tool.bookmark");
        if (!ctx.services) throw new Error("Core services are not available");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");
        await ctx.services.posts.addBookmark(auth, input.post_id);
        return { success: true };
      }),

    unbookmark: async (ctx: ToolContext, input: BookmarkToolInput): Promise<BookmarkToolOutput> =>
      withAudit(ctx, "tool.unbookmark", async () => {
        ensureAgentToolAllowed(ctx, "tool.unbookmark");
        if (!ctx.services) throw new Error("Core services are not available");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");
        await ctx.services.posts.removeBookmark(auth, input.post_id);
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

    createDmThread: async (ctx: ToolContext, input: CreateDmThreadInput): Promise<CreateDmThreadOutput> =>
      withAudit(ctx, "tool.createDmThread", async () => {
        ensureAgentToolAllowed(ctx, "tool.createDmThread");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");
        const handle = String(input.handle ?? "").trim();
        if (!handle) throw new Error("handle is required");
        const data = await callAppApi<{ threadId?: string; thread_id?: string; participants?: unknown[] }>(
          `/dm/with/${encodeURIComponent(handle.replace(/^@/, ""))}`,
        );
        const threadId = (data.threadId ?? data.thread_id ?? "").toString();
        if (!threadId) throw new Error("Failed to create dm thread");
        return { threadId, participants: data.participants ?? [] };
      }),

    sendDm: async (ctx: ToolContext, input: SendDmInput): Promise<SendDmOutput> =>
      withAudit(ctx, "tool.sendDm", async () => {
        ensureAgentToolAllowed(ctx, "tool.sendDm");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");
        const content = String(input.content ?? "").trim();
        if (!content) throw new Error("content is required");
        const message = await callAppApi<unknown>("/dm/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content,
            thread_id: input.thread_id,
            recipients: input.recipients,
            media_ids: input.media_ids,
            in_reply_to: input.in_reply_to ?? null,
            draft: Boolean(input.draft),
          }),
        });
        return { message };
      }),

    joinCommunity: async (ctx: ToolContext, input: JoinCommunityInput): Promise<JoinCommunityOutput> =>
      withAudit(ctx, "tool.joinCommunity", async () => {
        ensureAgentToolAllowed(ctx, "tool.joinCommunity");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");
        const id = String(input.communityId ?? "").trim();
        if (!id) throw new Error("communityId is required");
        const data = await callAppApi<{ community_id?: string; joined?: boolean }>(
          `/communities/${encodeURIComponent(id)}/join`,
          { method: "POST" },
        );
        return { community_id: data.community_id ?? id, joined: data.joined ?? true };
      }),

    leaveCommunity: async (ctx: ToolContext, input: LeaveCommunityInput): Promise<LeaveCommunityOutput> =>
      withAudit(ctx, "tool.leaveCommunity", async () => {
        ensureAgentToolAllowed(ctx, "tool.leaveCommunity");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");
        const id = String(input.communityId ?? "").trim();
        if (!id) throw new Error("communityId is required");
        const data = await callAppApi<{ community_id?: string; left?: boolean }>(
          `/communities/${encodeURIComponent(id)}/leave`,
          { method: "POST" },
        );
        return { community_id: data.community_id ?? id, left: data.left ?? true };
      }),

    postToCommunity: async (ctx: ToolContext, input: PostToCommunityInput): Promise<PostToCommunityOutput> =>
      withAudit(ctx, "tool.postToCommunity", async () => {
        ensureAgentToolAllowed(ctx, "tool.postToCommunity");
        if (!ctx.services) throw new Error("Core services are not available");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");
        const communityId = String(input.communityId ?? "").trim();
        if (!communityId) throw new Error("communityId is required");
        const content = String(input.content ?? "").trim();
        if (!content) throw new Error("content is required");
        const post = await ctx.services.posts.createPost(auth, {
          content,
          visibility: "community" as any,
          community_id: communityId,
          media_ids: input.media_ids,
          sensitive: input.sensitive,
          content_warning: input.spoiler_text ?? null,
          poll: input.poll,
        } as any);
        return { post };
      }),

    createCommunity: async (ctx: ToolContext, input: CreateCommunityInput): Promise<CreateCommunityOutput> =>
      withAudit(ctx, "tool.createCommunity", async () => {
        ensureAgentToolAllowed(ctx, "tool.createCommunity");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");
        const name = String(input.name ?? "").trim();
        if (!name) throw new Error("name is required");
        const community = await callAppApi<unknown>("/communities", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            display_name: input.display_name,
            description: input.description,
            icon_url: input.icon_url,
            visibility: input.visibility,
          }),
        });
        return { community };
      }),

    updateCommunity: async (ctx: ToolContext, input: UpdateCommunityInput): Promise<UpdateCommunityOutput> =>
      withAudit(ctx, "tool.updateCommunity", async () => {
        ensureAgentToolAllowed(ctx, "tool.updateCommunity");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");
        const id = String(input.communityId ?? "").trim();
        if (!id) throw new Error("communityId is required");
        const community = await callAppApi<unknown>(`/communities/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: input.name,
            display_name: input.display_name,
            description: input.description,
            icon_url: input.icon_url,
            visibility: input.visibility,
          }),
        });
        return { community };
      }),

    createChannel: async (ctx: ToolContext, input: CreateChannelInput): Promise<CreateChannelOutput> =>
      withAudit(ctx, "tool.createChannel", async () => {
        ensureAgentToolAllowed(ctx, "tool.createChannel");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");
        const communityId = String(input.communityId ?? "").trim();
        if (!communityId) throw new Error("communityId is required");
        const name = String(input.name ?? "").trim();
        if (!name) throw new Error("name is required");
        const channel = await callAppApi<unknown>(`/communities/${encodeURIComponent(communityId)}/channels`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, description: input.description }),
        });
        return { channel };
      }),

    deleteChannel: async (ctx: ToolContext, input: DeleteChannelInput): Promise<DeleteChannelOutput> =>
      withAudit(ctx, "tool.deleteChannel", async () => {
        ensureAgentToolAllowed(ctx, "tool.deleteChannel");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");
        const communityId = String(input.communityId ?? "").trim();
        const channelId = String(input.channelId ?? "").trim();
        if (!communityId) throw new Error("communityId is required");
        if (!channelId) throw new Error("channelId is required");
        const data = await callAppApi<{ deleted?: boolean }>(
          `/communities/${encodeURIComponent(communityId)}/channels/${encodeURIComponent(channelId)}`,
          { method: "DELETE" },
        );
        return { deleted: data.deleted ?? true };
      }),

    updateChannel: async (ctx: ToolContext, input: UpdateChannelInput): Promise<UpdateChannelOutput> =>
      withAudit(ctx, "tool.updateChannel", async () => {
        ensureAgentToolAllowed(ctx, "tool.updateChannel");
        const auth = toAppAuthContext(ctx);
        if (!auth.isAuthenticated) throw new Error("Authentication required");
        const communityId = String(input.communityId ?? "").trim();
        const channelId = String(input.channelId ?? "").trim();
        if (!communityId) throw new Error("communityId is required");
        if (!channelId) throw new Error("channelId is required");
        const channel = await callAppApi<unknown>(
          `/communities/${encodeURIComponent(communityId)}/channels/${encodeURIComponent(channelId)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: input.name, description: input.description }),
          },
        );
        return { channel };
      }),
  };
}
