import type { Context } from 'hono';
import type { Env, Variables } from '../../types.ts';

export type ActivityContext = Context<{ Bindings: Env; Variables: Variables }>;

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
  target?: string | ActivityObject;
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
