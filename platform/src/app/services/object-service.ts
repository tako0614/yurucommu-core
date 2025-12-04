/**
 * Core Kernel ObjectService API
 *
 * PLAN.md 10.2 / 10.5 に基づく Objects コレクションの統一インターフェース
 * ActivityPub オブジェクトを統合管理するためのサービスAPI
 *
 * Objects コレクションは以下を統合:
 * - 投稿 (Note, Article, Question)
 * - DM (Note with to/bto)
 * - ストーリー (Note with takos:story)
 * - コメント (Note with inReplyTo)
 * - リアクション (Like, Announce)
 */

import type { AppAuthContext } from "../runtime/types";

// ActivityPub Visibility
export type APVisibility = "public" | "unlisted" | "followers" | "direct" | "community";

// ActivityPub Object Types
export type APObjectType =
  | "Note"
  | "Article"
  | "Question"
  | "Like"
  | "Announce"
  | "Create"
  | "Update"
  | "Delete"
  | "Follow"
  | "Accept"
  | "Reject";

/**
 * ActivityPub Object (JSON-LD format)
 */
export interface APObject {
  "@context"?: string | string[] | Record<string, unknown>;
  id: string;
  type: APObjectType | string;
  actor: string;
  to?: string[];
  cc?: string[];
  bto?: string[];
  bcc?: string[];
  content?: string;
  summary?: string;
  published?: string;
  updated?: string;
  inReplyTo?: string | null;
  context?: string;
  attachment?: APAttachment[];
  tag?: APTag[];
  // takos extensions
  "takos:poll"?: APPoll;
  "takos:story"?: APStory;
  // Additional properties
  [key: string]: unknown;
}

export interface APAttachment {
  type: string;
  mediaType?: string;
  url: string;
  name?: string;
  width?: number;
  height?: number;
  [key: string]: unknown;
}

export interface APTag {
  type: string;
  name?: string;
  href?: string;
  [key: string]: unknown;
}

export interface APPoll {
  options: { name: string; votes?: number }[];
  multiple?: boolean;
  expiresAt?: string;
  [key: string]: unknown;
}

export interface APStory {
  items: APStoryItem[];
  expiresAt?: string;
  [key: string]: unknown;
}

export interface APStoryItem {
  type: string;
  url?: string;
  x?: number;
  y?: number;
  scale?: number;
  rotation?: number;
  text?: string;
  style?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Stored Object (database representation)
 */
export interface StoredObject {
  id: string;
  local_id: string | null;
  type: string;
  actor: string;
  published: string | null;
  updated: string | null;
  to: string | null; // JSON array
  cc: string | null; // JSON array
  bto: string | null; // JSON array
  bcc: string | null; // JSON array
  context: string | null;
  in_reply_to: string | null;
  content: string; // JSON-LD object
  is_local: number;
  visibility: string | null;
  deleted_at: string | null;
  created_at: string;
}

/**
 * Create Object Input
 */
export interface CreateObjectInput {
  type: APObjectType | string;
  content?: string;
  summary?: string;
  visibility?: APVisibility;
  inReplyTo?: string | null;
  context?: string | null;
  to?: string[];
  cc?: string[];
  bto?: string[];
  bcc?: string[];
  attachment?: APAttachment[];
  tag?: APTag[];
  poll?: APPoll | null;
  story?: APStory | null;
  // Allow additional properties
  [key: string]: unknown;
}

/**
 * Update Object Input
 */
export interface UpdateObjectInput {
  content?: string;
  summary?: string;
  attachment?: APAttachment[];
  tag?: APTag[];
  poll?: APPoll | null;
  [key: string]: unknown;
}

/**
 * Object Query Parameters
 */
export interface ObjectQueryParams {
  type?: string | string[];
  actor?: string;
  context?: string;
  visibility?: APVisibility;
  inReplyTo?: string;
  isLocal?: boolean;
  since?: string;
  until?: string;
  limit?: number;
  cursor?: string;
  includeDeleted?: boolean;
}

/**
 * Timeline Parameters
 */
export interface ObjectTimelineParams {
  type?: string | string[];
  visibility?: APVisibility[];
  limit?: number;
  cursor?: string;
  communityId?: string;
  listId?: string;
  onlyMedia?: boolean;
}

/**
 * Object Page (paginated result)
 */
export interface ObjectPage {
  items: APObject[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * ObjectService Interface
 *
 * Core Kernel サービスとして Objects コレクションへのアクセスを提供
 */
export interface ObjectService {
  /**
   * オブジェクトを作成
   * @param ctx 認証コンテキスト
   * @param input 作成内容
   * @returns 作成された AP オブジェクト
   */
  create(ctx: AppAuthContext, input: CreateObjectInput): Promise<APObject>;

  /**
   * オブジェクトを取得（ID による）
   * @param ctx 認証コンテキスト
   * @param id AP Object ID (URI)
   * @returns AP オブジェクト、または null
   */
  get(ctx: AppAuthContext, id: string): Promise<APObject | null>;

  /**
   * オブジェクトを取得（ローカル ID による）
   * @param ctx 認証コンテキスト
   * @param localId ローカル短縮 ID
   * @returns AP オブジェクト、または null
   */
  getByLocalId(ctx: AppAuthContext, localId: string): Promise<APObject | null>;

  /**
   * オブジェクトをクエリ
   * @param ctx 認証コンテキスト
   * @param params クエリパラメータ
   * @returns オブジェクトのページ
   */
  query(ctx: AppAuthContext, params: ObjectQueryParams): Promise<ObjectPage>;

  /**
   * オブジェクトを更新
   * @param ctx 認証コンテキスト
   * @param id オブジェクト ID
   * @param input 更新内容
   * @returns 更新後の AP オブジェクト
   */
  update(ctx: AppAuthContext, id: string, input: UpdateObjectInput): Promise<APObject>;

  /**
   * オブジェクトを削除（論理削除）
   * @param ctx 認証コンテキスト
   * @param id オブジェクト ID
   */
  delete(ctx: AppAuthContext, id: string): Promise<void>;

  /**
   * タイムラインを取得
   * @param ctx 認証コンテキスト
   * @param params タイムラインパラメータ
   * @returns オブジェクトのページ
   */
  getTimeline(ctx: AppAuthContext, params: ObjectTimelineParams): Promise<ObjectPage>;

  /**
   * スレッドを取得
   * @param ctx 認証コンテキスト
   * @param contextId スレッドコンテキスト ID
   * @returns スレッド内のオブジェクト配列
   */
  getThread(ctx: AppAuthContext, contextId: string): Promise<APObject[]>;

  /**
   * リモートオブジェクトを受信・保存
   * @param ctx 認証コンテキスト
   * @param object 受信した AP オブジェクト
   * @returns 保存された AP オブジェクト
   */
  receiveRemote(ctx: AppAuthContext, object: APObject): Promise<APObject>;

  /**
   * オブジェクトの存在確認
   * @param ctx 認証コンテキスト
   * @param id オブジェクト ID
   * @returns 存在する場合 true
   */
  exists(ctx: AppAuthContext, id: string): Promise<boolean>;
}

/**
 * ObjectService の実装を提供するファクトリー関数の型
 */
export type ObjectServiceFactory = (env: unknown) => ObjectService;

/**
 * Visibility から to/cc を生成するヘルパー
 */
export function visibilityToRecipients(
  visibility: APVisibility,
  actorUri: string,
  followersUri?: string
): { to: string[]; cc: string[] } {
  const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";

  switch (visibility) {
    case "public":
      return {
        to: [PUBLIC],
        cc: followersUri ? [followersUri] : [],
      };
    case "unlisted":
      return {
        to: followersUri ? [followersUri] : [],
        cc: [PUBLIC],
      };
    case "followers":
      return {
        to: followersUri ? [followersUri] : [],
        cc: [],
      };
    case "direct":
    case "community":
    default:
      return {
        to: [],
        cc: [],
      };
  }
}

/**
 * to/cc から Visibility を推測するヘルパー
 */
export function recipientsToVisibility(to: string[], cc: string[]): APVisibility {
  const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";

  if (to.includes(PUBLIC)) {
    return "public";
  }
  if (cc.includes(PUBLIC)) {
    return "unlisted";
  }
  if (to.length > 0 && to.some((r) => r.endsWith("/followers"))) {
    return "followers";
  }
  return "direct";
}

/**
 * takos 標準の @context を生成
 */
export function createTakosContext(): (string | Record<string, unknown>)[] {
  return [
    "https://www.w3.org/ns/activitystreams",
    "https://docs.takos.jp/ns/activitypub/v1.jsonld",
    {
      takos: "https://docs.takos.jp/ns/",
      "takos:poll": { "@type": "@json" },
      "takos:story": { "@type": "@json" },
    },
  ];
}

/**
 * ローカル ID を生成
 */
export function generateLocalId(): string {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  let result = "";
  for (let i = 0; i < 12; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/**
 * ActivityPub オブジェクト ID を生成
 */
export function generateObjectId(baseUrl: string, localId: string): string {
  return `${baseUrl}/objects/${localId}`;
}
