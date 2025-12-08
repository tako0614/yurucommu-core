/**
 * Core Kernel PostService API
 *
 * PLAN.md 3.11.1 に基づく投稿操作の統一インターフェース
 * App Script から安全に投稿機能を利用するためのサービスAPI
 *
 * 注: ここでいう「App」は「ノードのプログラム本体（1ノード=1App）」を指し、
 * プラグインや複数インストール可能なアプリではありません。
 */

import type { AppAuthContext } from "../runtime/types";

// Input types
export type Visibility = "public" | "unlisted" | "private" | "direct";

export interface CreatePostInput {
  content: string;
  visibility?: Visibility;
  community_id?: string | null;
  in_reply_to_id?: string | null;
  media_ids?: string[];
  sensitive?: boolean;
  content_warning?: string | null;
  poll?: {
    options: string[];
    multiple?: boolean;
    expires_in?: number; // seconds
  } | null;
}

export interface UpdatePostInput {
  id: string;
  content?: string;
  sensitive?: boolean;
  content_warning?: string | null;
  media_ids?: string[];
}

export interface ReactToPostInput {
  post_id: string;
  emoji: string;
}

export interface TimelineParams {
  limit?: number;
  offset?: number;
  since_id?: string;
  max_id?: string;
  community_id?: string;
  list_id?: string;
  only_media?: boolean;
  visibility?: Visibility | null;
}

// Output types
export interface Post {
  id: string;
  author_id: string;
  content: string;
  visibility: Visibility;
  community_id?: string | null;
  in_reply_to_id?: string | null;
  created_at: string;
  updated_at: string;
  sensitive?: boolean;
  content_warning?: string | null;
  media?: Media[];
  poll?: Poll | null;
  reactions_count?: number;
  comments_count?: number;
  reposts_count?: number;
  bookmarked?: boolean;
  reposted?: boolean;
  pinned?: boolean;
  author?: User;
  [key: string]: unknown;
}

export interface Media {
  id: string;
  url: string;
  type: string;
  alt?: string;
  [key: string]: unknown;
}

export interface Poll {
  id: string;
  options: PollOption[];
  multiple: boolean;
  expires_at?: string;
  votes_count: number;
  voted?: boolean;
  [key: string]: unknown;
}

export interface PollOption {
  id: string;
  text: string;
  votes_count: number;
  [key: string]: unknown;
}

export interface User {
  id: string;
  handle: string;
  display_name?: string;
  avatar?: string;
  [key: string]: unknown;
}

export interface PostPage {
  posts: Post[];
  next_offset?: number | null;
  next_cursor?: string | null;
}

export interface PostHistoryEntry {
  id?: string;
  post_id?: string;
  content?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface SearchPostsParams {
  query?: string;
  limit?: number;
  offset?: number;
}

export interface PollVoteInput {
  post_id: string;
  option_ids: string[];
}

export interface RepostInput {
  post_id: string;
  comment?: string | null;
}

export interface RepostListParams {
  post_id: string;
  limit?: number;
  offset?: number;
}

export interface RepostListResult {
  items: Array<{
    id: string;
    user: User | { id: string };
    comment?: string | null;
    created_at?: string;
  }>;
  count: number;
  next_offset: number | null;
}

export interface Reaction {
  id: string;
  post_id: string;
  user_id: string;
  emoji: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface BookmarkPage {
  items: Post[];
  next_offset: number | null;
}

/**
 * PostService Interface
 *
 * AuthContext から投稿者を自動決定し、入力の authorId は無視する。
 * 公開範囲・ミュート/ブロック関係のチェックは内部で行われる。
 */
export interface PostService {
  /**
   * 新規投稿を作成
   * @param ctx 認証コンテキスト（userId が投稿者として使用される）
   * @param input 投稿内容
   * @returns 作成された投稿
   */
  createPost(ctx: AppAuthContext, input: CreatePostInput): Promise<Post>;

  /**
   * 投稿を更新（編集）
   * @param ctx 認証コンテキスト
   * @param input 更新内容（id は必須）
   * @returns 更新後の投稿
   */
  updatePost(ctx: AppAuthContext, input: UpdatePostInput): Promise<Post>;

  /**
   * 投稿を削除
   * @param ctx 認証コンテキスト
   * @param id 投稿ID
   */
  deletePost(ctx: AppAuthContext, id: string): Promise<void>;

  /**
   * 投稿にリアクション（絵文字）を追加
   * @param ctx 認証コンテキスト
   * @param input リアクション情報
   */
  reactToPost(ctx: AppAuthContext, input: ReactToPostInput): Promise<void>;

  /**
   * タイムラインを取得
   * 認証ユーザーのホームタイムライン、コミュニティタイムライン、リストタイムラインなど
   * @param ctx 認証コンテキスト
   * @param params フィルター・ページネーションパラメータ
   * @returns 投稿のページ
   */
  listTimeline(ctx: AppAuthContext, params: TimelineParams): Promise<PostPage>;

  /**
   * 特定の投稿を取得
   * @param ctx 認証コンテキスト
   * @param id 投稿ID
   * @returns 投稿
   */
  getPost(ctx: AppAuthContext, id: string): Promise<Post | null>;

  /**
   * 投稿を検索
   */
  searchPosts(ctx: AppAuthContext, params: SearchPostsParams): Promise<PostPage>;

  /**
   * 投稿の編集履歴を取得
   */
  listPostHistory(ctx: AppAuthContext, postId: string): Promise<PostHistoryEntry[]>;

  /**
   * 投稿に紐づく投票情報を取得
   */
  getPoll(ctx: AppAuthContext, postId: string): Promise<Poll | null>;

  /**
   * 投票する
   */
  voteOnPoll(ctx: AppAuthContext, input: PollVoteInput): Promise<Poll | null>;

  /**
   * リポストする
   */
  repost(ctx: AppAuthContext, input: RepostInput): Promise<{ reposted: boolean; id?: string }>;

  /**
   * リポストを取り消す
   */
  undoRepost(ctx: AppAuthContext, postId: string): Promise<void>;

  /**
   * リポスト一覧
   */
  listReposts(ctx: AppAuthContext, params: RepostListParams): Promise<RepostListResult>;

  /**
   * リアクション一覧
   */
  listReactions(ctx: AppAuthContext, postId: string): Promise<Reaction[]>;

  /**
   * リアクション削除
   */
  removeReaction(ctx: AppAuthContext, reactionId: string): Promise<void>;

  /**
   * コメント一覧
   */
  listComments(ctx: AppAuthContext, postId: string): Promise<Post[]>;

  /**
   * ブックマーク追加
   */
  addBookmark(ctx: AppAuthContext, postId: string): Promise<void>;

  /**
   * ブックマーク削除
   */
  removeBookmark(ctx: AppAuthContext, postId: string): Promise<void>;

  /**
   * ブックマーク一覧
   */
  listBookmarks(ctx: AppAuthContext, params?: { limit?: number; offset?: number }): Promise<BookmarkPage>;

  /**
   * ピン留め投稿一覧
   */
  listPinnedPosts(ctx: AppAuthContext, params?: { user_id?: string; limit?: number }): Promise<Post[]>;
}

/**
 * PostService の実装を提供するファクトリー関数の型
 */
export type PostServiceFactory = (env: unknown) => PostService;
