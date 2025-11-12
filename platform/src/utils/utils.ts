/**
 * Common utility functions
 */

import { makeData } from "../server/data-factory";

type Disconnectable = { disconnect?: () => Promise<void> | void };
type QueryableStore = Disconnectable & { query: (sql: string, params?: any[]) => Promise<any[]> };

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
  await store.query("BEGIN TRANSACTION");
  try {
    const result = await fn();
    await store.query("COMMIT");
    return result;
  } catch (error) {
    await store.query("ROLLBACK");
    throw error;
  }
}

/**
 * Enqueue activity deliveries to followers (optimized with JOIN)
 * Avoids N+1 queries by using a single INSERT INTO...SELECT statement
 * 
 * @param store - Database store
 * @param userId - Local user ID
 * @param activityId - Activity ID to deliver
 */
export async function enqueueDeliveriesToFollowers(
  store: QueryableStore,
  userId: string,
  activityId: string,
): Promise<void> {
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
    [activityId, userId]
  );
}
