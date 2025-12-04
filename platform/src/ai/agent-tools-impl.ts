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
  AgentTools,
} from "./agent-tools.js";
import type { AiRegistry, AiActionDefinition } from "./action-registry.js";
import type { ProposalQueue, ProposalMetadata } from "./proposal-queue.js";

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
    requireApproval = false,
  } = options;

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
      // アクションを実行
      const output = await action.handler(
        {
          auth: { userId: ctx.auth.userId, roles: [] },
          provider: null as unknown as never, // Provider は別途解決
          nodeConfig: ctx.nodeConfig as never,
        },
        input.input,
      );

      return {
        success: true,
        output,
      };
    } catch (error) {
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
  };
}
