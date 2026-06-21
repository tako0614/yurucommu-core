export const DELIVERY_QUEUE_MESSAGE_VERSION = 1 as const;

export type DeliveryFanoutFollowersMessageV1 = {
  version: typeof DELIVERY_QUEUE_MESSAGE_VERSION;
  type: "fanout_followers";
  activityId: string;
  followeeApId: string;
  scheduledAt: string; // ISO8601 UTC
};

/**
 * Fan-out of an activity to a community's audience (members + community
 * followers) rather than the author's personal follower graph. Used for
 * community-scoped posts so reach == community, not author-followers.
 */
export type DeliveryFanoutCommunityMessageV1 = {
  version: typeof DELIVERY_QUEUE_MESSAGE_VERSION;
  type: "fanout_community";
  activityId: string;
  communityApId: string;
  // The Group's Announce of the post (Announce-relay): delivered to REMOTE
  // community followers in place of the raw author activity, so the post is
  // attributed to the group (Lemmy/Mobilizon convention). Local members still
  // receive `activityId`. Absent for non-Create activities (edit/delete relay
  // the activity directly).
  announceActivityId?: string;
  scheduledAt: string; // ISO8601 UTC
};

export type DeliveryResolveActorMessageV1 = {
  version: typeof DELIVERY_QUEUE_MESSAGE_VERSION;
  type: "resolve_actor";
  activityId: string;
  recipientActorApId: string;
  // How many resolve attempts this message represents. Each failed actor fetch
  // re-enqueues with attempts+1; the handler gives up at a cap so a permanently
  // unresolvable recipient does not generate a queue message forever. Absent on
  // the initial enqueue (treated as 0).
  attempts?: number;
  scheduledAt: string; // ISO8601 UTC
};

export type DeliveryDeliverEndpointMessageV1 = {
  version: typeof DELIVERY_QUEUE_MESSAGE_VERSION;
  type: "deliver_endpoint";
  jobId: string;
  scheduledAt: string; // ISO8601 UTC
};

export type DeliveryReconcileJobMessageV1 = {
  version: typeof DELIVERY_QUEUE_MESSAGE_VERSION;
  type: "reconcile_job";
  jobId: string;
  reconcileAttempt: number;
  scheduledAt: string; // ISO8601 UTC
};

export type DeliveryQueueMessageV1 =
  | DeliveryFanoutFollowersMessageV1
  | DeliveryFanoutCommunityMessageV1
  | DeliveryResolveActorMessageV1
  | DeliveryDeliverEndpointMessageV1
  | DeliveryReconcileJobMessageV1;

export type DeliveryDlqMessageV1 = {
  version: typeof DELIVERY_QUEUE_MESSAGE_VERSION;
  type: "dlq";
  jobId: string;
  activityId: string;
  endpoint: string;
  attempts: number;
  lastError: string | null;
  deadLetteredAt: string; // ISO8601 UTC
};

export function isDeliveryQueueMessageV1(
  value: unknown,
): value is DeliveryQueueMessageV1 {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.version !== DELIVERY_QUEUE_MESSAGE_VERSION) return false;
  if (typeof v.type !== "string") return false;

  switch (v.type) {
    case "fanout_followers":
      return (
        typeof v.activityId === "string" &&
        typeof v.followeeApId === "string" &&
        typeof v.scheduledAt === "string"
      );
    case "fanout_community":
      return (
        typeof v.activityId === "string" &&
        typeof v.communityApId === "string" &&
        typeof v.scheduledAt === "string"
      );
    case "resolve_actor":
      return (
        typeof v.activityId === "string" &&
        typeof v.recipientActorApId === "string" &&
        typeof v.scheduledAt === "string"
      );
    case "deliver_endpoint":
      return typeof v.jobId === "string" && typeof v.scheduledAt === "string";
    case "reconcile_job":
      return (
        typeof v.jobId === "string" &&
        typeof v.reconcileAttempt === "number" &&
        typeof v.scheduledAt === "string"
      );
    default:
      return false;
  }
}

export function isDeliveryDlqMessageV1(
  value: unknown,
): value is DeliveryDlqMessageV1 {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === DELIVERY_QUEUE_MESSAGE_VERSION &&
    v.type === "dlq" &&
    typeof v.jobId === "string" &&
    typeof v.activityId === "string" &&
    typeof v.endpoint === "string" &&
    typeof v.attempts === "number" &&
    (v.lastError === null || typeof v.lastError === "string") &&
    typeof v.deadLetteredAt === "string"
  );
}
