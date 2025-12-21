import type { D1Database, R2Bucket } from '@cloudflare/workers-types';

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  PLATFORM_PUBLIC_KEY: string;
  TENANT_ID: string;
  HOSTNAME: string;
}

export interface LocalUser {
  id: string;
  username: string;
  display_name: string;
  summary: string;
  avatar_url: string | null;
  header_url: string | null;
  public_key: string;
  private_key: string;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: string;
  user_id: string;
  expires_at: number;
  created_at: number;
}

export interface UsedJTI {
  jti: string;
  expires_at: number;
}

export interface Post {
  id: string;
  user_id: string;
  content: string;
  content_warning: string | null;
  visibility: 'public' | 'unlisted' | 'followers' | 'direct';
  in_reply_to_id: string | null;
  published_at: string;
  created_at: string;
  updated_at: string;
}

export interface Follow {
  id: string;
  follower_actor: string;
  following_actor: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
}

export interface Actor {
  '@context': string | string[];
  id: string;
  type: 'Person';
  preferredUsername: string;
  name: string;
  summary: string;
  inbox: string;
  outbox: string;
  followers: string;
  following: string;
  publicKey: {
    id: string;
    owner: string;
    publicKeyPem: string;
  };
  icon?: {
    type: 'Image';
    mediaType: string;
    url: string;
  };
  image?: {
    type: 'Image';
    mediaType: string;
    url: string;
  };
}

export interface ActivityActorObject {
  id?: string;
  url?: string | { href: string } | Array<string | { href: string }>;
}

export interface Activity {
  '@context': string | string[];
  id: string;
  type: string | string[];
  actor: string | ActivityActorObject;
  object?: any;
  to?: string[];
  cc?: string[];
  published?: string;
}

export interface PlatformJWTPayload {
  iss: string;
  aud: string;
  sub: string;
  role: 'owner' | 'admin' | 'editor';
  iat: number;
  exp: number;
  jti: string;
}
