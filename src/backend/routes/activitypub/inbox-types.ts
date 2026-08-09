import type { Context } from "hono";
import type { Env, Variables } from "../../types.ts";

export type ActivityContext = Context<{ Bindings: Env; Variables: Variables }>;

export type ActivityObject = {
  id?: string;
  type?: string | string[];
  object?: string;
  inReplyTo?: string;
  to?: string[];
  cc?: string[];
  conversation?: string;
  content?: string;
  summary?: string | null;
  attachment?: unknown;
  tag?: unknown;
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
  /**
   * Bounded object references extracted from scalar, embedded, or array-valued
   * AS2 `object`. Standard Flag activities use an array; keeping the normalized
   * ids separately lets ordinary handlers retain their scalar/object model.
   */
  objectIds?: string[];
  target?: string | ActivityObject;
  /** Envelope-level content, used by Flag as the moderation reason. */
  content?: string;
  room?: string;
  // Envelope addressing, preserved by parseActivity. Shared-inbox routing is
  // derived from these (inbox-addressing.ts); before they were parsed the
  // route had to guess the recipients from the sender's follower graph.
  to?: string[];
  cc?: string[];
  bto?: string[];
  bcc?: string[];
  audience?: string[];
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
  type?: string;
  position?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
};

// AS2 `type` may be a string or an array; this matches a name against either
// shape so `=== "Note"` comparisons keep working once a remote sends an array.
export function typeIncludes(
  type: string | string[] | undefined,
  name: string,
): boolean {
  return Array.isArray(type) ? type.includes(name) : type === name;
}

export function getActivityObject(activity: Activity): ActivityObject | null {
  if (!activity.object || typeof activity.object === "string") return null;
  return activity.object;
}

export function getActivityObjectId(activity: Activity): string | null {
  if (!activity.object) return activity.objectIds?.[0] ?? null;
  if (typeof activity.object === "string") return activity.object;
  return activity.object.id || null;
}
