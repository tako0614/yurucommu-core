import { makeData } from "../server/data-factory";
import { ensureUserKeyPair } from "../auth/crypto-keys";
import { signRequest } from "../auth/http-signature";

async function postWithSignature(env: any, actorHandle: string, inboxUrl: string, activity: any) {
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

async function resolveInbox(recipient: string, env: any): Promise<string | null> {
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
  const allRecipients = [
    ...(activity.to || []),
    ...(activity.cc || []),
    ...(activity.bcc || []),
  ];
  const uniqueRecipients = Array.from(new Set(allRecipients)).filter(Boolean);

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
