/**
 * Core Kernel DMService API
 *
 * PLAN.md 3.11.3 に基づくDM/チャット操作の統一インターフェース
 * App Script から安全にDM機能を利用するためのサービスAPI
 */

import type { AppAuthContext } from "../runtime/types";

// Input types
export interface OpenThreadInput {
  /** 参加者のActor URI または handle */
  participants: string[];
}

export interface SendMessageInput {
  /** スレッドID（既存の場合） */
  thread_id?: string;
  /** 参加者のActor URI または handle（新規スレッドの場合） */
  participants?: string[];
  /** メッセージ本文 */
  content: string;
  /** 添付メディアID */
  media_ids?: string[];
}

export interface ListThreadsParams {
  limit?: number;
  offset?: number;
}

export interface ListMessagesParams {
  /** スレッドID */
  thread_id: string;
  limit?: number;
  offset?: number;
  since_id?: string;
  max_id?: string;
}

// Output types
export interface DmThread {
  id: string;
  /** 参加者のActor URI配列 */
  participants: string[];
  created_at: string;
  /** 最新メッセージ（省略可能） */
  latest_message?: DmMessage | null;
  [key: string]: unknown;
}

export interface DmMessage {
  id: string;
  thread_id: string;
  /** 送信者のActor URI */
  sender_actor_uri: string;
  content: string;
  created_at: string;
  media?: DmMedia[];
  /** 送信者情報（エンリッチ用） */
  sender?: DmUser;
  [key: string]: unknown;
}

export interface DmMedia {
  id: string;
  url: string;
  type: string;
  alt?: string;
  [key: string]: unknown;
}

export interface DmUser {
  id: string;
  handle: string;
  display_name?: string;
  avatar?: string;
  [key: string]: unknown;
}

export interface DmThreadPage {
  threads: DmThread[];
  next_offset?: number | null;
  next_cursor?: string | null;
}

export interface DmMessagePage {
  messages: DmMessage[];
  next_offset?: number | null;
  next_cursor?: string | null;
}

/**
 * DMService Interface
 *
 * AuthContext から送信者を自動決定し、ブロック関係のチェックは内部で行われる。
 * 参加者の解決（handle → Actor URI）もサービス内部で行う。
 */
export interface DMService {
  /**
   * DMスレッドを開く（取得または新規作成）
   * @param ctx 認証コンテキスト
   * @param input 参加者情報
   * @returns スレッドIDとメッセージ一覧
   */
  openThread(
    ctx: AppAuthContext,
    input: OpenThreadInput,
  ): Promise<{ threadId: string; messages: DmMessage[] }>;

  /**
   * DMメッセージを送信
   * @param ctx 認証コンテキスト
   * @param input メッセージ内容
   * @returns 送信されたメッセージ
   */
  sendMessage(ctx: AppAuthContext, input: SendMessageInput): Promise<DmMessage>;

  /**
   * ユーザーが参加しているDMスレッド一覧を取得
   * @param ctx 認証コンテキスト
   * @param params ページネーションパラメータ
   * @returns スレッド一覧
   */
  listThreads(ctx: AppAuthContext, params: ListThreadsParams): Promise<DmThreadPage>;

  /**
   * 特定のスレッドのメッセージ一覧を取得
   * @param ctx 認証コンテキスト
   * @param params スレッドIDとページネーションパラメータ
   * @returns メッセージ一覧
   */
  listMessages(ctx: AppAuthContext, params: ListMessagesParams): Promise<DmMessagePage>;
}

/**
 * DMService の実装を提供するファクトリー関数の型
 */
export type DMServiceFactory = (env: unknown) => DMService;
