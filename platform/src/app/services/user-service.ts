/**
 * Core Kernel UserService API
 *
 * PLAN.md 3.11.5 に基づくユーザー操作の統一インターフェース
 *
 * NOTE: Block/Mute 操作は App 層（Default App）に完全移行済み
 * 実装: app/default/src/server.ts の /blocks, /mutes エンドポイント
 * API routes は Default App にプロキシ (api/src/routes/users.ts)
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

export interface UpdateProfileInput {
  display_name?: string;
  avatar?: string | null;
  bio?: string | null;
  is_private?: boolean;
}

export interface FollowRequest {
  requester_id: string;
  addressee_id: string;
  status: "pending" | "accepted" | "rejected";
  created_at?: string;
  requester?: User | null;
  addressee?: User | null;
}

export interface FollowRequestList {
  incoming: FollowRequest[];
  outgoing: FollowRequest[];
}

export interface NotificationEntry {
  id: string;
  type: string;
  actor_id: string;
  ref_type: string;
  ref_id: string;
  message?: string | null;
  created_at?: string;
  read?: boolean;
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
   * プロフィールを更新
   * @param ctx 認証コンテキスト
   * @param input 更新内容
   */
  updateProfile(ctx: AppAuthContext, input: UpdateProfileInput): Promise<User>;

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

  // NOTE: block() と mute() は App 層に移行済み
  // API: POST /users/:id/block, POST /users/:id/mute
  // 実装: Default App /blocks, /mutes エンドポイント

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

  /**
   * フォローリクエスト一覧
   */
  listFollowRequests(
    ctx: AppAuthContext,
    params?: { direction?: "incoming" | "outgoing" | "all" },
  ): Promise<FollowRequestList>;

  /**
   * フォローリクエストを承認
   */
  acceptFollowRequest(ctx: AppAuthContext, requesterId: string): Promise<void>;

  /**
   * フォローリクエストを拒否
   */
  rejectFollowRequest(ctx: AppAuthContext, requesterId: string): Promise<void>;

  // NOTE: unblock(), unmute(), listBlocks(), listMutes() は App 層に移行済み
  // API: DELETE /users/:id/block, DELETE /users/:id/mute, GET /blocks, GET /mutes
  // 実装: Default App /blocks, /mutes エンドポイント

  /**
   * 通知一覧
   */
  listNotifications(ctx: AppAuthContext, params?: { since?: string }): Promise<NotificationEntry[]>;

  /**
   * 通知を既読にする
   */
  markNotificationRead(
    ctx: AppAuthContext,
    notificationId: string,
  ): Promise<{ id: string; unread_count?: number }>;
}

export type UserServiceFactory = (env: unknown) => UserService;
