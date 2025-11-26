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
import { getOrFetchActor } from "./actor-fetch";

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
        "User-Agent": "Takos/1.0",
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
 * Resolve inbox URL for a recipient
 */
async function resolveInbox(recipient: string, env: Env): Promise<string | null> {
  // Skip the special Public collection
  if (recipient === "https://www.w3.org/ns/activitystreams#Public") {
    return null;
  }

  // If it's already an inbox URL, use it
  if (recipient.endsWith("/inbox")) {
    return recipient;
  }

  // If it's a followers/following collection, skip direct delivery
  // (these should be expanded elsewhere)
  if (recipient.includes("/followers") || recipient.includes("/following")) {
    return null;
  }

  // Otherwise, fetch the actor and get their inbox
  try {
    const actor = await getOrFetchActor(recipient, env);
    if (!actor) {
      console.error(`Failed to resolve inbox for ${recipient}`);
      return null;
    }

    // Prefer sharedInbox for efficiency
    return actor.endpoints?.sharedInbox || actor.inbox;
  } catch (error) {
    console.error(`Error resolving inbox for ${recipient}:`, error);
    // Fallback: assume it's an actor URI and append /inbox
    return `${recipient}/inbox`;
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
       AND (
         (dq.next_attempt_at IS NOT NULL AND dq.next_attempt_at <= datetime('now'))
         OR
         (dq.next_attempt_at IS NULL AND (dq.last_attempt_at IS NULL OR datetime(dq.last_attempt_at, '+5 minutes') < datetime('now')))
       )
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
        
        // Update delivery status (D1 does not support transactions)
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
            // Update retry count and error with exponential backoff
            // Base delay: 5 minutes. Multiplier: 2^retry_count
            // Retry 1: 5m, Retry 2: 10m, Retry 3: 20m, Retry 4: 40m
            const backoffMinutes = 5 * Math.pow(2, newRetryCount - 1);
            
            await store.query(
              `UPDATE ap_delivery_queue
               SET retry_count = ?, last_error = ?, last_attempt_at = datetime('now'),
                   next_attempt_at = datetime('now', '+${backoffMinutes} minutes')
               WHERE id = ?`,
              [newRetryCount, result.error || "unknown error", delivery.id]
            );
            console.warn(`⚠ Retry ${newRetryCount}/${maxRetries} in ${backoffMinutes}m: ${delivery.target_inbox_url} - ${result.error}`);
          }
        }
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
 * Process outbox jobs
 * Expands activities to recipients and queues them for delivery
 */
export async function processOutboxQueue(env: Env, batchSize = 10): Promise<void> {
  const store = makeData(env);
  try {
    // Get pending outbox jobs
    const jobs = await store.query(
      `SELECT id, activity_json, created_at FROM ap_outbox_jobs ORDER BY created_at ASC LIMIT ?`,
      [batchSize]
    );

    if (!jobs || jobs.length === 0) {
      return;
    }

    console.log(`Processing ${jobs.length} outbox jobs`);

    for (const job of jobs) {
      try {
        const activity = JSON.parse(job.activity_json);
        const allRecipients = [
          ...(activity.to || []),
          ...(activity.cc || []),
          ...(activity.bcc || []),
        ];
        const uniqueRecipients = Array.from(new Set(allRecipients)).filter(Boolean) as string[];
        
        // Resolve inboxes
        const inboxes = new Set<string>();
        for (const recipient of uniqueRecipients) {
          const inbox = await resolveInbox(recipient, env);
          if (inbox) {
            inboxes.add(inbox);
          }
        }

        // Queue delivery for each unique inbox
        if (inboxes.size > 0) {
          const activityId = activity.id;
          
          // Queue deliveries (D1 does not support transactions)
          for (const inbox of inboxes) {
            // Check if already queued
            const existing = await store.query(
              `SELECT 1 FROM ap_delivery_queue WHERE activity_id = ? AND target_inbox_url = ?`,
              [activityId, inbox]
            );
            
            if (existing.length === 0) {
              await store.query(
                `INSERT INTO ap_delivery_queue 
                 (id, activity_id, target_inbox_url, status, created_at)
                 VALUES (?, ?, ?, 'pending', datetime('now'))`,
                [crypto.randomUUID(), activityId, inbox]
              );
            }
          }
          
          // Delete processed job
          await store.query(`DELETE FROM ap_outbox_jobs WHERE id = ?`, [job.id]);
          
          console.log(`✓ Queued activity ${activityId} to ${inboxes.size} inboxes`);
        } else {
          // No recipients, just delete the job
          await store.query(`DELETE FROM ap_outbox_jobs WHERE id = ?`, [job.id]);
          console.log(`ℹ︎ No recipients for activity ${activity.id}, job deleted`);
        }
      } catch (error) {
        console.error(`Failed to process outbox job ${job.id}:`, error);
        // Don't delete failed jobs immediately, maybe add retry count later
      }
    }
  } finally {
    await store.disconnect?.();
  }
}

/**
 * Deliver a single queued delivery item immediately
 * Used for immediate delivery of lightweight activities (Follow, Accept, Like, etc.)
 */
export async function deliverSingleQueuedItem(env: Env, deliveryId: string): Promise<void> {
  const store = makeData(env);
  try {
    // Get the delivery item with its activity
    const items = await store.query(
      `SELECT dq.id, dq.activity_id, dq.target_inbox_url, dq.retry_count,
              oa.activity_json, oa.local_user_id
       FROM ap_delivery_queue dq
       JOIN ap_outbox_activities oa ON dq.activity_id = oa.activity_id
       WHERE dq.id = ?
       LIMIT 1`,
      [deliveryId]
    );

    if (!items || items.length === 0) {
      console.warn(`Delivery ${deliveryId} not found for immediate delivery`);
      return;
    }

    const delivery = items[0];

    const result = await deliverActivity(
      env,
      delivery.activity_json,
      delivery.target_inbox_url,
      delivery.local_user_id
    );

    // Update delivery status (D1 does not support transactions)
    if (result.success) {
      await store.query(
        `UPDATE ap_delivery_queue
         SET status = 'delivered', delivered_at = datetime('now')
         WHERE id = ?`,
        [delivery.id]
      );
      console.log(`✓ Immediately delivered to ${delivery.target_inbox_url}`);
    } else {
      // Mark as pending with error for scheduled worker to retry
      const newRetryCount = (delivery.retry_count || 0) + 1;
      await store.query(
        `UPDATE ap_delivery_queue
         SET retry_count = ?, last_error = ?, last_attempt_at = datetime('now')
         WHERE id = ?`,
        [newRetryCount, result.error || "unknown error", delivery.id]
      );
      console.warn(`⚠ Immediate delivery failed, will retry: ${delivery.target_inbox_url} - ${result.error}`);
    }
  } catch (error) {
    console.error(`Failed to immediately deliver ${deliveryId}:`, error);
    throw error; // Re-throw so caller knows it failed
  } finally {
    await store.disconnect?.();
  }
}

/**
 * Scheduled handler for Cloudflare Workers Cron Triggers
 */
export async function handleScheduled(event: ScheduledEvent, env: Env): Promise<void> {
  console.log("Delivery worker triggered at", new Date(event.scheduledTime).toISOString());
  
  // Process outbox jobs first (expand to delivery queue)
  await processOutboxQueue(env, 10);
  
  // Then process delivery queue
  await processDeliveryQueue(env, 20);
}

