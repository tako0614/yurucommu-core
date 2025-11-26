// Shared types for the account backend

import type { Context } from "hono";
import type { StoryItem } from "./stories/story-schema";

export type BaseBindings = {
  DB: any; // D1Database from @cloudflare/workers-types
  ASSETS: any;
  MEDIA?: any; // R2Bucket from @cloudflare/workers-types
  ACCOUNT_BACKEND?: any; // Service Binding (Fetcher) for sibling tenant access
};

type PushBindings = {
  PUSH_NOTIFICATION_TITLE?: string;
  PUSH_GATEWAY_URL?: string;
  PUSH_WEBHOOK_SECRET?: string;
  PUSH_REGISTRATION_PRIVATE_KEY?: string;
  PUSH_REGISTRATION_PUBLIC_KEY?: string;
  FCM_SERVER_KEY?: string;
  DEFAULT_PUSH_SERVICE_URL?: string;
  DEFAULT_PUSH_SERVICE_SECRET?: string;
};

type SessionBindings = {
  SESSION_COOKIE_NAME?: string;
  SESSION_TTL_HOURS?: string;
  SESSION_REFRESH_INTERVAL_SECONDS?: string;
};

type ActivityPubBindings = {
  INSTANCE_DOMAIN?: string;
  ACTIVITYPUB_ENABLED?: string;
  DB_ENCRYPTION_KEY?: string;
};

type EnvCredentialBindings = {
  AUTH_USERNAME?: string;
  AUTH_PASSWORD?: string;
};

type HostIntegrationBindings = {
  HOST_ORIGIN?: string;
  HOST_SHARED_SECRET?: string;
  INSTANCE_OWNER_HANDLE?: string;
};

type CronBindings = {
  CRON_SECRET?: string;
};

export type PublicAccountBindings = BaseBindings &
  PushBindings &
  SessionBindings &
  ActivityPubBindings &
  EnvCredentialBindings &
  CronBindings;

export type PrivateAccountBindings = PublicAccountBindings & HostIntegrationBindings;

// Backward compatible alias
export type Bindings = PrivateAccountBindings;

export type Variables = {
  user: any;
  activityPubUser?: any;
};

export type AppContext<TBindings extends BaseBindings = Bindings> = Context<{
  Bindings: TBindings;
  Variables: Variables;
}>;

export type User = {
  id: string;
  display_name: string;
  avatar_url?: string | null;
  handle?: string | null;
  bio?: string | null;
  created_at?: Date | string;
  is_private?: number;
  profile_completed_at?: Date | string | null;
  summary?: string | null;
  manually_approves_followers?: number;
  friend_status?: 'pending' | 'accepted' | 'rejected' | null;
};

export type Session = {
  id: string;
  user_id: string;
  created_at: Date | string;
  last_seen: Date | string;
  expires_at: Date | string;
};

export type Community = {
  id: string;
  name: string;
  icon_url?: string | null;
  visibility?: string;
  description?: string | null;
  invite_policy?: string;
  created_by?: string;
  created_at?: Date | string;
  ap_id?: string | null;
};

export type Post = {
  id: string;
  community_id: string | null;
  author_id: string;
  type: string;
  text: string;
  content_warning?: string | null;
  sensitive?: number | boolean;
  media_json: string;
  media?: MediaAttachment[];
  created_at: Date | string;
  pinned: number;
  broadcast_all: number;
  visible_to_friends: number;
  attributed_community_id: string | null;
  ap_object_id?: string | null;
  ap_attributed_to?: string | null;
  in_reply_to?: string | null;
  ap_activity_id?: string | null;
};

export type MediaAttachment = {
  url: string;
  description?: string | null;
  content_type?: string | null;
};

export type Story = {
  id: string;
  community_id: string | null;
  author_id: string;
  created_at: Date | string;
  expires_at: Date | string;
  items: StoryItem[];
  items_json?: string;
  broadcast_all?: number;
  visible_to_friends?: number;
  attributed_community_id?: string | null;
};
