// Types for Yurucommu backend

export type Env = {
  DB: D1Database;
  MEDIA: R2Bucket;
  KV: KVNamespace;
  ASSETS: Fetcher;
  APP_URL: string;

  // 認証設定（自由に組み合わせ可能）
  // パスワード認証
  AUTH_PASSWORD?: string;

  // Google OAuth
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;

  // X (Twitter) OAuth
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;

  // Takos OAuth
  TAKOS_URL?: string;
  TAKOS_CLIENT_ID?: string;
  TAKOS_CLIENT_SECRET?: string;

  // 非推奨（後方互換性）
  AUTH_MODE?: string;
};

export type Variables = {
  actor: Actor | null;
};

// Local actor (Person)
export interface Actor {
  ap_id: string;  // Primary key: https://domain/ap/users/username
  type: string;
  preferred_username: string;
  name: string | null;
  summary: string | null;
  icon_url: string | null;
  header_url: string | null;
  inbox: string;
  outbox: string;
  followers_url: string;
  following_url: string;
  public_key_pem: string;
  private_key_pem: string;
  takos_user_id: string | null;
  follower_count: number;
  following_count: number;
  post_count: number;
  is_private: number;
  role: 'owner' | 'moderator' | 'member';
  created_at: string;
}

// Cached remote actor
export interface ActorCache {
  ap_id: string;
  type: string;
  preferred_username: string | null;
  name: string | null;
  summary: string | null;
  icon_url: string | null;
  inbox: string;
  public_key_pem: string | null;
  raw_json: string;
}

// AP Object (Note/Post)
export interface APObject {
  ap_id: string;
  type: string;
  attributed_to: string;
  content: string;
  summary: string | null;
  attachments_json: string;
  in_reply_to: string | null;
  visibility: string;
  community_ap_id: string | null;
  end_time: string | null;
  like_count: number;
  reply_count: number;
  announce_count: number;
  published: string;
  is_local: number;
}

// Re-export Hono types for route files
export type { Context } from 'hono';
