import { makeData } from "../server/data-factory";
import { getActivityPubAvailability } from "../server/context";
import { requireInstanceDomain, parseActorUri } from "../subdomain";
import { queueImmediateDelivery } from "../utils/utils";
import { getOrFetchActor } from "./actor-fetch";
import { applyFederationPolicy, buildActivityPubPolicy } from "./federation-policy";

const PUBLIC_AUDIENCE = "https://www.w3.org/ns/activitystreams#Public";

const resolvePolicy = (env: any) =>
  buildActivityPubPolicy({
    env,
    config: (env as any)?.takosConfig?.activitypub ?? (env as any)?.activitypub ?? null,
  });

const toList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string") as string[];
  if (typeof value === "string") return [value];
  return [];
};

async function resolveRecipientInbox(recipient: string, env: any): Promise<string | null> {
  if (!recipient) return null;
  if (recipient === PUBLIC_AUDIENCE) return null;

  const decision = applyFederationPolicy(recipient, resolvePolicy(env));
  if (!decision.allowed) {
    console.warn(
      `[delivery] skipping blocked recipient ${recipient} (${decision.hostname ?? "unknown host"})`,
    );
    return null;
  }

  if (recipient.endsWith("/inbox")) {
    return recipient;
  }

  if (recipient.includes("/followers") || recipient.includes("/following")) {
    return null;
  }

  try {
    const actor = await getOrFetchActor(recipient, env);
    if (!actor) return null;
    return actor.endpoints?.sharedInbox || actor.inbox || null;
  } catch (error) {
    console.error(`Error resolving inbox for ${recipient}:`, error);
    return `${recipient}/inbox`;
  }
}

export async function enqueueActivity(env: any, activity: any) {
  const availability = getActivityPubAvailability(env ?? {});
  if (!availability.enabled) {
    console.warn(
      `[ActivityPub] outbox enqueue skipped in ${availability.context} context: ${availability.reason}`,
    );
    return;
  }

  const store = makeData(env);
  try {
    const instanceDomain = requireInstanceDomain(env);
    const actorUri = typeof activity.actor === "string" ? activity.actor : activity.actor?.id;
    const actorHandle =
      actorUri ? (parseActorUri(actorUri, instanceDomain)?.handle ?? actorUri) : undefined;
    const activityId = activity.id || crypto.randomUUID();
    const activityJson = JSON.stringify({ ...activity, id: activityId });

    if (store.upsertApOutboxActivity) {
      await store.upsertApOutboxActivity({
        local_user_id: actorHandle,
        local_actor_id: actorHandle,
        activity_id: activityId,
        activity_type: activity.type ?? "Create",
        activity_json: activityJson,
        object_id: typeof activity.object === "string" ? activity.object : activity.object?.id ?? null,
        object_type: activity.object?.type ?? null,
        created_at: new Date(),
      });
    }

    const objectRecipients = activity?.object ?? {};
    const recipients = Array.from(
      new Set(
        [
          ...toList(activity.to),
          ...toList(objectRecipients.to),
          ...toList(activity.cc),
          ...toList(objectRecipients.cc),
          ...toList(activity.bto),
          ...toList(objectRecipients.bto),
          ...toList(activity.bcc),
          ...toList(objectRecipients.bcc),
        ].filter(Boolean),
      ),
    );

    const inboxes = new Set<string>();
    for (const recipient of recipients) {
      const inbox = await resolveRecipientInbox(recipient, env);
      if (inbox) inboxes.add(inbox);
    }

    for (const inbox of inboxes) {
      await queueImmediateDelivery(store as any, env, {
        activity_id: activityId,
        target_inbox_url: inbox,
      });
    }
  } finally {
    await store.disconnect?.();
  }
}
