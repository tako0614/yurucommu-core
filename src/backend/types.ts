import type { TakosClient } from './lib/takos-client.ts';
import type { Database } from '../db/index.ts';
import type { DeliveryQueueMessageV1, DeliveryDlqMessageV1 } from './lib/delivery/types.ts';

/**
 * Environment Variables (common across all runtimes)
 */
export interface EnvVars {
  APP_URL: string;

  // Takos-specific endpoints are opt-in (fail-close by default).
  ENABLE_TAKOS_PROXY?: string;
  ENABLE_TAKOS_TOOLS?: string;

  // 認証設定（自由に組み合わせ可能）
  AUTH_PASSWORD_HASH?: string; // PBKDF2-hashed password
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;
  TAKOS_URL?: string;
  TAKOS_CLIENT_ID?: string;
  TAKOS_CLIENT_SECRET?: string;
  // OAuth autoEnv compatibility (CLIENT_ID/CLIENT_SECRET)
  CLIENT_ID?: string;
  CLIENT_SECRET?: string;
  AUTH_MODE?: string;
  ENCRYPTION_KEY?: string; // 32-byte hex key for encrypting sensitive data

  // Shadow delivery probes (staging-only). Comma-separated hosts.
  DELIVERY_SHADOW_PROBE_HOSTS?: string;
  // 0.0-1.0 sampling rate for probes (default: 1.0)
  DELIVERY_SHADOW_PROBE_SAMPLE_RATE?: string;
}

/**
 * Application Environment
 *
 * Uses Cloudflare Workers API (DB, MEDIA, KV, ASSETS).
 * For non-Cloudflare runtimes (Node.js, Bun, Deno), the compatibility layers
 * in runtime/compat*.ts provide implementations that are cast to these types.
 *
 * DB_INSTANCE: Optional pre-created database instance for non-Cloudflare runtimes.
 * If provided, the middleware will use this instead of creating a new one with D1 adapter.
 */
export type Env = {
  DB: D1Database;
  MEDIA: R2Bucket;
  KV: KVNamespace;
  ASSETS: Fetcher;
  DB_INSTANCE?: Database;
  DELIVERY_QUEUE?: Queue<DeliveryQueueMessageV1>;
  DELIVERY_DLQ?: Queue<DeliveryDlqMessageV1>;
} & EnvVars;

export type Variables = {
  actor: Actor | null;
  takosClient: TakosClient | null;
  db: Database;
  oauthToken?: { sub: string; scope: string; client_id: string };
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
  share_count: number;
  published: string;
  is_local: number;
}

// Re-export Hono types for route files
export type { Context } from 'hono';
