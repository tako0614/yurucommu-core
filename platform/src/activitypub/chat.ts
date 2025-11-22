import { makeData } from "../server/data-factory";
import { ACTIVITYSTREAMS_CONTEXT } from "./activitypub";
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
  const channelUri = object?.context;
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
  const messageId = `${threadUri}/${crypto.randomUUID()}`;
  const object: any = {
    type: "Note",
    id: messageId,
    attributedTo: actor,
    content: contentHtml,
    context: threadUri, // 標準の context プロパティで会話をグループ化
    published: now,
    to: recipients,
    cc: [actor],
  };

  // Only include inReplyTo if it's a valid non-empty string
  if (typeof inReplyTo === 'string' && inReplyTo.trim()) {
    object.inReplyTo = inReplyTo.trim();
  }

  return {
    "@context": ACTIVITYSTREAMS_CONTEXT,
    type: "Create",
    actor,
    to: recipients,
    cc: [actor],
    published: now,
    object,
  };
}

function buildChannelMessageActivity(
  actor: string,
  channelUri: string,
  contentHtml: string,
  inReplyTo?: string,
) {
  const now = new Date().toISOString();
  const messageId = `${channelUri}/messages/${crypto.randomUUID()}`;
  const object: any = {
    type: "Note",
    id: messageId,
    attributedTo: actor,
    content: contentHtml,
    context: channelUri, // 標準の context プロパティでチャンネルを識別
    published: now,
    to: [channelUri],
  };

  // Only include inReplyTo if it's a valid non-empty string
  if (typeof inReplyTo === 'string' && inReplyTo.trim()) {
    object.inReplyTo = inReplyTo.trim();
  }

  return {
    "@context": ACTIVITYSTREAMS_CONTEXT,
    type: "Create",
    actor,
    to: [channelUri],
    cc: [] as string[],
    published: now,
    object,
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
    const messages = await store.listDmMessages(threadId, limit);
    // Return standard ActivityStreams Note objects
    return messages.map((msg: any) => {
      const note: any = {
        type: "Note",
        id: msg.id || `${msg.thread_id || threadId}/messages/${crypto.randomUUID()}`,
        attributedTo: msg.author_id,
        content: msg.content_html || "",
        published: msg.created_at || new Date().toISOString(),
        context: msg.thread_id || threadId,
      };

      // Only include inReplyTo if present
      if (msg.in_reply_to && typeof msg.in_reply_to === 'string' && msg.in_reply_to.trim()) {
        note.inReplyTo = msg.in_reply_to.trim();
      }

      return note;
    });
  } finally {
    await store.disconnect?.();
  }
}

export async function getChannelMessages(env: any, communityId: string, channelId: string, limit = 50) {
  const store = makeData(env);
  try {
    const baseChannelUri = `https://${requireInstanceDomain(env)}/ap/channels/${communityId}/${channelId}`;
    const rows = await store.listChannelMessages(communityId, channelId, limit);
    return rows.map((row: any) => {
      let parsed: any = null;
      try {
        parsed = row?.raw_activity_json ? JSON.parse(row.raw_activity_json) : null;
      } catch (e) {
        console.warn("Failed to parse channel raw_activity_json", e);
      }
      const candidate = parsed?.object ?? parsed ?? {};
      // 標準の context プロパティを優先、フォールバックとして channelId
      const channelUri = candidate.context || candidate.channelId || baseChannelUri;

      const note: any = {
        id: candidate.id || row.id || `${channelUri}/messages/${crypto.randomUUID()}`,
        type: "Note", // 標準の Note タイプ
        content: candidate.content ?? row.content_html ?? "",
        attributedTo: candidate.attributedTo ?? candidate.actor ?? row.author_id,
        context: channelUri,
        published: candidate.published ?? row.created_at ?? new Date().toISOString(),
      };

      // Only include inReplyTo if it's a valid non-empty string
      const inReplyTo = candidate.inReplyTo ?? candidate.in_reply_to ?? row.in_reply_to ?? null;
      if (typeof inReplyTo === 'string' && inReplyTo.trim()) {
        note.inReplyTo = inReplyTo.trim();
      }

      return note;
    });
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
