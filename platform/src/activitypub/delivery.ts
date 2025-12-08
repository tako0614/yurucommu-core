import { makeData } from "../server/data-factory";
import { getActivityPubAvailability } from "../server/context";
import { ensureUserKeyPair } from "../auth/crypto-keys";
import { signRequest } from "../auth/http-signature";
import { applyFederationPolicy, buildActivityPubPolicy } from "./federation-policy";

const resolvePolicy = (env: any) =>
  buildActivityPubPolicy({
    env,
    config: (env as any)?.takosConfig?.activitypub ?? (env as any)?.activitypub ?? null,
  });

async function postWithSignature(env: any, actorHandle: string, inboxUrl: string, activity: any) {
  const availability = getActivityPubAvailability(env);
  if (!availability.enabled) {
    console.warn(
      `[ActivityPub] Delivery blocked in ${availability.context} context: ${availability.reason}`,
    );
    return;
  }

  const store = makeData(env);
  try {
    const keypair = await ensureUserKeyPair(store, env, actorHandle);
    const req = new Request(inboxUrl, {
      method: "POST",
      headers: { "Content-Type": "application/activity+json" },
      body: JSON.stringify(activity),
    });
    const signed = await signRequest(req, `${activity.actor}#main-key`, keypair.privateKeyPem);
    const resp = await fetch(inboxUrl, signed);

    if (!resp.ok) throw new Error(`delivery failed ${resp.status}`);
  } finally {
    await store.disconnect?.();
  }
}

/**
 * Sign and send an activity to a specific inbox
 * Wrapper around postWithSignature with different argument order for compatibility
 */
export async function signAndSendActivity(
  activity: any,
  inboxUrl: string,
  actorHandle: string,
  env: any
) {
  return postWithSignature(env, actorHandle, inboxUrl, activity);
}

async function resolveInbox(recipient: string, env: any): Promise<string | null> {
  // Skip the special Public collection
  if (recipient === "https://www.w3.org/ns/activitystreams#Public") {
    return null;
  }

  const decision = applyFederationPolicy(recipient, resolvePolicy(env));
  if (!decision.allowed) {
    console.warn(
      `[delivery] skipping blocked recipient ${recipient} (${decision.hostname ?? "unknown host"})`,
    );
    return null;
  }

  // If it's already an inbox URL, use it
  if (recipient.endsWith("/inbox")) {
    return recipient;
  }

  // If it's a followers/following collection, skip direct delivery
  // (these should be expanded elsewhere)
  if (recipient.includes("/followers") || recipient.includes("/following")) {
    console.log(`Skipping collection URL for direct delivery: ${recipient}`);
    return null;
  }

  // Otherwise, fetch the actor and get their inbox
  try {
    const { getOrFetchActor } = await import("./actor-fetch");
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

export async function deliverActivity(env: any, activity: any) {
  const availability = getActivityPubAvailability(env);
  if (!availability.enabled) {
    console.warn(
      `[ActivityPub] deliverActivity skipped in ${availability.context} context: ${availability.reason}`,
    );
    return;
  }

  const toList = (value: unknown): string[] => {
    if (Array.isArray(value)) return value.filter((v) => typeof v === "string") as string[];
    if (typeof value === "string") return [value];
    return [];
  };
  const object = activity?.object ?? {};
  const allRecipients = [
    ...toList(activity.to),
    ...toList(object.to),
    ...toList(activity.cc),
    ...toList(object.cc),
    ...toList(activity.bto),
    ...toList(object.bto),
    ...toList(activity.bcc),
    ...toList(object.bcc),
  ];
  const uniqueRecipients = Array.from(
    new Set(allRecipients.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)),
  );

  for (const recipient of uniqueRecipients) {
    try {
      const inbox = await resolveInbox(recipient, env);
      if (!inbox) {
        continue; // Skip Public collection and unresolvable recipients
      }

      const handle = new URL(activity.actor).hostname.split(".")[0];
      await postWithSignature(env, handle, inbox, activity);
    } catch (error) {
      console.error(`Failed to deliver activity to ${recipient}:`, error);
    }
  }
}
