/**
 * Core Kernel UserService API
 *
 * PLAN.md 3.11.5 に基づくユーザー操作の統一インターフェース
 */

import type { AppAuthContext } from "../runtime/types";

export interface User {
  id: string;
  handle: string;
  display_name?: string;
  avatar?: string;
  bio?: string;
  created_at?: string;
  followers_count?: number;
  following_count?: number;
  posts_count?: number;
  is_following?: boolean;
  is_followed_by?: boolean;
  is_blocked?: boolean;
  is_muted?: boolean;
  [key: string]: unknown;
}

export interface UserSearchParams {
  query?: string;
  limit?: number;
  offset?: number;
  local_only?: boolean;
}

export interface UserPage {
  users: User[];
  next_offset?: number | null;
  next_cursor?: string | null;
}

/**
 * UserService Interface
 */
export interface UserService {
  /**
   * ユーザー情報を取得
   * @param ctx 認証コンテキスト
   * @param userId ユーザーID（ローカル/リモート）
   * @returns ユーザー情報（存在しない場合はnull）
   */
  getUser(ctx: AppAuthContext, userId: string): Promise<User | null>;

  /**
   * ユーザーを検索
   * @param ctx 認証コンテキスト
   * @param params 検索パラメータ
   * @returns ユーザーのページ
   */
  searchUsers(ctx: AppAuthContext, params: UserSearchParams): Promise<UserPage>;

  /**
   * ユーザーをフォロー
   * @param ctx 認証コンテキスト
   * @param targetUserId フォロー対象のユーザーID
   */
  follow(ctx: AppAuthContext, targetUserId: string): Promise<void>;

  /**
   * ユーザーのフォローを解除
   * @param ctx 認証コンテキスト
   * @param targetUserId フォロー解除対象のユーザーID
   */
  unfollow(ctx: AppAuthContext, targetUserId: string): Promise<void>;

  /**
   * ユーザーをブロック
   * @param ctx 認証コンテキスト
   * @param targetUserId ブロック対象のユーザーID
   */
  block(ctx: AppAuthContext, targetUserId: string): Promise<void>;

  /**
   * ユーザーをミュート
   * @param ctx 認証コンテキスト
   * @param targetUserId ミュート対象のユーザーID
   */
  mute(ctx: AppAuthContext, targetUserId: string): Promise<void>;

  /**
   * 自分のフォロワー一覧を取得
   * @param ctx 認証コンテキスト
   * @param params ページネーションパラメータ
   * @returns フォロワーのページ
   */
  listFollowers(ctx: AppAuthContext, params?: { limit?: number; offset?: number }): Promise<UserPage>;

  /**
   * 自分がフォロー中のユーザー一覧を取得
   * @param ctx 認証コンテキスト
   * @param params ページネーションパラメータ
   * @returns フォロー中のユーザーのページ
   */
  listFollowing(ctx: AppAuthContext, params?: { limit?: number; offset?: number }): Promise<UserPage>;
}

export type UserServiceFactory = (env: unknown) => UserService;
