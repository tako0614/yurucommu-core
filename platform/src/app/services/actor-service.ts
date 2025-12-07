/**
 * Actor Service API
 *
 * Actors は Person/Group など ActivityPub 上の主体を表す
 * UserService などの上位サービスが利用する低レイヤーのラッパー
 */

import type { AppAuthContext } from "../runtime/types";

export interface ActorProfile {
  id: string;
  handle: string;
  type?: string;
  display_name?: string | null;
  summary?: string | null;
  avatar_url?: string | null;
  header_url?: string | null;
  followers?: string | null;
  following?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  [key: string]: unknown;
}

export interface ActorList {
  actors: ActorProfile[];
  next_offset?: number | null;
  next_cursor?: string | null;
}

export interface FollowParams {
  limit?: number;
  offset?: number;
}

/**
 * ActorService Interface
 */
export interface ActorService {
  /**
   * Actor を取得
   */
  get(ctx: AppAuthContext, actorId: string): Promise<ActorProfile | null>;

  /**
   * handle から Actor を取得
   */
  getByHandle(ctx: AppAuthContext, handle: string): Promise<ActorProfile | null>;

  /**
   * Actor を検索
   */
  search(ctx: AppAuthContext, query: string, params?: { limit?: number; offset?: number }): Promise<ActorList>;

  /**
   * フォロー
   */
  follow(ctx: AppAuthContext, targetId: string): Promise<void>;

  /**
   * フォロー解除
   */
  unfollow(ctx: AppAuthContext, targetId: string): Promise<void>;

  /**
   * ブロック
   */
  block(ctx: AppAuthContext, targetId: string): Promise<void>;

  /**
   * ブロック解除
   */
  unblock(ctx: AppAuthContext, targetId: string): Promise<void>;

  /**
   * ミュート
   */
  mute(ctx: AppAuthContext, targetId: string): Promise<void>;

  /**
   * ミュート解除
   */
  unmute(ctx: AppAuthContext, targetId: string): Promise<void>;

  /**
   * フォロワー一覧
   */
  listFollowers(ctx: AppAuthContext, params?: FollowParams & { actorId?: string }): Promise<ActorList>;

  /**
   * フォロー中一覧
   */
  listFollowing(ctx: AppAuthContext, params?: FollowParams & { actorId?: string }): Promise<ActorList>;
}

export type ActorServiceFactory = (env: unknown) => ActorService;
