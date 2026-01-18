// Types for Yurucommu backend

import type { TakosClient } from './lib/takos-client';
import type { PrismaClient } from '../generated/prisma';

/**
 * Environment Variables (common across all runtimes)
 */
export interface EnvVars {
  APP_URL: string;

  // 認証設定（自由に組み合わせ可能）
  AUTH_PASSWORD?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;
  TAKOS_URL?: string;
  TAKOS_CLIENT_ID?: string;
  TAKOS_CLIENT_SECRET?: string;
  AUTH_MODE?: string;
}

/**
 * Application Environment
 *
 * Uses Cloudflare Workers API (DB, MEDIA, KV, ASSETS).
 * For non-Cloudflare runtimes (Node.js, Bun, Deno), the compatibility layers
 * in runtime/compat*.ts provide implementations that are cast to these types.
 *
 * PRISMA: Optional pre-created Prisma client for non-Cloudflare runtimes.
 * If provided, the middleware will use this instead of creating a new one with D1 adapter.
 */
export type Env = {
  DB: D1Database;
  MEDIA: R2Bucket;
  KV: KVNamespace;
  ASSETS: Fetcher;
  PRISMA?: PrismaClient;
} & EnvVars;

export type Variables = {
  actor: Actor | null;
  takosClient: TakosClient | null;
  prisma: PrismaClient;
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
