/**
 * Delivery Worker
 * 
 * Processes pending activities in ap_delivery_queue and delivers them
 * to remote inboxes (with HTTP Signatures) or local inboxes (direct DB insert).
 */

import { makeData } from "../server/data-factory";
import { signRequest } from "../auth/http-signature";
import { ensureUserKeyPair } from "../auth/crypto-keys";
import { requireInstanceDomain } from "../subdomain";
import { withTransaction } from "../utils/utils";

interface Env {
  DB: D1Database;
  INSTANCE_DOMAIN?: string;
  DB_ENCRYPTION_KEY?: string;
}

/**
 * Check if inbox URL is local (same instance)
 */
function isLocalInbox(
  inboxUrl: string,
  instanceDomain: string,
): { isLocal: boolean; handle?: string } {
  try {
    const url = new URL(inboxUrl);
    const hostname = url.hostname.toLowerCase();

    if (hostname !== instanceDomain.toLowerCase()) {
      return { isLocal: false };
    }

    const match = url.pathname.match(
      /^\/ap\/users\/([a-z0-9_]{3,20})\/inbox$/,
    );
    if (match) {
      return { isLocal: true, handle: match[1] };
    }

    return { isLocal: false };
  } catch {
    return { isLocal: false };
  }
}

/**
 * Deliver a single activity to an inbox (local or remote)
 */
async function deliverActivity(
  env: Env,
  activityJson: string,
  targetInboxUrl: string,
  actorHandle: string,
): Promise<{ success: boolean; error?: string }> {
  const store = makeData(env);
  try {
    const instanceDomain = requireInstanceDomain(env);
    const localCheck = isLocalInbox(targetInboxUrl, instanceDomain);
    
    // Local delivery: insert directly into ap_inbox_activities
    if (localCheck.isLocal && localCheck.handle) {
      const activity = JSON.parse(activityJson);
      const actorUri = activity.actor;
      const activityId = activity.id || crypto.randomUUID();
      
      await store.query(
        `INSERT INTO ap_inbox_activities
         (id, local_user_id, remote_actor_id, activity_id, activity_type, activity_json, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'))`,
        [
          crypto.randomUUID(),
          localCheck.handle,
          actorUri,
          activityId,
          activity.type,
          activityJson,
        ]
      );
      
      console.log(`✓ Local delivery: ${activity.type} -> ${localCheck.handle}`);
      return { success: true };
    }
    
    // Remote delivery: HTTP with signature
    const activity = JSON.parse(activityJson);
    
    // Get actor's private key
    const keypair = await ensureUserKeyPair(store, env, actorHandle);
    const privateKeyPem = keypair.privateKeyPem;
    const keyId = `${activity.actor}#main-key`;
    
    // Create and sign request
    const req = new Request(targetInboxUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/activity+json",
        "User-Agent": "YuruCommu/1.0",
      },
      body: activityJson,
    });
    
    const signedInit = await signRequest(req, keyId, privateKeyPem);
    
    // Send request
    const response = await fetch(targetInboxUrl, signedInit);
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error");
      return {
        success: false,
        error: `HTTP ${response.status}: ${errorText}`,
      };
    }
    
    console.log(`✓ Remote delivery: ${activity.type} -> ${targetInboxUrl}`);
    return { success: true };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || String(error),
    };
  } finally {
    await store.disconnect?.();
  }
}

/**
 * Process delivery queue
 * Fetches pending deliveries and attempts to deliver them
 */
export async function processDeliveryQueue(env: Env, batchSize = 10): Promise<void> {
  const store = makeData(env);
  try {
    // Get pending deliveries
    const pending = await store.query(
      `SELECT dq.id, dq.activity_id, dq.target_inbox_url, dq.retry_count, dq.last_attempt_at,
              oa.activity_json, oa.local_user_id
       FROM ap_delivery_queue dq
       JOIN ap_outbox_activities oa ON dq.activity_id = oa.activity_id
       WHERE dq.status = 'pending'
       AND (dq.last_attempt_at IS NULL OR datetime(dq.last_attempt_at, '+5 minutes') < datetime('now'))
       ORDER BY dq.created_at ASC
       LIMIT ?`,
      [batchSize]
    );
    
    if (!pending || pending.length === 0) {
      console.log("No pending deliveries");
      return;
    }
    
    console.log(`Processing ${pending.length} pending deliveries`);
    
    for (const delivery of pending) {
      try {
        const result = await deliverActivity(
          env,
          delivery.activity_json,
          delivery.target_inbox_url,
          delivery.local_user_id
        );
        
        // Update delivery status in a transaction to ensure consistency
        await withTransaction(store, async () => {
          if (result.success) {
            // Mark as delivered
            await store.query(
              `UPDATE ap_delivery_queue
               SET status = 'delivered', delivered_at = datetime('now')
               WHERE id = ?`,
              [delivery.id]
            );
            console.log(`✓ Delivered to ${delivery.target_inbox_url}`);
          } else {
            // Increment retry count
            const newRetryCount = (delivery.retry_count || 0) + 1;
            const maxRetries = 5;
            
            if (newRetryCount >= maxRetries) {
              // Mark as failed after max retries
              await store.query(
                `UPDATE ap_delivery_queue
                 SET status = 'failed', retry_count = ?, last_error = ?, last_attempt_at = datetime('now')
                 WHERE id = ?`,
                [newRetryCount, result.error || "unknown error", delivery.id]
              );
              console.error(`✗ Failed permanently: ${delivery.target_inbox_url} - ${result.error}`);
            } else {
              // Update retry count and error
              await store.query(
                `UPDATE ap_delivery_queue
                 SET retry_count = ?, last_error = ?, last_attempt_at = datetime('now')
                 WHERE id = ?`,
                [newRetryCount, result.error || "unknown error", delivery.id]
              );
              console.warn(`⚠ Retry ${newRetryCount}/${maxRetries}: ${delivery.target_inbox_url} - ${result.error}`);
            }
          }
        });
      } catch (error) {
        console.error(`Failed to process delivery ${delivery.id}:`, error);
        // Continue with next delivery
      }
    }
  } finally {
    await store.disconnect?.();
  }
}

/**
 * Scheduled handler for Cloudflare Workers Cron Triggers
 */
export async function handleScheduled(event: ScheduledEvent, env: Env): Promise<void> {
  console.log("Delivery worker triggered at", new Date(event.scheduledTime).toISOString());
  await processDeliveryQueue(env, 20);
}

