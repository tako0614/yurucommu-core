/**
 * Core Kernel StoryService API
 *
 * PLAN.md 3.11.4 に基づくストーリー操作の統一インターフェース
 * App Script から安全にストーリー機能を利用するためのサービスAPI
 */

import type { AppAuthContext } from "../runtime/types";

// Input types
export interface StoryItem {
  id?: string;
  type: "image" | "video" | "text";
  /** 画像・動画の場合: URL */
  url?: string;
  /** テキストの場合: 本文 */
  text?: string;
  /** 画面上の位置・スタイル情報 */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fontSize?: number;
  fontWeight?: string;
  color?: string;
  backgroundColor?: string;
  /** 表示時間（ミリ秒） */
  durationMs?: number;
  /** 表示順序 */
  order?: number;
  [key: string]: unknown;
}

export interface CreateStoryInput {
  /** ストーリーアイテム */
  items: StoryItem[];
  /** コミュニティID（省略時は全体公開） */
  community_id?: string | null;
  /** 公開範囲 */
  audience?: "all" | "community";
  /** フレンドに表示するか（audience=all の場合のみ有効） */
  visible_to_friends?: boolean;
}

export interface ListStoriesParams {
  /** コミュニティIDでフィルタ */
  community_id?: string;
  limit?: number;
  offset?: number;
}

// Output types
export interface StoryUser {
  id: string;
  handle: string;
  display_name?: string;
  avatar?: string;
  [key: string]: unknown;
}

export interface Story {
  id: string;
  author_id: string;
  community_id?: string | null;
  created_at: string;
  expires_at: string;
  items: StoryItem[];
  broadcast_all: boolean;
  visible_to_friends: boolean;
  attributed_community_id?: string | null;
  /** 作成者情報 */
  author?: StoryUser;
  [key: string]: unknown;
}

export interface StoryPage {
  stories: Story[];
  next_offset?: number | null;
  next_cursor?: string | null;
}

/**
 * StoryService Interface
 *
 * AuthContext から作成者を自動決定し、公開範囲・メンバーシップチェックは内部で行われる。
 * ストーリーは24時間後に自動削除される（Cron処理）。
 */
export interface StoryService {
  /**
   * ストーリーを作成
   * @param ctx 認証コンテキスト
   * @param input ストーリー内容
   * @returns 作成されたストーリー
   */
  createStory(ctx: AppAuthContext, input: CreateStoryInput): Promise<Story>;

  /**
   * ストーリー一覧を取得
   * 認証ユーザーが閲覧可能なストーリーのみ返す
   * @param ctx 認証コンテキスト
   * @param params フィルター・ページネーションパラメータ
   * @returns ストーリー一覧
   */
  listStories(ctx: AppAuthContext, params: ListStoriesParams): Promise<StoryPage>;

  /**
   * 特定のストーリーを取得
   * @param ctx 認証コンテキスト
   * @param id ストーリーID
   * @returns ストーリー
   */
  getStory(ctx: AppAuthContext, id: string): Promise<Story | null>;

  /**
   * ストーリーを削除
   * @param ctx 認証コンテキスト
   * @param id ストーリーID
   */
  deleteStory(ctx: AppAuthContext, id: string): Promise<void>;

  /**
   * ストーリーを更新
   */
  updateStory(
    ctx: AppAuthContext,
    input: { id: string; items?: StoryItem[]; audience?: "all" | "community"; visible_to_friends?: boolean },
  ): Promise<Story>;
}

/**
 * StoryService の実装を提供するファクトリー関数の型
 */
export type StoryServiceFactory = (env: unknown) => StoryService;
