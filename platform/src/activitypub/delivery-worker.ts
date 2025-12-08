/**
 * Delivery Worker
 * 
 * Processes pending activities in ap_delivery_queue and delivers them
 * to remote inboxes (with HTTP Signatures) or local inboxes (direct DB insert).
 */

import { makeData } from "../server/data-factory";
import { getActivityPubAvailability } from "../server/context";
import { signRequest } from "../auth/http-signature";
import { ensureUserKeyPair } from "../auth/crypto-keys";
import { parseActorUri, requireInstanceDomain } from "../subdomain";
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
const isHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

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
 * Deliver a single activity to an inbox (local or remote)
 */
async function deliverActivity(
  db: any,
  env: Env,
  activityJson: string,
  targetInboxUrl: string,
  actorHandle: string,
): Promise<{ success: boolean; error?: string; blocked?: boolean }> {
  if (!targetInboxUrl || !isHttpUrl(targetInboxUrl)) {
    return { success: false, error: "invalid inbox url", blocked: true };
  }
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

  try {
    const instanceDomain = requireInstanceDomain(env);
    const localCheck = isLocalInbox(targetInboxUrl, instanceDomain);
    let activity: any;
    try {
      activity = JSON.parse(activityJson);
    } catch (error) {
      console.error("Failed to parse activity for delivery", error);
      return { success: false, error: "invalid activity json" };
    }
    
    // Local delivery: insert directly into ap_inbox_activities
    if (localCheck.isLocal && localCheck.handle) {
      const actorUri = activity.actor;
      const activityId = activity.id || crypto.randomUUID();
      
      if (db.createApInboxActivity) {
        await db.createApInboxActivity({
          id: crypto.randomUUID(),
          local_user_id: localCheck.handle,
          remote_actor_id: actorUri,
          activity_id: activityId,
          activity_type: activity.type,
          activity_json: activityJson,
          status: "pending",
          created_at: new Date(),
        });
      } else if (typeof db.queryRaw === "function") {
        await db.queryRaw(
          `INSERT INTO ap_inbox_activities
           (id, local_actor_id, remote_actor_id, activity_id, activity_type, activity_json, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'))`,
          crypto.randomUUID(),
          localCheck.handle,
          actorUri,
          activityId,
          activity.type,
          activityJson,
        );
      }
      
      console.log(`✓ Local delivery: ${activity.type} -> ${localCheck.handle}`);
      return { success: true };
    }
    
    // Remote delivery: HTTP with signature
    // Get actor's private key
    const keypair = await ensureUserKeyPair(db, env, actorHandle);
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
  }
}

function actorHandleFromActivity(activityJson: string, instanceDomain: string): string {
  try {
    const activity = JSON.parse(activityJson);
    const actor = typeof activity.actor === "string"
      ? activity.actor
      : (activity.actor?.id as string | undefined);
    if (!actor) return "";
    const parsed = parseActorUri(actor, instanceDomain);
    return parsed?.handle ?? actor;
  } catch {
    return "";
  }
}

async function hydrateDelivery(db: any, delivery: any): Promise<any> {
  if (delivery.activity_json && (delivery.local_user_id || delivery.local_actor_id)) {
    return delivery;
  }
  if (typeof db.queryRaw === "function") {
    const rows = await db.queryRaw(
      `SELECT activity_json, local_actor_id, local_user_id FROM ap_outbox_activities WHERE activity_id = ? LIMIT 1`,
      delivery.activity_id,
    ).catch(() => []);
    if (rows && rows[0]) {
      return {
        ...delivery,
        activity_json: rows[0].activity_json,
        local_actor_id: rows[0].local_actor_id ?? rows[0].local_user_id,
        local_user_id: rows[0].local_user_id ?? rows[0].local_actor_id,
      };
    }
  }
  return delivery;
}

/**
 * Process delivery queue
 * Fetches pending deliveries and attempts to deliver them
 */
export async function processDeliveryQueue(env: Env, batchSize = 10): Promise<void> {
  if (isActivityPubDisabled(env, "delivery queue")) {
    return;
  }

  const db = makeData(env);
  const processedIds = new Set<string>();
  let claimedIds: string[] = [];

  try {
    console.log("Delivery worker started");
    if (db.resetStaleDeliveries) {
      await db.resetStaleDeliveries(5).catch(() => undefined);
    }

    const claim = await db.claimPendingDeliveries(batchSize);
    claimedIds = claim?.ids ?? (claim?.deliveries?.map((d: any) => d.id) ?? []);
    const deliveries = claim?.deliveries ?? [];

    if (!deliveries.length) {
      console.log("No pending deliveries");
      return;
    }

    console.log(`Processing ${deliveries.length} deliveries`);

    for (const delivery of deliveries) {
      try {
        const hydrated = await hydrateDelivery(db, delivery);
        if (!hydrated.activity_json) {
          console.warn(`Delivery ${hydrated.id} missing activity payload`);
          processedIds.add(hydrated.id);
          continue;
        }

        const actorHandle =
          hydrated.local_user_id ||
          hydrated.local_actor_id ||
          actorHandleFromActivity(hydrated.activity_json, requireInstanceDomain(env)) ||
          "";

        const result = await deliverActivity(
          db,
          env,
          hydrated.activity_json,
          hydrated.target_inbox_url,
          actorHandle,
        );

        const now = new Date();
        const retryCount = hydrated.retry_count || 0;
        const maxRetries = computeMaxRetries(hydrated.activity_json);

        if (result.success) {
          await db.updateApDeliveryQueueStatus(hydrated.id, "delivered", {
            delivered_at: now,
            last_attempt_at: now,
          });
          console.log(`✓ Delivered to ${hydrated.target_inbox_url}`);
          processedIds.add(hydrated.id);
        } else if (result.blocked) {
          await db.updateApDeliveryQueueStatus(hydrated.id, "failed", {
            retry_count: maxRetries,
            last_error: result.error || "blocked by policy",
            last_attempt_at: now,
            delivered_at: null,
          });
          console.warn(`✗ Skipped delivery to ${hydrated.target_inbox_url}: ${result.error}`);
          processedIds.add(hydrated.id);
        } else {
          const newRetryCount = retryCount + 1;

          if (newRetryCount >= maxRetries) {
            await db.updateApDeliveryQueueStatus(hydrated.id, "failed", {
              retry_count: newRetryCount,
              last_error: result.error || "unknown error",
              last_attempt_at: now,
            });
            console.error(`✗ Failed permanently: ${hydrated.target_inbox_url} - ${result.error}`);
            processedIds.add(hydrated.id);
          } else {
            await db.updateApDeliveryQueueStatus(hydrated.id, "pending", {
              retry_count: newRetryCount,
              last_error: result.error || "unknown error",
              last_attempt_at: now,
            });
            console.warn(`⚠ Retry ${newRetryCount}/${maxRetries}: ${hydrated.target_inbox_url} - ${result.error}`);
            processedIds.add(hydrated.id);
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
      if (unprocessed.length && typeof db.executeRaw === "function") {
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
    await db.disconnect?.();
  }
}

/**
 * Deliver a single queued delivery item immediately
 * Used for immediate delivery of lightweight activities (Follow, Accept, Like, etc.)
 */
export async function deliverSingleQueuedItem(env: Env, deliveryId: string): Promise<void> {
  if (isActivityPubDisabled(env, "immediate delivery")) {
    return;
  }

  const db = makeData(env);
  try {
    let delivery = null;
    if (typeof db.queryRaw === "function") {
      const rows = await db.queryRaw(
        `SELECT id, activity_id, target_inbox_url, retry_count FROM ap_delivery_queue WHERE id = ? LIMIT 1`,
        deliveryId,
      );
      delivery = rows?.[0] ?? null;
    }

    if (!delivery) {
      console.warn(`Delivery ${deliveryId} not found for immediate delivery`);
      return;
    }

    const hydrated = await hydrateDelivery(db, delivery);
    if (!hydrated.activity_json) {
      console.warn(`Delivery ${deliveryId} missing activity payload`);
      return;
    }

    const actorHandle =
      hydrated.local_user_id ||
      hydrated.local_actor_id ||
      actorHandleFromActivity(hydrated.activity_json, requireInstanceDomain(env)) ||
      "";
    const maxRetries = computeMaxRetries(hydrated.activity_json);

    const result = await deliverActivity(
      db,
      env,
      hydrated.activity_json,
      hydrated.target_inbox_url,
      actorHandle,
    );

    const now = new Date();
    if (result.success) {
      await db.updateApDeliveryQueueStatus(hydrated.id, "delivered", {
        delivered_at: now,
        last_attempt_at: now,
      });
      console.log(`✓ Immediately delivered to ${hydrated.target_inbox_url}`);
    } else if (result.blocked) {
      await db.updateApDeliveryQueueStatus(hydrated.id, "failed", {
        retry_count: maxRetries,
        last_error: result.error || "blocked by policy",
        last_attempt_at: now,
        delivered_at: null,
      });
      console.warn(`✗ Immediate delivery blocked: ${hydrated.target_inbox_url} - ${result.error}`);
    } else {
      const newRetryCount = (hydrated.retry_count || 0) + 1;
      if (newRetryCount >= maxRetries) {
        await db.updateApDeliveryQueueStatus(hydrated.id, "failed", {
          retry_count: newRetryCount,
          last_error: result.error || "unknown error",
          last_attempt_at: now,
        });
        console.error(`✗ Immediate delivery failed permanently: ${hydrated.target_inbox_url} - ${result.error}`);
      } else {
        await db.updateApDeliveryQueueStatus(hydrated.id, "pending", {
          retry_count: newRetryCount,
          last_error: result.error || "unknown error",
          last_attempt_at: now,
        });
        console.warn(`⚠ Immediate delivery failed, will retry: ${hydrated.target_inbox_url} - ${result.error}`);
      }
    }
  } catch (error) {
    console.error(`Failed to immediately deliver ${deliveryId}:`, error);
    throw error; // Re-throw so caller knows it failed
  } finally {
    await db.disconnect?.();
  }
}

/**
 * Scheduled handler for Cloudflare Workers Cron Triggers
 */
export async function handleScheduled(event: ScheduledEvent, env: Env): Promise<void> {
  console.log("Delivery worker triggered at", new Date(event.scheduledTime).toISOString());
  if (isActivityPubDisabled(env, "delivery worker (scheduled)")) {
    return;
  }

  // Process delivery queue
  await processDeliveryQueue(env, 20);
}
