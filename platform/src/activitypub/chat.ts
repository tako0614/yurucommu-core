import { makeData } from "../server/data-factory";
import { ACTIVITYSTREAMS_CONTEXT } from "./activitypub";
import { getActorUri, requireInstanceDomain } from "../subdomain";
import { deliverActivity } from "./delivery";
import { createObjectService } from "../app/services/object-service";
import { HttpError } from "../utils/response-helpers";
import { sanitizeHtml } from "../utils/sanitize";
import { enqueueActivity } from "./outbox";
import { applyFederationPolicy, buildActivityPubPolicy } from "./federation-policy";

export function canonicalizeParticipants(participants: string[]): string[] {
  return participants.map((uri) => uri.trim()).filter(Boolean).sort();
}

export function computeParticipantsHash(participants: string[]): string {
  return canonicalizeParticipants(participants).join("#");
}

const PUBLIC_AUDIENCE = "https://www.w3.org/ns/activitystreams#Public";
const toList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map((v) => v?.toString?.() ?? "").filter(Boolean);
  if (typeof value === "string") return [value];
  if (value === null || value === undefined) return [];
  return [String(value)];
};

const resolvePolicy = (env: any) =>
  buildActivityPubPolicy({
    env,
    config: (env as any)?.takosConfig?.activitypub ?? (env as any)?.activitypub ?? null,
  });

const filterAudience = (recipients: string[]): string[] =>
  canonicalizeParticipants(
    Array.from(
      new Set(
        recipients
          .map((uri) => uri?.toString?.().trim?.() ?? "")
          .filter(
            (uri) =>
              uri &&
              uri !== PUBLIC_AUDIENCE &&
              !uri.endsWith("/followers") &&
              !uri.endsWith("/following"),
          ),
      ),
    ),
  );

const normalizeDmAudience = (activity: any, object: any) => {
  const to = filterAudience(toList(object?.to ?? activity?.to));
  const cc = filterAudience(toList(object?.cc ?? activity?.cc));
  const bto = filterAudience(toList(object?.bto ?? activity?.bto));
  const bcc = filterAudience(toList(object?.bcc ?? activity?.bcc));
  return {
    to,
    cc,
    bto,
    bcc,
    all: canonicalizeParticipants([...to, ...cc, ...bto, ...bcc]),
  };
};

const buildThreadUri = (instanceDomain: string, threadId: string): string =>
  `https://${instanceDomain}/ap/dm/${threadId}`;

export async function handleIncomingDm(env: any, activity: any) {
  const object = activity?.object ?? activity;
  const actor = typeof activity?.actor === "string" ? activity.actor : activity?.actor?.id;
  if (!actor) return;

  const audience = normalizeDmAudience(activity, object);
  if (!audience.all.length) return;

  const participants = canonicalizeParticipants([actor, ...audience.all]);
  if (participants.length < 2) return;

  const instanceDomain = requireInstanceDomain(env);
  const threadId = computeParticipantsHash(participants);
  const threadUri = buildThreadUri(instanceDomain, threadId);
  const remoteContext = typeof object?.context === "string" ? object.context : null;
  const context = threadId;
  const published =
    (typeof object?.published === "string" && object.published) ||
    (typeof activity?.published === "string" && activity.published) ||
    new Date().toISOString();
  const noteId =
    (typeof object?.id === "string" && object.id) ||
    (typeof activity?.id === "string" && activity.id) ||
    `${threadUri}/messages/${crypto.randomUUID()}`;
  const inReplyTo =
    typeof object?.inReplyTo === "string" && object.inReplyTo.trim()
      ? object.inReplyTo.trim()
      : undefined;

  const payload = {
    ...object,
    id: noteId,
    actor,
    to: audience.to,
    cc: audience.cc,
    bto: audience.bto,
    bcc: audience.bcc,
    content:
      typeof object?.content === "string"
        ? sanitizeHtml(object.content)
        : object?.content ?? "",
    context,
    published,
    inReplyTo,
    visibility: "direct",
    "takos:participants": participants,
    "takos:remoteContext": remoteContext ?? undefined,
  } as any;

  const objects = createObjectService(env);
  await objects.receiveRemote({ userId: null } as any, payload);
}

export async function handleIncomingChannelMessage(env: any, activity: any) {
  const object = activity.object;
  const channelUri = object?.context;
  if (!channelUri) return;
  const parts = channelUri.split("/ap/channels/")[1]?.split("/") || [];
  if (parts.length < 2) return;
  const [communityId, channelName] = parts;
  const store = makeData(env);
  try {
    // Resolve channel name to ID
    let channel;
    if (store.getChannelByName) {
      channel = await store.getChannelByName(communityId, channelName);
    } else {
      const channels = await store.listChannelsByCommunity(communityId);
      channel = channels.find((c: any) => c.name === channelName);
    }

    if (!channel) {
      console.warn(`Channel not found: ${communityId}/${channelName}`);
      return;
    }
    
    await store.createChannelMessageRecord(
      communityId,
      channel.id,
      activity.actor,
      object.content || "",
      activity,
    );
  } finally {
    await store.disconnect?.();
  }
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
  const normalizedRecipients = Array.from(
    new Set(filterAudience(recipients).filter((recipient) => recipient !== actorUri)),
  );
  const allowedRecipients = normalizedRecipients.filter((recipient) => {
    const decision = applyFederationPolicy(recipient, resolvePolicy(env));
    if (!decision.allowed) {
      console.warn(
        `[federation] DM recipient ${recipient} denied (${decision.reason ?? "blocked"})`,
      );
      return false;
    }
    return true;
  });

  const participants = canonicalizeParticipants([actorUri, ...allowedRecipients]);
  if (participants.length < 2) {
    throw new HttpError(400, "INVALID_PARTICIPANTS", "At least one recipient is required");
  }
  const threadId = computeParticipantsHash(participants);
  const targetRecipients = participants.filter((p) => p !== actorUri);
  if (!targetRecipients.length) {
    throw new HttpError(400, "INVALID_PARTICIPANTS", "Cannot create DM with only yourself");
  }

  const objects = createObjectService(env);
  const apObject = await objects.create({ userId: actorUri } as any, {
    type: "Note",
    content: contentHtml,
    visibility: "direct",
    to: targetRecipients,
    cc: [actorUri],
    bto: [],
    bcc: [],
    inReplyTo: typeof inReplyTo === "string" && inReplyTo.trim() ? inReplyTo.trim() : null,
    context: threadId,
    "takos:participants": participants,
  } as any);

  const activity = {
    "@context": ACTIVITYSTREAMS_CONTEXT,
    type: "Create",
    actor: actorUri,
    to: targetRecipients,
    cc: [actorUri] as string[],
    object: apObject,
  };

  await enqueueActivity(env, activity);
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
  
  // Get channel name for the URI
  const store = makeData(env);
  let channelName = channelId; // fallback to ID if channel not found
  try {
    const channel = await store.getChannel(communityId, channelId);
    if (channel) {
      channelName = channel.name;
    }
  } catch (e) {
    console.warn(`Failed to get channel name for ${channelId}`, e);
  }
  
  const channelUri = `https://${instanceDomain}/ap/channels/${communityId}/${channelName}`;
  const activity = buildChannelMessageActivity(actorUri, channelUri, contentHtml, inReplyTo);
  if (recipients.length) activity.cc = recipients;
  await deliverActivity(env, activity);
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

const resolveThreadContexts = (env: any, threadId: string): string[] => {
  const contexts = new Set<string>();
  if (threadId) contexts.add(threadId);
  try {
    const instanceDomain = requireInstanceDomain(env);
    if (threadId.includes("/ap/dm/")) {
      const hash = threadId.split("/ap/dm/")[1];
      if (hash) contexts.add(hash);
    } else {
      contexts.add(buildThreadUri(instanceDomain, threadId));
    }
  } catch {
    // ignore domain resolution issues for thread lookup
  }
  return Array.from(contexts);
};

const loadThreadObjects = async (env: any, contexts: string[]) => {
  const objects = createObjectService(env);
  const seen = new Set<string>();
  const collected: any[] = [];

  for (const context of contexts) {
    const items = await objects.getThread({ userId: null } as any, context).catch(() => []);
    for (const obj of items) {
      const key = (obj as any)?.id ?? `${context}#${collected.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(obj);
    }
  }

  return collected.sort((a, b) =>
    (a?.published ?? "").localeCompare(b?.published ?? ""),
  );
};

export async function getDmThreadMessages(env: any, threadId: string, limit = 50) {
  const contexts = resolveThreadContexts(env, threadId);
  const messages = await loadThreadObjects(env, contexts);
  const slice = limit ? messages.slice(-limit) : messages;
  return slice.map((obj: any) => {
    const note: any = {
      type: "Note",
      id: obj.id || `${threadId}/messages/${crypto.randomUUID()}`,
      attributedTo: obj.actor,
      content: obj.content || "",
      published: obj.published || new Date().toISOString(),
      context: obj.context || threadId,
    };

    const inReplyTo = obj.inReplyTo ?? (obj as any).in_reply_to;
    if (typeof inReplyTo === "string" && inReplyTo.trim()) {
      note.inReplyTo = inReplyTo.trim();
    }

    return note;
  });
}

export async function getChannelMessages(env: any, communityId: string, channelNameOrId: string, limit = 50) {
  const store = makeData(env);
  try {
    // Resolve channel name to channel ID if necessary
    let channelId = channelNameOrId;
    let channelName = channelNameOrId;
    
    // If it looks like a UUID, try to get the channel name
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(channelNameOrId)) {
      // It's a UUID, get the channel to find its name
      const channel = await store.getChannel(communityId, channelNameOrId);
      if (channel) {
        channelName = channel.name;
      }
    } else {
      // It's a name, get the channel to find its ID
      let channel;
      if (store.getChannelByName) {
        channel = await store.getChannelByName(communityId, channelNameOrId);
      } else {
        // Fallback: list all channels and find by name
        const channels = await store.listChannelsByCommunity(communityId);
        channel = channels.find((c: any) => c.name === channelNameOrId);
      }
      
      if (!channel) {
        // Channel not found
        return [];
      }
      channelId = channel.id;
      channelName = channel.name;
    }
    
    const baseChannelUri = `https://${requireInstanceDomain(env)}/ap/channels/${communityId}/${channelName}`;
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
  const threadId = computeParticipantsHash(participants);
  const contexts = resolveThreadContexts(env, threadId);
  const messages = await loadThreadObjects(env, contexts);
  return { threadId, messages: limit ? messages.slice(-limit) : messages };
}
