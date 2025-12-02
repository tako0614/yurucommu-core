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
}

export type CommunityServiceFactory = (env: unknown) => CommunityService;
