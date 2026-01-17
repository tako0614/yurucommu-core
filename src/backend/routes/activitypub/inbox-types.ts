import type { Env } from '../../types';

export type ActivityObject = {
  id?: string;
  type?: string;
  object?: string;
  inReplyTo?: string;
  to?: string[];
  content?: string;
  summary?: string | null;
  attachment?: unknown;
  overlays?: unknown;
  endTime?: string;
  displayDuration?: string;
  published?: string;
  room?: string;
};

export type Activity = {
  id?: string;
  type?: string;
  actor?: string;
  object?: string | ActivityObject;
  room?: string;
};

export type RemoteActor = {
  id: string;
  type?: string;
  preferredUsername?: string;
  name?: string;
  summary?: string;
  icon?: { url?: string };
  inbox?: string;
  outbox?: string;
  publicKey?: { id?: string; publicKeyPem?: string };
};

export type ActorCacheInboxRow = {
  inbox: string;
};

export type ActivityRow = {
  type: string;
  object_ap_id: string | null;
};

export type ObjectApIdRow = {
  object_ap_id: string;
};

export type AttributedToRow = {
  attributed_to: string;
};

export type ObjectOwnerRow = {
  ap_id: string;
  attributed_to: string;
};

export type ObjectDeleteRow = {
  attributed_to: string;
  type: string;
  reply_count: number;
};

export type FollowRow = {
  follower_ap_id: string;
  following_ap_id: string;
  activity_ap_id: string;
  status: string;
};

export type CommunityRow = {
  ap_id: string;
  preferred_username: string;
};

export type InstanceActor = {
  ap_id: string;
  private_key_pem: string;
  join_policy?: string;
  posting_policy?: string;
};

export type ActivityContext = { env: Env };

export type StoryOverlay = {
  position?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
};

export function getActivityObject(activity: Activity): ActivityObject | null {
  if (!activity.object || typeof activity.object === 'string') return null;
  return activity.object;
}

export function getActivityObjectId(activity: Activity): string | null {
  if (!activity.object) return null;
  if (typeof activity.object === 'string') return activity.object;
  return activity.object.id || null;
}
