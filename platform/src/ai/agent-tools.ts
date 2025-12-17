/**
 * AI Agent Tools
 *
 * PLAN.md 6.4.2 で定義された、AI エージェントが利用する tool 群
 * これらは LangChain / LangGraph などのエージェントフレームワークで利用される
 */

import type { TakosConfig } from "../config/takos-config.js";
import type { AiActionDefinition } from "./action-registry.js";
import type { CoreServices } from "../app/services/index.js";
import type { AgentType } from "./agent-policy.js";

/**
 * Tool Context
 * すべてのツールが受け取る共通コンテキスト
 */
export interface ToolContext {
  /** 認証情報 */
  auth: {
    userId: string | null;
    isAuthenticated: boolean;
    plan?: {
      name: string;
      limits?: Partial<{
        storage: number;
        fileSize: number;
        aiRequests: number;
      }>;
      features?: string[];
    };
    agentType?: AgentType | null;
  };
  /** ノード設定 */
  nodeConfig: TakosConfig;
  /** Core Services へのアクセス */
  services?: CoreServices;
  /** 環境変数など */
  env?: Record<string, unknown>;
}

/**
 * 1. tool.describeNodeCapabilities
 *
 * 現在のノードの機能・設定を説明
 */
export interface DescribeNodeCapabilitiesInput {
  /** 詳細レベル: "basic" | "full" */
  level?: "basic" | "full";
}

export interface DescribeNodeCapabilitiesOutput {
  /** takos-core バージョン */
  coreVersion: string;
  /** distro 名（takos-profile.json.name） */
  distroName: string;
  /** distro バージョン */
  distroVersion: string;
  /** 登録済み AI Action 一覧 */
  availableActions: AiActionDefinition[];
  /** 有効化された AI Action 一覧 */
  enabledActions: string[];
  /** ノードの主要機能 */
  features: {
    activitypub: boolean;
    communities: boolean;
    stories: boolean;
    dm: boolean;
    [key: string]: boolean;
  };
  /** AI データポリシー */
  dataPolicy?: {
    sendPublicPosts: boolean;
    sendCommunityPosts: boolean;
    sendDm: boolean;
    sendProfile: boolean;
  };
}

export type DescribeNodeCapabilitiesTool = (
  ctx: ToolContext,
  input: DescribeNodeCapabilitiesInput,
) => Promise<DescribeNodeCapabilitiesOutput>;

/**
 * 2. tool.inspectService
 *
 * Core Kernel サービス API の一覧を返す
 */
export interface InspectServiceInput {
  /** サービス名（省略時は全サービス） */
  serviceName?: "posts" | "users" | "communities" | "dm" | "stories";
}

export interface ServiceMethodInfo {
  name: string;
  description: string;
  parameters: Array<{
    name: string;
    type: string;
    required: boolean;
  }>;
  returnType: string;
}

export interface InspectServiceOutput {
  services: Array<{
    name: string;
    description: string;
    methods: ServiceMethodInfo[];
  }>;
}

export type InspectServiceTool = (
  ctx: ToolContext,
  input: InspectServiceInput,
) => Promise<InspectServiceOutput>;

/**
 * 3. tool.updateTakosConfig
 *
 * takos-config.json の一部を更新
 * オーナーのみ実行可能
 */
export interface UpdateTakosConfigInput {
  /** 更新するキーのパス（ドット記法） */
  path: string;
  /** 新しい値 */
  value: unknown;
  /** 確認メッセージ（省略時は自動生成） */
  confirmMessage?: string;
}

export interface UpdateTakosConfigOutput {
  success: boolean;
  /** 更新されたキー */
  updatedPath: string;
  /** 更新後の値 */
  newValue: unknown;
  /** 前の値 */
  previousValue?: unknown;
}

export type UpdateTakosConfigTool = (
  ctx: ToolContext,
  input: UpdateTakosConfigInput,
) => Promise<UpdateTakosConfigOutput>;

/**
 * 4. tool.applyCodePatch
 *
 * App Layer のコードにパッチを適用
 * dev Workspace 上でのみ動作
 * オーナーのみ実行可能
 */
export interface ApplyCodePatchInput {
  /** ワークスペースID（省略時はデフォルト） */
  workspaceId?: string;
  /** 対象ファイルパス */
  filePath: string;
  /** diff 形式のパッチ */
  patch: string;
  /** パッチの説明 */
  description?: string;
}

export interface ApplyCodePatchOutput {
  success: boolean;
  /** 適用されたワークスペースID */
  workspaceId: string;
  /** 適用されたファイルパス */
  filePath: string;
  /** パッチの結果メッセージ */
  message: string;
}

export type ApplyCodePatchTool = (
  ctx: ToolContext,
  input: ApplyCodePatchInput,
) => Promise<ApplyCodePatchOutput>;

/**
 * 5. tool.runAIAction
 *
 * 登録済みかつ有効化された AI Action を実行
 */
export interface RunAIActionInput {
  /** 実行する AI Action の ID */
  actionId: string;
  /** アクションへの入力 */
  input: unknown;
}

export interface RunAIActionOutput {
  success: boolean;
  /** アクションの実行結果 */
  output: unknown;
  /** エラーメッセージ（失敗時） */
  error?: string;
}

export type RunAIActionTool = (
  ctx: ToolContext,
  input: RunAIActionInput,
) => Promise<RunAIActionOutput>;

/**
 * 6. tool.getTimeline
 *
 * タイムライン取得（home/local/federated）
 * - PLAN.md 07 の例では `posts` フィールドを前提としているため、`items` の別名として返す
 */
export interface GetTimelineInput {
  type: "home" | "local" | "federated";
  limit?: number;
  cursor?: string;
  only_media?: boolean;
  include_direct?: boolean;
  visibility?: Array<"public" | "unlisted" | "followers" | "community" | "direct">;
}

export interface GetTimelineOutput {
  type: GetTimelineInput["type"];
  items: unknown[];
  posts: unknown[];
  nextCursor: string | null;
  hasMore: boolean;
}

export type GetTimelineTool = (
  ctx: ToolContext,
  input: GetTimelineInput,
) => Promise<GetTimelineOutput>;

/**
 * 7. tool.getPost
 */
export interface GetPostInput {
  id: string;
  includeThread?: boolean;
}

export interface GetPostOutput {
  post: unknown | null;
  thread?: unknown[] | null;
}

export type GetPostTool = (
  ctx: ToolContext,
  input: GetPostInput,
) => Promise<GetPostOutput>;

/**
 * 8. tool.getUser
 */
export interface GetUserInput {
  id: string;
}

export interface GetUserOutput {
  user: unknown | null;
}

export type GetUserTool = (
  ctx: ToolContext,
  input: GetUserInput,
) => Promise<GetUserOutput>;

/**
 * 9. tool.searchPosts
 */
export interface SearchPostsInput {
  query: string;
  limit?: number;
  offset?: number;
}

export interface SearchPostsOutput {
  posts: unknown[];
  next_offset: number | null;
  next_cursor: string | null;
}

export type SearchPostsTool = (
  ctx: ToolContext,
  input: SearchPostsInput,
) => Promise<SearchPostsOutput>;

/**
 * 10. tool.searchUsers
 */
export interface SearchUsersInput {
  query: string;
  limit?: number;
  offset?: number;
  local_only?: boolean;
}

export interface SearchUsersOutput {
  users: unknown[];
  next_offset: number | null;
  next_cursor: string | null;
}

export type SearchUsersTool = (
  ctx: ToolContext,
  input: SearchUsersInput,
) => Promise<SearchUsersOutput>;

/**
 * 11. tool.getNotifications
 */
export interface GetNotificationsInput {
  since?: string;
}

export interface GetNotificationsOutput {
  notifications: unknown[];
}

export type GetNotificationsTool = (
  ctx: ToolContext,
  input: GetNotificationsInput,
) => Promise<GetNotificationsOutput>;

/**
 * 12. tool.getDmThreads
 */
export interface GetDmThreadsInput {
  limit?: number;
  offset?: number;
}

export interface GetDmThreadsOutput {
  threads: unknown[];
  next_offset?: number | null;
  next_cursor?: string | null;
}

export type GetDmThreadsTool = (
  ctx: ToolContext,
  input: GetDmThreadsInput,
) => Promise<GetDmThreadsOutput>;

/**
 * 13. tool.getDmMessages
 */
export interface GetDmMessagesInput {
  thread_id: string;
  limit?: number;
  offset?: number;
  since_id?: string;
  max_id?: string;
}

export interface GetDmMessagesOutput {
  messages: unknown[];
  next_offset?: number | null;
  next_cursor?: string | null;
}

export type GetDmMessagesTool = (
  ctx: ToolContext,
  input: GetDmMessagesInput,
) => Promise<GetDmMessagesOutput>;

/**
 * 13b. tool.getCommunities
 *
 * NOTE: Community list is provided by App layer (Default App /communities).
 */
export interface GetCommunitiesInput {
  q?: string;
  limit?: number;
  offset?: number;
}

export interface GetCommunitiesOutput {
  communities: unknown[];
  next_offset: number | null;
}

export type GetCommunitiesTool = (
  ctx: ToolContext,
  input: GetCommunitiesInput,
) => Promise<GetCommunitiesOutput>;

/**
 * 13c. tool.getCommunityPosts
 *
 * NOTE: Community posts are served by Core Objects timeline (communityId filter).
 */
export interface GetCommunityPostsInput {
  communityId: string;
  limit?: number;
  cursor?: string;
}

export interface GetCommunityPostsOutput {
  communityId: string;
  items: unknown[];
  posts: unknown[];
  nextCursor: string | null;
  hasMore: boolean;
}

export type GetCommunityPostsTool = (
  ctx: ToolContext,
  input: GetCommunityPostsInput,
) => Promise<GetCommunityPostsOutput>;

/**
 * 14a. tool.listMedia
 */
export interface ListMediaInput {
  limit?: number;
  offset?: number;
  prefix?: string;
  status?: "temp" | "attached" | "orphaned" | "deleted" | Array<"temp" | "attached" | "orphaned" | "deleted">;
  bucket?: string;
  includeDeleted?: boolean;
}

export interface ListMediaOutput {
  files: unknown[];
  next_offset: number | null;
}

export type ListMediaTool = (ctx: ToolContext, input: ListMediaInput) => Promise<ListMediaOutput>;

/**
 * 14b. tool.getMedia
 */
export interface GetMediaInput {
  idOrKey: string;
}

export interface GetMediaOutput {
  media: unknown | null;
}

export type GetMediaTool = (ctx: ToolContext, input: GetMediaInput) => Promise<GetMediaOutput>;

/**
 * 14c. tool.deleteMedia
 */
export interface DeleteMediaInput {
  key: string;
}

export interface DeleteMediaOutput {
  deleted: boolean;
}

export type DeleteMediaTool = (ctx: ToolContext, input: DeleteMediaInput) => Promise<DeleteMediaOutput>;

/**
 * 14c2. tool.uploadFile / tool.uploadMedia / tool.updateMedia / tool.moveMedia / tool.listFolders / tool.createFolder
 */
export interface UploadFileInput {
  /** Base64 encoded payload (raw base64, no data: prefix). */
  base64: string;
  filename?: string;
  contentType?: string;
  folder?: string;
  bucket?: string;
  alt?: string;
  description?: string;
  status?: "temp" | "attached" | "orphaned" | "deleted";
}

export interface UploadFileOutput {
  media: unknown;
}

export type UploadFileTool = (ctx: ToolContext, input: UploadFileInput) => Promise<UploadFileOutput>;

export type UploadMediaTool = UploadFileTool;

export interface UpdateMediaInput {
  idOrKey: string;
  alt?: string | null;
  description?: string | null;
}

export interface UpdateMediaOutput {
  media: unknown;
}

export type UpdateMediaTool = (ctx: ToolContext, input: UpdateMediaInput) => Promise<UpdateMediaOutput>;

export interface MoveMediaInput {
  idOrKey: string;
  folder: string;
}

export interface MoveMediaOutput {
  media: unknown;
}

export type MoveMediaTool = (ctx: ToolContext, input: MoveMediaInput) => Promise<MoveMediaOutput>;

export interface ListFoldersInput {
  /** Extra prefix under the user's root (optional). */
  prefix?: string;
  limit?: number;
}

export interface ListFoldersOutput {
  folders: string[];
}

export type ListFoldersTool = (ctx: ToolContext, input: ListFoldersInput) => Promise<ListFoldersOutput>;

export interface CreateFolderInput {
  folder: string;
}

export interface CreateFolderOutput {
  created: boolean;
  folder: string;
}

export type CreateFolderTool = (ctx: ToolContext, input: CreateFolderInput) => Promise<CreateFolderOutput>;

/**
 * 14d. tool.getStorageUsage
 */
export interface GetStorageUsageInput {
  prefix?: string;
}

export interface GetStorageUsageOutput {
  usageBytes: number;
  prefix: string;
}

export type GetStorageUsageTool = (
  ctx: ToolContext,
  input: GetStorageUsageInput,
) => Promise<GetStorageUsageOutput>;

/**
 * 14e. tool.generateImageUrl
 */
export interface GenerateImageUrlInput {
  key: string;
  options?: Partial<{
    width: number;
    height: number;
    fit: "cover" | "contain" | "fill" | "inside" | "outside";
    format: "webp" | "avif" | "jpeg" | "png" | "auto";
    quality: number;
    blur: number;
  }>;
}

export interface GenerateImageUrlOutput {
  url: string;
}

export type GenerateImageUrlTool = (
  ctx: ToolContext,
  input: GenerateImageUrlInput,
) => Promise<GenerateImageUrlOutput>;

/**
 * 14f. tool.getFollowers / tool.getFollowing
 */
export interface GetFollowersInput {
  limit?: number;
  offset?: number;
}

export interface GetFollowersOutput {
  users: unknown[];
  next_offset: number | null;
  next_cursor: string | null;
}

export type GetFollowersTool = (ctx: ToolContext, input: GetFollowersInput) => Promise<GetFollowersOutput>;

export interface GetFollowingInput {
  limit?: number;
  offset?: number;
}

export interface GetFollowingOutput {
  users: unknown[];
  next_offset: number | null;
  next_cursor: string | null;
}

export type GetFollowingTool = (ctx: ToolContext, input: GetFollowingInput) => Promise<GetFollowingOutput>;

/**
 * 14g. tool.getStories
 *
 * NOTE: Stories are implemented in App layer (Default App /stories).
 */
export interface GetStoriesInput {
  limit?: number;
  offset?: number;
}

export interface GetStoriesOutput {
  stories: unknown[];
  next_offset: number | null;
}

export type GetStoriesTool = (ctx: ToolContext, input: GetStoriesInput) => Promise<GetStoriesOutput>;

/**
 * 14. tool.createPost
 */
export interface CreatePostToolInput {
  content: string;
  visibility?: "public" | "unlisted" | "followers" | "direct" | "community";
  community_id?: string | null;
  reply_to?: string | null;
  media_ids?: string[];
  sensitive?: boolean;
  spoiler_text?: string | null;
  poll?: {
    options: string[];
    multiple?: boolean;
    expires_in?: number;
  } | null;
}

export interface CreatePostToolOutput {
  post: unknown;
}

export type CreatePostTool = (
  ctx: ToolContext,
  input: CreatePostToolInput,
) => Promise<CreatePostToolOutput>;

/**
 * 14a2. tool.createPoll
 *
 * NOTE: Implemented via PostService.createPost with poll payload.
 */
export interface CreatePollToolInput {
  content?: string;
  visibility?: "public" | "unlisted" | "followers" | "community";
  community_id?: string | null;
  options: string[];
  multiple?: boolean;
  expires_in?: number;
}

export interface CreatePollToolOutput {
  post: unknown;
}

export type CreatePollTool = (
  ctx: ToolContext,
  input: CreatePollToolInput,
) => Promise<CreatePollToolOutput>;

/**
 * 14b. tool.editPost / tool.deletePost
 */
export interface EditPostToolInput {
  id: string;
  content?: string;
  media_ids?: string[];
  sensitive?: boolean;
  spoiler_text?: string | null;
}

export interface EditPostToolOutput {
  post: unknown;
}

export type EditPostTool = (ctx: ToolContext, input: EditPostToolInput) => Promise<EditPostToolOutput>;

export interface DeletePostToolInput {
  id: string;
}

export interface DeletePostToolOutput {
  success: boolean;
}

export type DeletePostTool = (
  ctx: ToolContext,
  input: DeletePostToolInput,
) => Promise<DeletePostToolOutput>;

/**
 * 14c. tool.createStory / tool.deleteStory
 *
 * NOTE: Stories are implemented in App layer (Default App /stories).
 */
export interface CreateStoryToolInput {
  items: unknown[];
  visible_to_friends?: boolean;
  expires_at?: string;
  community_id?: string | null;
}

export interface CreateStoryToolOutput {
  story: unknown;
}

export type CreateStoryTool = (
  ctx: ToolContext,
  input: CreateStoryToolInput,
) => Promise<CreateStoryToolOutput>;

export interface DeleteStoryToolInput {
  id: string;
}

export interface DeleteStoryToolOutput {
  deleted: boolean;
}

export type DeleteStoryTool = (
  ctx: ToolContext,
  input: DeleteStoryToolInput,
) => Promise<DeleteStoryToolOutput>;

/**
 * 15. tool.follow / tool.unfollow
 */
export interface FollowInput {
  targetUserId: string;
}

export interface FollowOutput {
  success: boolean;
}

export type FollowTool = (ctx: ToolContext, input: FollowInput) => Promise<FollowOutput>;
export type UnfollowTool = (ctx: ToolContext, input: FollowInput) => Promise<FollowOutput>;

/**
 * 15b. tool.block / tool.unblock / tool.mute / tool.unmute
 *
 * NOTE: Block/Mute is implemented in App layer (Default App /blocks, /mutes).
 * Agent tools call into the App layer via the API integration.
 */
export interface BlockMuteInput {
  targetUserId: string;
}

export interface BlockMuteOutput {
  success: boolean;
  ids: string[];
}

export type BlockTool = (ctx: ToolContext, input: BlockMuteInput) => Promise<BlockMuteOutput>;
export type UnblockTool = (ctx: ToolContext, input: BlockMuteInput) => Promise<BlockMuteOutput>;
export type MuteTool = (ctx: ToolContext, input: BlockMuteInput) => Promise<BlockMuteOutput>;
export type UnmuteTool = (ctx: ToolContext, input: BlockMuteInput) => Promise<BlockMuteOutput>;

/**
 * 15c. tool.react / tool.unreact
 */
export interface ReactToolInput {
  post_id: string;
  emoji: string;
}

export interface ReactToolOutput {
  success: boolean;
}

export type ReactTool = (ctx: ToolContext, input: ReactToolInput) => Promise<ReactToolOutput>;

export interface UnreactToolInput {
  reactionId?: string;
  post_id?: string;
  emoji?: string;
}

export interface UnreactToolOutput {
  removed: boolean;
}

export type UnreactTool = (ctx: ToolContext, input: UnreactToolInput) => Promise<UnreactToolOutput>;

/**
 * 15d. tool.repost / tool.unrepost
 */
export interface RepostToolInput {
  post_id: string;
  comment?: string | null;
}

export interface RepostToolOutput {
  reposted: boolean;
  repostId?: string;
}

export type RepostTool = (ctx: ToolContext, input: RepostToolInput) => Promise<RepostToolOutput>;

export interface UnrepostToolInput {
  repostId?: string;
  post_id?: string;
}

export interface UnrepostToolOutput {
  removed: boolean;
}

export type UnrepostTool = (ctx: ToolContext, input: UnrepostToolInput) => Promise<UnrepostToolOutput>;

/**
 * 15e. tool.bookmark / tool.unbookmark
 */
export interface BookmarkToolInput {
  post_id: string;
}

export interface BookmarkToolOutput {
  success: boolean;
}

export type BookmarkTool = (ctx: ToolContext, input: BookmarkToolInput) => Promise<BookmarkToolOutput>;
export type UnbookmarkTool = (ctx: ToolContext, input: BookmarkToolInput) => Promise<BookmarkToolOutput>;

/**
 * 16. tool.getBookmarks
 */
export interface GetBookmarksInput {
  limit?: number;
  offset?: number;
}

export interface GetBookmarksOutput {
  items: unknown[];
  next_offset: number | null;
}

export type GetBookmarksTool = (
  ctx: ToolContext,
  input: GetBookmarksInput,
) => Promise<GetBookmarksOutput>;

/**
 * 17. tool.createDmThread / tool.sendDm
 */
export interface CreateDmThreadInput {
  handle: string;
}

export interface CreateDmThreadOutput {
  threadId: string;
  participants: unknown[];
}

export type CreateDmThreadTool = (
  ctx: ToolContext,
  input: CreateDmThreadInput,
) => Promise<CreateDmThreadOutput>;

export interface SendDmInput {
  thread_id?: string;
  recipients?: string[];
  content: string;
  media_ids?: string[];
  in_reply_to?: string | null;
  draft?: boolean;
}

export interface SendDmOutput {
  message: unknown;
}

export type SendDmTool = (ctx: ToolContext, input: SendDmInput) => Promise<SendDmOutput>;

/**
 * 18. Community operations (user+/power+)
 */
export interface JoinCommunityInput {
  communityId: string;
}

export interface JoinCommunityOutput {
  community_id: string;
  joined: boolean;
}

export type JoinCommunityTool = (ctx: ToolContext, input: JoinCommunityInput) => Promise<JoinCommunityOutput>;

export interface LeaveCommunityInput {
  communityId: string;
}

export interface LeaveCommunityOutput {
  community_id: string;
  left: boolean;
}

export type LeaveCommunityTool = (ctx: ToolContext, input: LeaveCommunityInput) => Promise<LeaveCommunityOutput>;

export interface PostToCommunityInput {
  communityId: string;
  content: string;
  media_ids?: string[];
  sensitive?: boolean;
  spoiler_text?: string | null;
  poll?: {
    options: string[];
    multiple?: boolean;
    expires_in?: number;
  } | null;
}

export interface PostToCommunityOutput {
  post: unknown;
}

export type PostToCommunityTool = (
  ctx: ToolContext,
  input: PostToCommunityInput,
) => Promise<PostToCommunityOutput>;

export interface CreateCommunityInput {
  name: string;
  display_name?: string;
  description?: string;
  icon_url?: string;
  visibility?: "public" | "private";
}

export interface CreateCommunityOutput {
  community: unknown;
}

export type CreateCommunityTool = (ctx: ToolContext, input: CreateCommunityInput) => Promise<CreateCommunityOutput>;

export interface UpdateCommunityInput {
  communityId: string;
  name?: string;
  display_name?: string;
  description?: string;
  icon_url?: string | null;
  visibility?: "public" | "private";
}

export interface UpdateCommunityOutput {
  community: unknown;
}

export type UpdateCommunityTool = (ctx: ToolContext, input: UpdateCommunityInput) => Promise<UpdateCommunityOutput>;

export interface CreateChannelInput {
  communityId: string;
  name: string;
  description?: string;
}

export interface CreateChannelOutput {
  channel: unknown;
}

export type CreateChannelTool = (ctx: ToolContext, input: CreateChannelInput) => Promise<CreateChannelOutput>;

export interface DeleteChannelInput {
  communityId: string;
  channelId: string;
}

export interface DeleteChannelOutput {
  deleted: boolean;
}

export type DeleteChannelTool = (ctx: ToolContext, input: DeleteChannelInput) => Promise<DeleteChannelOutput>;

export interface UpdateChannelInput {
  communityId: string;
  channelId: string;
  name?: string;
  description?: string;
}

export interface UpdateChannelOutput {
  channel: unknown;
}

export type UpdateChannelTool = (ctx: ToolContext, input: UpdateChannelInput) => Promise<UpdateChannelOutput>;

/**
 * Agent Tools レジストリ
 */
export interface AgentTools {
  describeNodeCapabilities: DescribeNodeCapabilitiesTool;
  inspectService: InspectServiceTool;
  updateTakosConfig: UpdateTakosConfigTool;
  applyCodePatch: ApplyCodePatchTool;
  runAIAction: RunAIActionTool;
  getTimeline: GetTimelineTool;
  getPost: GetPostTool;
  getUser: GetUserTool;
  searchPosts: SearchPostsTool;
  searchUsers: SearchUsersTool;
  getNotifications: GetNotificationsTool;
  getDmThreads: GetDmThreadsTool;
  getDmMessages: GetDmMessagesTool;
  getCommunities: GetCommunitiesTool;
  getCommunityPosts: GetCommunityPostsTool;
  listMedia: ListMediaTool;
  getMedia: GetMediaTool;
  deleteMedia: DeleteMediaTool;
  uploadFile: UploadFileTool;
  uploadMedia: UploadMediaTool;
  updateMedia: UpdateMediaTool;
  moveMedia: MoveMediaTool;
  listFolders: ListFoldersTool;
  createFolder: CreateFolderTool;
  getStorageUsage: GetStorageUsageTool;
  generateImageUrl: GenerateImageUrlTool;
  getFollowers: GetFollowersTool;
  getFollowing: GetFollowingTool;
  getStories: GetStoriesTool;
  createPost: CreatePostTool;
  createPoll: CreatePollTool;
  editPost: EditPostTool;
  deletePost: DeletePostTool;
  createStory: CreateStoryTool;
  deleteStory: DeleteStoryTool;
  follow: FollowTool;
  unfollow: UnfollowTool;
  block: BlockTool;
  unblock: UnblockTool;
  mute: MuteTool;
  unmute: UnmuteTool;
  react: ReactTool;
  unreact: UnreactTool;
  repost: RepostTool;
  unrepost: UnrepostTool;
  bookmark: BookmarkTool;
  unbookmark: UnbookmarkTool;
  getBookmarks: GetBookmarksTool;
  createDmThread: CreateDmThreadTool;
  sendDm: SendDmTool;
  joinCommunity: JoinCommunityTool;
  leaveCommunity: LeaveCommunityTool;
  postToCommunity: PostToCommunityTool;
  createCommunity: CreateCommunityTool;
  updateCommunity: UpdateCommunityTool;
  createChannel: CreateChannelTool;
  deleteChannel: DeleteChannelTool;
  updateChannel: UpdateChannelTool;
}

/**
 * ツールの実行権限チェック
 */
export function requireAuthenticated(ctx: ToolContext): void {
  if (!ctx.auth.isAuthenticated) {
    throw new Error("This tool requires authentication");
  }
}

/**
 * ツールのデータポリシーチェック
 */
export function checkDataPolicy(
  ctx: ToolContext,
  requiredPolicy: Partial<{
    sendPublicPosts: boolean;
    sendCommunityPosts: boolean;
    sendDm: boolean;
    sendProfile: boolean;
  }>,
): void {
  const nodePolicy = ctx.nodeConfig.ai?.data_policy;
  if (!nodePolicy) {
    throw new Error("AI data policy not configured");
  }

  if (requiredPolicy.sendPublicPosts && !nodePolicy.sendPublicPosts) {
    throw new Error("Data policy violation: sendPublicPosts not allowed");
  }
  if (requiredPolicy.sendCommunityPosts && !nodePolicy.sendCommunityPosts) {
    throw new Error("Data policy violation: sendCommunityPosts not allowed");
  }
  if (requiredPolicy.sendDm && !nodePolicy.sendDm) {
    throw new Error("Data policy violation: sendDm not allowed");
  }
  if (requiredPolicy.sendProfile && !nodePolicy.sendProfile) {
    throw new Error("Data policy violation: sendProfile not allowed");
  }
}
