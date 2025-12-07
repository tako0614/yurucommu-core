/**
 * Delivery Worker (DB API版)
 *
 * Processes pending activities in ap_delivery_queue and delivers them
 * - Uses DatabaseAPI for database operations
 * - Implements idempotency with unique constraints
 * - Prevents race conditions with "processing" status
 */

import type { DatabaseAPI } from "../db/types";
import { signRequest } from "../auth/http-signature";
import { requireInstanceDomain } from "../subdomain";
import { makeData } from "../server/data-factory";
import { getActivityPubAvailability } from "../server/context";
import { ensureUserKeyPair } from "../auth/crypto-keys";
import { applyFederationPolicy, buildActivityPubPolicy } from "./federation-policy";

interface Env {
  DB: D1Database;
  INSTANCE_DOMAIN?: string;
  DB_ENCRYPTION_KEY?: string;
  takosConfig?: any;
}

const resolvePolicy = (env: Env) =>
  buildActivityPubPolicy({
    env,
    config: (env as any)?.takosConfig?.activitypub ?? (env as any)?.activitypub ?? null,
  });

const PUBLIC_AUDIENCE = "https://www.w3.org/ns/activitystreams#Public";
const DEFAULT_MAX_RETRIES = 5;
const DIRECT_MESSAGE_MAX_RETRIES = 2;

function isActivityPubDisabled(env: Env, feature: string): boolean {
  const availability = getActivityPubAvailability(env);
  if (!availability.enabled) {
    console.warn(
      `[ActivityPub] ${feature} skipped in ${availability.context} context: ${availability.reason}`,
    );
    return true;
  }
  return false;
}

const toArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter(Boolean).map((v) => v.toString());
  if (value === null || value === undefined) return [];
  return [value.toString()];
};

function parseActivity(activityJson: string): any | null {
  try {
    return JSON.parse(activityJson);
  } catch {
    return null;
  }
}

function isDirectDelivery(activity: any): boolean {
  if (!activity) return false;
  const object = activity.object ?? {};
  const recipients = [
    ...toArray(activity.to ?? object.to),
    ...toArray(activity.cc ?? object.cc),
    ...toArray(object.bto ?? activity.bto),
    ...toArray(object.bcc ?? activity.bcc),
  ].filter(Boolean);
  if (!recipients.length) return false;
  return !recipients.some(
    (uri) =>
      uri === PUBLIC_AUDIENCE || uri.endsWith("/followers") || uri.endsWith("/following"),
  );
}

function computeMaxRetries(activityJson: string): number {
  const activity = parseActivity(activityJson);
  return isDirectDelivery(activity) ? DIRECT_MESSAGE_MAX_RETRIES : DEFAULT_MAX_RETRIES;
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
 * Deliver a single activity to an inbox (local or remote) with idempotency
 */
async function deliverActivity(
  db: DatabaseAPI,
  env: Env,
  activityJson: string,
  targetInboxUrl: string,
  actorHandle: string,
): Promise<{ success: boolean; error?: string; blocked?: boolean }> {
  try {
    const decision = applyFederationPolicy(targetInboxUrl, resolvePolicy(env));
    if (!decision.allowed) {
      console.warn(
        `[delivery] blocked delivery to ${targetInboxUrl} (${decision.hostname ?? "unknown host"})`,
      );
      return {
        success: false,
        error: `blocked by activitypub policy (${decision.reason ?? "blocked"})`,
        blocked: true,
      };
    }

    const instanceDomain = requireInstanceDomain(env);
    const localCheck = isLocalInbox(targetInboxUrl, instanceDomain);

    // Local delivery: insert directly into ap_inbox_activities (冪等性)
    if (localCheck.isLocal && localCheck.handle) {
      const activity = JSON.parse(activityJson);
      const actorUri = activity.actor;
      const activityId = activity.id || crypto.randomUUID();

      // Create for idempotency (API handles unique constraint)
      await db.createApInboxActivity({
        local_user_id: localCheck.handle,
        remote_actor_id: actorUri,
        activity_id: activityId,
        activity_type: activity.type,
        activity_json: activityJson,
        status: "pending",
      });

      console.log(`✓ Local delivery: ${activity.type} -> ${localCheck.handle}`);
      return { success: true };
    }
    
    // Remote delivery: HTTP with signature
    const activity = JSON.parse(activityJson);
    
    // Get actor's private key
    let privateKeyPem: string | null = null;
    const keyStore = makeData(env);
    try {
      const keypair = await ensureUserKeyPair(keyStore, env, actorHandle);
      privateKeyPem = keypair.privateKeyPem;
    } finally {
      await keyStore.disconnect?.();
    }
    if (!privateKeyPem) {
      return { success: false, error: "No keypair found for actor" };
    }
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
  }
}

/**
 * Process delivery queue with concurrency control
 */
export async function processDeliveryQueue(env: Env, batchSize = 10): Promise<void> {
  if (isActivityPubDisabled(env, "delivery queue")) {
    return;
  }

  const db = makeData(env);
  const processedIds = new Set<string>();
  let claimedIds: string[] = [];

  try {
    console.log("Delivery worker started (DB API版)");

    // Reset stale processing rows (e.g., previous worker crash)
    await db.resetStaleDeliveries(5);

    // Claim a batch atomically
    const claim = await db.claimPendingDeliveries(batchSize);

    claimedIds = claim.ids;
    const deliveries = claim.deliveries;

    if (!deliveries.length) {
      console.log("No pending deliveries");
      return;
    }

    console.log(`Processing ${deliveries.length} deliveries`);

    // STEP 2: Process each delivery
    for (const delivery of deliveries) {
      try {
        const result = await deliverActivity(
          db,
          env,
          delivery.activity_json,
          delivery.target_inbox_url,
          (delivery as any).local_user_id || (delivery as any).local_actor_id,
        );

        const now = new Date();
        const retryCount = delivery.retry_count || 0;
        const maxRetries = computeMaxRetries(delivery.activity_json);

        if (result.success) {
          // Mark as delivered
          await db.updateApDeliveryQueueStatus(delivery.id, "delivered", {
            delivered_at: now,
            last_attempt_at: now,
          });
          console.log(`✓ Delivered to ${delivery.target_inbox_url}`);
          processedIds.add(delivery.id);
        } else if (result.blocked) {
          await db.updateApDeliveryQueueStatus(delivery.id, "failed", {
            retry_count: maxRetries,
            last_error: result.error || "blocked by policy",
            last_attempt_at: now,
            delivered_at: null,
          });
          console.warn(`✗ Skipped delivery to ${delivery.target_inbox_url}: ${result.error}`);
          processedIds.add(delivery.id);
        } else {
          // Increment retry count
          const newRetryCount = retryCount + 1;

          if (newRetryCount >= maxRetries) {
            // Mark as failed after max retries
            await db.updateApDeliveryQueueStatus(delivery.id, "failed", {
              retry_count: newRetryCount,
              last_error: result.error || "unknown error",
              last_attempt_at: now,
            });
            console.error(`✗ Failed permanently: ${delivery.target_inbox_url} - ${result.error}`);
            processedIds.add(delivery.id);
          } else {
            // Keep as pending for retry, update retry count
            await db.updateApDeliveryQueueStatus(delivery.id, "pending", {
              retry_count: newRetryCount,
              last_error: result.error || "unknown error",
              last_attempt_at: now,
            });
            console.warn(`⚠ Retry ${newRetryCount}/${maxRetries}: ${delivery.target_inbox_url} - ${result.error}`);
            processedIds.add(delivery.id);
          }
        }
      } catch (error) {
        console.error(`Failed to process delivery ${delivery.id}:`, error);

        // Reset to pending on error
        try {
          await db.updateApDeliveryQueueStatus(delivery.id, "pending", {
            last_error: error instanceof Error ? error.message : String(error),
            last_attempt_at: new Date(),
          });
          processedIds.add(delivery.id);
        } catch (updateError) {
          console.error(`Failed to update delivery ${delivery.id}:`, updateError);
        }
      }
    }

    console.log("Delivery worker completed");
  } catch (error) {
    console.error("Error in delivery worker:", error);
    if (claimedIds.length) {
      const unprocessed = claimedIds.filter((id) => !processedIds.has(id));
      if (unprocessed.length) {
        const placeholders = unprocessed.map(() => "?").join(", ");
        try {
          await db.executeRaw(
            `UPDATE ap_delivery_queue
             SET status = 'pending',
                 last_attempt_at = NULL
             WHERE id IN (${placeholders})`,
            ...unprocessed,
          );
        } catch (resetError) {
          console.error("Failed to reset delivery queue rows after error:", resetError);
        }
      }
    }
  } finally {
    await db.disconnect();
  }
}

/**
 * Scheduled handler for Cloudflare Workers Cron Triggers
 */
export async function handleDeliveryScheduled(event: ScheduledEvent, env: Env): Promise<void> {
  console.log("Delivery worker triggered at", new Date(event.scheduledTime).toISOString());
  if (isActivityPubDisabled(env, "delivery worker (scheduled)")) {
    return;
  }
  await processDeliveryQueue(env, 20);
}

