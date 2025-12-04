/**
 * Core Kernel CommunityService API
 *
 * PLAN.md 3.11.2 に基づくコミュニティ操作の統一インターフェース
 */

import type { AppAuthContext } from "../runtime/types";

export interface CreateCommunityInput {
  name: string;
  display_name: string;
  description?: string;
  icon?: string;
  visibility?: "public" | "private";
}

export interface UpdateCommunityInput {
  id: string;
  display_name?: string;
  description?: string;
  icon?: string;
  visibility?: "public" | "private";
}

export interface Community {
  id: string;
  name: string;
  display_name: string;
  description?: string;
  icon?: string;
  visibility: "public" | "private";
  owner_id: string;
  members_count?: number;
  posts_count?: number;
  created_at: string;
  is_member?: boolean;
  role?: "owner" | "moderator" | "member" | null;
  [key: string]: unknown;
}

export interface CommunityListParams {
  limit?: number;
  offset?: number;
  query?: string;
  local_only?: boolean;
  joined_only?: boolean;
}

export interface CommunityPage {
  communities: Community[];
  next_offset?: number | null;
  next_cursor?: string | null;
}

export interface Channel {
  id: string;
  name: string;
  display_name?: string;
  description?: string;
  created_at?: string;
}

export interface CreateChannelInput {
  community_id: string;
  name: string;
  description?: string;
}

export interface UpdateChannelInput {
  community_id: string;
  channel_id: string;
  name?: string;
  description?: string;
}

export interface ChannelMessage {
  id: string;
  community_id: string;
  channel_id: string;
  content: string;
  author_id: string;
  created_at: string;
  in_reply_to?: string | null;
  [key: string]: unknown;
}

export interface ChannelMessageParams {
  community_id: string;
  channel_id: string;
  limit?: number;
  offset?: number;
}

export interface SendChannelMessageInput {
  community_id: string;
  channel_id: string;
  content: string;
  media_ids?: string[];
  recipients?: string[];
  in_reply_to?: string | null;
}

export interface CommunityMember {
  user_id: string;
  role?: string | null;
  nickname?: string | null;
  joined_at?: string;
  status?: string | null;
  user?: { id: string; display_name?: string; avatar_url?: string; handle?: string };
  [key: string]: unknown;
}

/**
 * CommunityService Interface
 */
export interface CommunityService {
  /**
   * コミュニティを作成
   * @param ctx 認証コンテキスト（userId が owner として使用される）
   * @param input コミュニティ情報
   * @returns 作成されたコミュニティ
   */
  createCommunity(ctx: AppAuthContext, input: CreateCommunityInput): Promise<Community>;

  /**
   * コミュニティを更新
   * @param ctx 認証コンテキスト
   * @param input 更新内容
   * @returns 更新後のコミュニティ
   */
  updateCommunity(ctx: AppAuthContext, input: UpdateCommunityInput): Promise<Community>;

  /**
   * コミュニティに参加
   * @param ctx 認証コンテキスト
   * @param communityId コミュニティID
   */
  joinCommunity(ctx: AppAuthContext, communityId: string): Promise<void>;

  /**
   * コミュニティから退出
   * @param ctx 認証コンテキスト
   * @param communityId コミュニティID
   */
  leaveCommunity(ctx: AppAuthContext, communityId: string): Promise<void>;

  /**
   * コミュニティ一覧を取得
   * @param ctx 認証コンテキスト
   * @param params フィルター・ページネーションパラメータ
   * @returns コミュニティのページ
   */
  listCommunities(ctx: AppAuthContext, params: CommunityListParams): Promise<CommunityPage>;

  /**
   * 特定のコミュニティを取得
   * @param ctx 認証コンテキスト
   * @param communityId コミュニティID
   * @returns コミュニティ（存在しない場合はnull）
   */
  getCommunity(ctx: AppAuthContext, communityId: string): Promise<Community | null>;

  /**
   * チャンネル一覧
   */
  listChannels(ctx: AppAuthContext, communityId: string): Promise<Channel[]>;

  /**
   * チャンネル作成
   */
  createChannel(ctx: AppAuthContext, input: CreateChannelInput): Promise<Channel>;

  /**
   * チャンネル更新
   */
  updateChannel(ctx: AppAuthContext, input: UpdateChannelInput): Promise<Channel>;

  /**
   * チャンネル削除
   */
  deleteChannel(ctx: AppAuthContext, communityId: string, channelId: string): Promise<void>;

  /**
   * メンバー一覧取得
   */
  listMembers(ctx: AppAuthContext, communityId: string): Promise<CommunityMember[]>;

  /**
   * ダイレクト招待を送信
   */
  sendDirectInvite(
    ctx: AppAuthContext,
    input: { community_id: string; user_ids: string[] },
  ): Promise<any[]>;

  /**
   * リアクション集計
   */
  getReactionSummary(
    ctx: AppAuthContext,
    communityId: string,
  ): Promise<Record<string, Record<string, number>>>;

  /**
   * チャンネルメッセージ一覧
   */
  listChannelMessages(
    ctx: AppAuthContext,
    params: ChannelMessageParams,
  ): Promise<ChannelMessage[]>;

  /**
   * チャンネルメッセージ送信
   */
  sendChannelMessage(ctx: AppAuthContext, input: SendChannelMessageInput): Promise<{ activity?: unknown }>;
}

export type CommunityServiceFactory = (env: unknown) => CommunityService;
