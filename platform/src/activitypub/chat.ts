import { makeData } from "../server/data-factory";
import { ACTIVITYSTREAMS_CONTEXT, TAKOS_CONTEXT } from "./activitypub";
import { getActorUri, requireInstanceDomain } from "../subdomain";
import { deliverActivity } from "./delivery";

export function canonicalizeParticipants(participants: string[]): string[] {
  return participants.map((uri) => uri.trim()).filter(Boolean).sort();
}

export function computeParticipantsHash(participants: string[]): string {
  return canonicalizeParticipants(participants).join("#");
}

async function upsertThread(env: any, participants: string[]) {
  const store = makeData(env);
  const hash = computeParticipantsHash(participants);
  const participantsJson = JSON.stringify(participants);
  try {
    const thread = await store.upsertDmThread(hash, participantsJson);
    return { threadId: thread.id, hash };
  } finally {
    await store.disconnect?.();
  }
}

export async function handleIncomingDm(env: any, activity: any) {
  const participants = canonicalizeParticipants([
    activity.actor,
    ...(activity.to || []),
    ...(activity.cc || []),
  ]);
  if (participants.length < 2) return;
  const { threadId } = await upsertThread(env, participants);
  const store = makeData(env);
  try {
    await store.createDmMessage(threadId, activity.actor, activity.object?.content || "", activity);
  } finally {
    await store.disconnect?.();
  }
}

export async function handleIncomingChannelMessage(env: any, activity: any) {
  const object = activity.object;
  const channelUri = object?.channel;
  if (!channelUri) return;
  const parts = channelUri.split("/ap/channels/")[1]?.split("/") || [];
  if (parts.length < 2) return;
  const [communityId, channelId] = parts;
  const store = makeData(env);
  try {
    await store.createChannelMessageRecord(
      communityId,
      channelId,
      activity.actor,
      object.content || "",
      activity,
    );
  } finally {
    await store.disconnect?.();
  }
}

function buildDirectMessageActivity(
  actor: string,
  recipients: string[],
  contentHtml: string,
  threadUri: string,
  inReplyTo?: string,
) {
  const now = new Date().toISOString();
  return {
    "@context": [ACTIVITYSTREAMS_CONTEXT, TAKOS_CONTEXT],
    type: "Create",
    actor,
    to: recipients,
    cc: [actor],
    published: now,
    object: {
      type: ["DirectMessage", "Note"], // Fallback to Note for compatibility
      id: `${threadUri}/${crypto.randomUUID()}`,
      content: contentHtml,
      thread: threadUri,
      inReplyTo: inReplyTo || null,
      published: now,
    },
  };
}

function buildChannelMessageActivity(
  actor: string,
  channelUri: string,
  contentHtml: string,
  inReplyTo?: string,
) {
  const now = new Date().toISOString();
  return {
    "@context": [ACTIVITYSTREAMS_CONTEXT, TAKOS_CONTEXT],
    type: "Create",
    actor,
    to: [channelUri],
    cc: [] as string[],
    published: now,
    object: {
      type: ["ChannelMessage", "Note"], // Fallback to Note for compatibility
      id: `${channelUri}/messages/${crypto.randomUUID()}`,
      content: contentHtml,
      channel: channelUri,
      inReplyTo: inReplyTo || null,
      published: now,
    },
  };
}

export async function sendDirectMessage(
  env: any,
  localHandle: string,
  recipients: string[],
  contentHtml: string,
  inReplyTo?: string,
) {
  const instanceDomain = requireInstanceDomain(env);
  const actorUri = getActorUri(localHandle, instanceDomain);
  const participants = canonicalizeParticipants([actorUri, ...recipients]);
  const { threadId } = await upsertThread(env, participants);
  const threadUri = `https://${instanceDomain}/ap/dm/${threadId}`;
  const activity = buildDirectMessageActivity(actorUri, recipients, contentHtml, threadUri, inReplyTo);
  await deliverActivity(env, activity);
  const store = makeData(env);
  try {
    await store.createDmMessage(threadId, actorUri, contentHtml, activity);
  } finally {
    await store.disconnect?.();
  }
  return { threadId, activity };
}

export async function sendChannelMessage(
  env: any,
  localHandle: string,
  communityId: string,
  channelId: string,
  recipients: string[],
  contentHtml: string,
  inReplyTo?: string,
) {
  const instanceDomain = requireInstanceDomain(env);
  const actorUri = getActorUri(localHandle, instanceDomain);
  const channelUri = `https://${instanceDomain}/ap/channels/${communityId}/${channelId}`;
  const activity = buildChannelMessageActivity(actorUri, channelUri, contentHtml, inReplyTo);
  if (recipients.length) activity.cc = recipients;
  await deliverActivity(env, activity);
  const store = makeData(env);
  try {
    await store.createChannelMessageRecord(
      communityId,
      channelId,
      actorUri,
      contentHtml,
      activity,
    );
  } finally {
    await store.disconnect?.();
  }
  return { activity };
}

export async function getDmThreadMessages(env: any, threadId: string, limit = 50) {
  const store = makeData(env);
  try {
    return store.listDmMessages(threadId, limit);
  } finally {
    await store.disconnect?.();
  }
}

export async function getChannelMessages(env: any, communityId: string, channelId: string, limit = 50) {
  const store = makeData(env);
  try {
    return store.listChannelMessages(communityId, channelId, limit);
  } finally {
    await store.disconnect?.();
  }
}

export async function fetchDmThreadByHandle(
  env: any,
  localHandle: string,
  otherHandle: string,
  limit = 50,
) {
  const protocol = "https";
  const instanceDomain = requireInstanceDomain(env);
  const localActor = getActorUri(localHandle, instanceDomain, protocol);
  const otherActor = getActorUri(otherHandle, instanceDomain, protocol);
  const participants = canonicalizeParticipants([localActor, otherActor]);
  const { threadId } = await upsertThread(env, participants);
  const store = makeData(env);
  try {
    const messages = await store.listDmMessages(threadId, limit);
    return { threadId, messages };
  } finally {
    await store.disconnect?.();
  }
}
