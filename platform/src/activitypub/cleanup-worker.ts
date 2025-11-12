/**
 * Cleanup Worker - Scheduled task to remove old processed records
 *
 * Prevents database bloat by periodically deleting old:
 * - Processed inbox activities
 * - Delivered activities
 * - Old failed deliveries (after long retention)
 * - Expired rate limits
 */

import { makeData } from "../server/data-factory";

interface Env {
  DB: D1Database;
  INSTANCE_DOMAIN?: string;
}

/**
 * Configuration for cleanup retention periods
 */
const RETENTION = {
  // Delete processed inbox activities after 7 days
  inboxProcessed: 7,
  
  // Delete delivered activities after 7 days
  deliveryDelivered: 7,
  
  // Delete failed deliveries after 30 days (keep longer for analysis)
  deliveryFailed: 30,
  
  // Delete rate limit entries older than 24 hours
  rateLimits: 1,
  
  // Delete old actor cache entries after 90 days
  actorCache: 90,
};

/**
 * Clean up old inbox activities
 */
async function cleanupInboxActivities(env: Env): Promise<{ deleted: number }> {
  const db = makeData(env as any);

  try {
    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION.inboxProcessed);

    // Delete old processed activities
    const result = await db.executeRaw(
      `DELETE FROM ap_inbox_activities
       WHERE status = 'processed'
         AND processed_at < ?`,
      cutoffDate.toISOString(),
    );

    console.log(`✓ Cleaned up ${result} old inbox activities (older than ${RETENTION.inboxProcessed} days)`);
    return { deleted: result };
  } catch (error) {
    console.error("Failed to cleanup inbox activities:", error);
    return { deleted: 0 };
  } finally {
    await db.disconnect();
  }
}

/**
 * Clean up old delivery queue records
 */
async function cleanupDeliveryQueue(env: Env): Promise<{ delivered: number; failed: number }> {
  const db = makeData(env as any);

  try {
    // Calculate cutoff dates
    const deliveredCutoff = new Date();
    deliveredCutoff.setDate(deliveredCutoff.getDate() - RETENTION.deliveryDelivered);

    const failedCutoff = new Date();
    failedCutoff.setDate(failedCutoff.getDate() - RETENTION.deliveryFailed);

    // Delete old delivered activities
    const deliveredResult = await db.executeRaw(
      `DELETE FROM ap_delivery_queue
       WHERE status = 'delivered'
         AND delivered_at < ?`,
      deliveredCutoff.toISOString(),
    );

    console.log(`✓ Cleaned up ${deliveredResult} delivered activities (older than ${RETENTION.deliveryDelivered} days)`);

    // Delete old failed activities
    const failedResult = await db.executeRaw(
      `DELETE FROM ap_delivery_queue
       WHERE status = 'failed'
         AND last_attempt_at < ?`,
      failedCutoff.toISOString(),
    );

    console.log(`✓ Cleaned up ${failedResult} failed deliveries (older than ${RETENTION.deliveryFailed} days)`);

    return {
      delivered: deliveredResult,
      failed: failedResult,
    };
  } catch (error) {
    console.error("Failed to cleanup delivery queue:", error);
    return { delivered: 0, failed: 0 };
  } finally {
    await db.disconnect();
  }
}

/**
 * Clean up old rate limit entries
 */
async function cleanupRateLimits(env: Env): Promise<{ deleted: number }> {
  const db = makeData(env as any);

  try {
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - RETENTION.rateLimits * 24);

    const result = await db.executeRaw(
      `DELETE FROM ap_rate_limits
       WHERE created_at < ?`,
      cutoffDate.toISOString(),
    );

    console.log(`✓ Cleaned up ${result} old rate limit entries (older than ${RETENTION.rateLimits} day(s))`);
    return { deleted: result };
  } catch (error) {
    console.error("Failed to cleanup rate limits:", error);
    return { deleted: 0 };
  } finally {
    await db.disconnect();
  }
}

/**
 * Clean up old actor cache (optional - actors don't expire, but can be refreshed)
 */
async function cleanupActorCache(env: Env): Promise<{ deleted: number }> {
  const db = makeData(env as any);

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION.actorCache);

    // Only delete if last_fetched_at is very old (90 days+)
    // This is conservative - actors rarely change dramatically
    const result = await db.executeRaw(
      `DELETE FROM ap_actors
       WHERE last_fetched_at < ?`,
      cutoffDate.toISOString(),
    );

    console.log(`✓ Cleaned up ${result} stale actor cache entries (older than ${RETENTION.actorCache} days)`);
    return { deleted: result };
  } catch (error) {
    console.error("Failed to cleanup actor cache:", error);
    return { deleted: 0 };
  } finally {
    await db.disconnect();
  }
}

/**
 * Main cleanup function - runs all cleanup tasks
 */
export async function runCleanup(env: Env): Promise<void> {
  console.log("🧹 Cleanup worker started at", new Date().toISOString());
  
  const startTime = Date.now();
  
  try {
    // Run all cleanup tasks in parallel
    const [inbox, delivery, rateLimits, actorCache] = await Promise.all([
      cleanupInboxActivities(env),
      cleanupDeliveryQueue(env),
      cleanupRateLimits(env),
      cleanupActorCache(env),
    ]);
    
    const duration = Date.now() - startTime;
    
    console.log(`✅ Cleanup completed in ${duration}ms`);
    console.log(`   - Inbox: ${inbox.deleted} deleted`);
    console.log(`   - Delivery (delivered): ${delivery.delivered} deleted`);
    console.log(`   - Delivery (failed): ${delivery.failed} deleted`);
    console.log(`   - Rate limits: ${rateLimits.deleted} deleted`);
    console.log(`   - Actor cache: ${actorCache.deleted} deleted`);
    
    // Log summary metrics
    const totalDeleted = 
      inbox.deleted + 
      delivery.delivered + 
      delivery.failed + 
      rateLimits.deleted + 
      actorCache.deleted;
    
    console.log(`📊 Total records cleaned: ${totalDeleted}`);
  } catch (error) {
    console.error("❌ Cleanup worker error:", error);
    throw error;
  }
}

/**
 * Scheduled event handler
 */
export async function handleCleanupScheduled(event: ScheduledEvent, env: Env): Promise<void> {
  console.log("Cleanup worker triggered at", new Date(event.scheduledTime).toISOString());
  await runCleanup(env);
}

/**
 * Get cleanup statistics (for monitoring)
 */
export async function getCleanupStats(env: Env): Promise<{
  inboxPending: number;
  inboxProcessed: number;
  deliveryPending: number;
  deliveryDelivered: number;
  deliveryFailed: number;
  rateLimits: number;
}> {
  const db = makeData(env as any);

  try {
    const [inbox, delivery, rateLimits] = await Promise.all([
      db.getApInboxStats(),
      db.getApDeliveryQueueStats(),
      db.countApRateLimits(),
    ]);

    return {
      inboxPending: Number(inbox?.pending || 0),
      inboxProcessed: Number(inbox?.processed || 0),
      deliveryPending: Number(delivery?.pending || 0),
      deliveryDelivered: Number(delivery?.delivered || 0),
      deliveryFailed: Number(delivery?.failed || 0),
      rateLimits: Number(rateLimits || 0),
    };
  } catch (error) {
    console.error("Failed to get cleanup stats:", error);
    return {
      inboxPending: 0,
      inboxProcessed: 0,
      deliveryPending: 0,
      deliveryDelivered: 0,
      deliveryFailed: 0,
      rateLimits: 0,
    };
  } finally {
    await db.disconnect();
  }
}

