/**
 * Common utility functions
 */

import { makeData } from "../server/data-factory";
import type { DatabaseAPI } from "../db/types";
import { getActivityPubAvailability } from "../server/context";
import { deliverSingleQueuedItem } from "../activitypub/delivery-worker";

type Disconnectable = { disconnect?: () => Promise<void> | void };
type QueryableStore = Disconnectable & { query: (sql: string, params?: any[]) => Promise<any[]> };
type DeliveryQueueStore = Pick<DatabaseAPI, "createApDeliveryQueueItem">;

/**
 * Release database store connection
 * Common utility to avoid code duplication
 */
export async function releaseStore(store: Disconnectable | null | undefined): Promise<void> {
  if (!store || typeof store.disconnect !== "function") return;
  try {
    await store.disconnect();
  } catch (err) {
    console.error("store disconnect failed", err);
  }
}

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  initialDelay = 100,
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (i < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, i);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

/**
 * Execute a function with resource cleanup
 * Ensures store.disconnect() is called even if the function throws
 */
export async function withStore<T>(
  env: any,
  fn: (store: QueryableStore) => Promise<T>,
): Promise<T> {
  const store = makeData<QueryableStore>(env);
  try {
    return await fn(store);
  } finally {
    await releaseStore(store);
  }
}

/**
 * Execute a function within a database transaction
 * Automatically commits on success, rolls back on error
 */
export async function withTransaction<T>(
  store: QueryableStore,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    // D1 does not support interactive transactions; fall back to best-effort execution
    await store.query("BEGIN TRANSACTION");
  } catch (error: any) {
    const msg = String(error?.message || error);
    if (msg.includes("does not support interactive transactions")) {
      console.warn("Transaction not supported on this database - executing without BEGIN/COMMIT");
      return fn();
    }
    throw error;
  }

  try {
    const result = await fn();
    await store.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await store.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("ROLLBACK failed", rollbackError);
    }
    throw error;
  }
}

type EnqueueDeliveriesOptions = {
  env?: any;
  /**
   * Followers below this count are delivered immediately (still queued for retry),
   * otherwise they stay queued for the scheduled worker.
   */
  immediateThreshold?: number;
};

/**
 * Enqueue activity deliveries to followers.
 * - For large fanout (>= immediateThreshold), enqueue only and let the worker handle it.
 * - For small fanout, enqueue then immediately attempt delivery to avoid waiting for cron.
 */
export async function enqueueDeliveriesToFollowers(
  store: QueryableStore,
  userId: string,
  activityId: string,
  options: EnqueueDeliveriesOptions = {},
): Promise<void> {
  const availability = getActivityPubAvailability(options.env ?? {});
  if (!availability.enabled) {
    console.warn(
      `[ActivityPub] follower delivery skipped in ${availability.context} context: ${availability.reason}`,
    );
    return;
  }

  const threshold = options.immediateThreshold ?? 500;

  // Count followers that can receive deliveries
  const followerCountRows = await store.query(
    `SELECT COUNT(*) as count
     FROM ap_followers f
     JOIN ap_actors a ON f.remote_actor_id = a.id
     WHERE f.local_user_id = ?
       AND f.status = 'accepted'
       AND a.inbox_url IS NOT NULL`,
    [userId],
  );
  const followerCount = Number(followerCountRows?.[0]?.count ?? 0);

  if (followerCount === 0) {
    return;
  }

  const shouldQueueOnly = !options.env || followerCount >= threshold;

  if (shouldQueueOnly) {
    // Use INSERT INTO...SELECT with JOIN to avoid N+1 queries
    await store.query(
      `INSERT INTO ap_delivery_queue (id, activity_id, target_inbox_url, status, created_at)
       SELECT 
         lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
         ?,
         a.inbox_url,
         'pending',
         datetime('now')
       FROM ap_followers f
       JOIN ap_actors a ON f.remote_actor_id = a.id
       WHERE f.local_user_id = ? 
         AND f.status = 'accepted'
         AND a.inbox_url IS NOT NULL`,
      [activityId, userId],
    );
    return;
  }

  // Small fanout: insert per recipient so we can immediately deliver them
  const followers = await store.query(
    `SELECT a.inbox_url
     FROM ap_followers f
     JOIN ap_actors a ON f.remote_actor_id = a.id
     WHERE f.local_user_id = ?
       AND f.status = 'accepted'
       AND a.inbox_url IS NOT NULL`,
    [userId],
  );

  const deliveryIds: string[] = [];

  for (const follower of followers) {
    const inboxUrl = follower?.inbox_url;
    if (!inboxUrl) continue;

    const deliveryId = crypto.randomUUID();
    deliveryIds.push(deliveryId);

    await store.query(
      `INSERT INTO ap_delivery_queue 
       (id, activity_id, target_inbox_url, status, created_at)
       VALUES (?, ?, ?, 'pending', datetime('now'))`,
      [deliveryId, activityId, inboxUrl],
    );
  }

  // Attempt immediate delivery; failures stay queued for the worker to retry.
  for (const deliveryId of deliveryIds) {
    try {
      await deliverSingleQueuedItem(options.env as any, deliveryId);
    } catch (error) {
      console.warn(
        `[delivery] immediate delivery failed, will retry via worker`,
        { deliveryId, error },
      );
    }
  }
}

type ImmediateDeliveryInput = {
  activity_id: string;
  target_inbox_url: string;
  id?: string;
  status?: string;
  created_at?: string | Date;
};

/**
 * Queue a single delivery and attempt to send it immediately.
 * Falls back to the delivery worker if the synchronous send fails.
 */
export async function queueImmediateDelivery(
  store: DeliveryQueueStore,
  env: any,
  input: ImmediateDeliveryInput,
): Promise<string | null> {
  const availability = getActivityPubAvailability(env ?? {});
  if (!availability.enabled) {
    console.warn(
      `[ActivityPub] immediate delivery skipped in ${availability.context} context: ${availability.reason}`,
    );
    return null;
  }

  const delivery = await store.createApDeliveryQueueItem({
    id: input.id,
    activity_id: input.activity_id,
    target_inbox_url: input.target_inbox_url,
    status: input.status ?? "pending",
    created_at: input.created_at,
  });

  if (!delivery?.id || !env) {
    return delivery?.id ?? null;
  }

  try {
    await deliverSingleQueuedItem(env as any, delivery.id);
  } catch (error) {
    console.warn("[delivery] immediate delivery failed, left queued for worker", {
      deliveryId: delivery.id,
      error,
    });
  }

  return delivery.id;
}
