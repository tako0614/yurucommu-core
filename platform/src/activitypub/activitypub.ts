/**
 * ActivityPub protocol implementation
 *
 * Handles Actor endpoints, WebFinger, Inbox/Outbox, and federated objects
 */

import type { Context } from "hono";
import { getActorUri, getObjectUri } from "../subdomain";

export type ActivityPubContext = string | string[] | Record<string, unknown>;

export const ACTIVITYSTREAMS_CONTEXT = "https://www.w3.org/ns/activitystreams";
export const SECURITY_CONTEXT = "https://w3id.org/security/v1";
export const TAKOS_CONTEXT = "https://docs.takos.jp/ns/activitypub/v1.jsonld";
export const LEMMY_CONTEXT = "https://join-lemmy.org/context.json";

/**
 * Generate ActivityPub Person object for a user
 */
export function generatePersonActor(
  user: any,
  instanceDomain: string,
  protocol: string = "https",
  publicKeyPem?: string,
) {
  const handle = (user?.handle || user?.id || "").toString();
  const actorUri = getActorUri(handle, instanceDomain, protocol);
  const baseUrl = `${protocol}://${instanceDomain}`;

  return {
    "@context": [ACTIVITYSTREAMS_CONTEXT, SECURITY_CONTEXT],
    type: "Person",
    id: actorUri,
    preferredUsername: handle,
    name: user.display_name || handle,
    summary: user.summary || "",
    url: `${baseUrl}/@${handle}`,
    inbox: `${baseUrl}/ap/users/${handle}/inbox`,
    outbox: `${baseUrl}/ap/users/${handle}/outbox`,
    followers: `${baseUrl}/ap/users/${handle}/followers`,
    following: `${baseUrl}/ap/users/${handle}/following`,
    icon: user.avatar_url
      ? {
        type: "Image",
        mediaType: "image/jpeg",
        url: user.avatar_url,
      }
      : undefined,
    publicKey: publicKeyPem
      ? {
        id: `${actorUri}#main-key`,
        owner: actorUri,
        publicKeyPem,
      }
      : undefined,
    // All accounts are private: not discoverable and require follower approval
    discoverable: false,
    manuallyApprovesFollowers: true,
  };
}

/**
 * Generate ActivityPub Group object for a community
 */
export function generateGroupActor(
  community: any,
  ownerHandle: string,
  instanceDomain: string,
  protocol: string = "https",
  publicKeyPem?: string,
) {
  const slug = community.id;
  const baseUrl = `${protocol}://${instanceDomain}`;
  const groupUri = `${baseUrl}/ap/groups/${slug}`;
  const sharedInbox = community.shared_inbox_url;

  return {
    // Lemmy の Group Actor 互換: 必須コンテキストを先頭に含める
    "@context": [LEMMY_CONTEXT, ACTIVITYSTREAMS_CONTEXT, SECURITY_CONTEXT],
    type: "Group",
    id: groupUri,
    preferredUsername: slug,
    name: community.name,
    summary: community.description || "",
    source: community.description
      ? {
        content: community.description,
        mediaType: "text/html",
      }
      : undefined,
    sensitive: Boolean(community.is_nsfw || community.sensitive),
    postingRestrictedToMods: Boolean(community.posting_restricted_to_mods),
    attributedTo: getActorUri(ownerHandle, instanceDomain, protocol),
    inbox: `${baseUrl}/ap/groups/${slug}/inbox`,
    outbox: `${baseUrl}/ap/groups/${slug}/outbox`,
    followers: `${baseUrl}/ap/groups/${slug}/followers`,
    featured: `${baseUrl}/ap/groups/${slug}/featured`,
    ...(sharedInbox
      ? {
        endpoints: {
          sharedInbox,
        },
      }
      : {}),
    icon: community.icon_url
      ? {
        type: "Image",
        mediaType: "image/jpeg",
        url: community.icon_url,
      }
      : undefined,
    image: community.banner_url
      ? {
        type: "Image",
        mediaType: "image/jpeg",
        url: community.banner_url,
      }
      : undefined,
    publicKey: publicKeyPem
      ? {
        id: `${groupUri}#main-key`,
        owner: groupUri,
        publicKeyPem,
      }
      : undefined,
    published: community.created_at ? new Date(community.created_at).toISOString() : undefined,
    updated: community.updated_at ? new Date(community.updated_at).toISOString() : undefined,
  };
}

/**
 * Generate ActivityPub Note object for a post
 */
export function generateNoteObject(
  post: any,
  author: any,
  instanceDomain: string,
  protocol: string = "https",
) {
  const baseUrl = `${protocol}://${instanceDomain}`;
  const actorValue =
    post?.actor ||
    post?.attributedTo ||
    post?.ap_attributed_to ||
    post?.author_id ||
    author?.handle ||
    author?.id;
  const actorHandle = typeof actorValue === "string" ? actorValue : "";
  const actorUri = actorHandle.startsWith("http")
    ? actorHandle
    : getActorUri(actorHandle, instanceDomain, protocol);

  const objectIdCandidate =
    post?.id ||
    post?.ap_object_id ||
    post?.local_id ||
    post?.object?.id ||
    post?.ap_activity_id;
  const objectId = typeof objectIdCandidate === "string" && objectIdCandidate.startsWith("http")
    ? objectIdCandidate
    : getObjectUri(
      actorHandle || objectIdCandidate || crypto.randomUUID(),
      (objectIdCandidate as string) || crypto.randomUUID(),
      instanceDomain,
      protocol,
    );

  const toArray = (value: unknown): string[] => {
    if (Array.isArray(value)) {
      return value.filter((v) => typeof v === "string") as string[];
    }
    if (typeof value === "string") return [value];
    return [];
  };

  const normalizeRecipient = (recipient: string): string => {
    if (!recipient) return recipient;
    if (/^https?:\/\//i.test(recipient)) return recipient;
    const trimmed = recipient.replace(/^\/+/, "");
    if (trimmed.startsWith("ap/")) return `${baseUrl}/${trimmed}`;
    if (trimmed.startsWith("users/") || trimmed.startsWith("groups/") || trimmed.startsWith("objects/")) {
      return `${baseUrl}/ap/${trimmed}`;
    }
    return `${baseUrl}/ap/${trimmed}`;
  };

  const initialTo = toArray(post?.to).map(normalizeRecipient);
  const initialCc = toArray(post?.cc).map(normalizeRecipient);

  const deriveRecipients = () => {
    if (initialTo.length || initialCc.length) {
      return { to: initialTo, cc: initialCc };
    }
    const visibility =
      post?.visibility ||
      (post?.broadcast_all ? "public" : post?.visible_to_friends ? "followers" : post?.community_id ? "community" : undefined);
    const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";
    const followers = `${actorUri}/followers`;
    switch (visibility) {
      case "unlisted":
        return { to: [followers], cc: [PUBLIC] };
      case "followers":
        return { to: [followers], cc: [] };
      case "community":
        if (post?.community_id) {
          return {
            to: [`${baseUrl}/ap/groups/${post.community_id}/followers`],
            cc: [`${baseUrl}/ap/groups/${post.community_id}`],
          };
        }
        return { to: [], cc: [] };
      case "direct":
        return { to: [], cc: [] };
      case "public":
      default:
        return { to: [PUBLIC], cc: [followers] };
    }
  };

  const recipients = deriveRecipients();

  const attachments: any[] = [];
  const mediaSources =
    Array.isArray(post?.attachment)
      ? post.attachment
      : post?.media_urls
        ? post.media_urls
        : (() => {
          if (typeof post?.media_json === "string") {
            try {
              return JSON.parse(post.media_json);
            } catch {
              return [];
            }
          }
          return [];
        })();

  if (Array.isArray(mediaSources)) {
    for (const item of mediaSources) {
      const url = typeof item === "string"
        ? item
        : (item && typeof item.url === "string" ? item.url : "");
      if (!url) continue;
      const description =
        item && typeof item === "object"
          ? (typeof item.description === "string"
              ? (item.description as string)
              : (typeof item.name === "string" ? (item.name as string) : undefined))
          : undefined;
      const sanitizedDescription = description ? description.slice(0, 1500) : undefined;

      const lowerUrl = url.toLowerCase();
      let mediaType = "application/octet-stream";
      if (lowerUrl.endsWith(".jpg") || lowerUrl.endsWith(".jpeg")) {
        mediaType = "image/jpeg";
      } else if (lowerUrl.endsWith(".png")) {
        mediaType = "image/png";
      } else if (lowerUrl.endsWith(".webp")) {
        mediaType = "image/webp";
      } else if (lowerUrl.endsWith(".gif")) {
        mediaType = "image/gif";
      } else if (lowerUrl.endsWith(".mp4")) {
        mediaType = "video/mp4";
      } else if (lowerUrl.endsWith(".webm")) {
        mediaType = "video/webm";
      }

      attachments.push({
        type: mediaType.startsWith("image") ? "Image" : "Video",
        mediaType,
        url,
        name: sanitizedDescription || undefined,
      });
    }
  }

  const tags: any[] = [];
  if (Array.isArray(post?.tag)) {
    tags.push(...post.tag);
  } else if (Array.isArray(post?.ap_tags)) {
    tags.push(...post.ap_tags);
  } else if (Array.isArray((post as any).hashtags)) {
    for (const tag of (post as any).hashtags) {
      if (typeof tag === "string" && tag.trim()) {
        tags.push({
          type: "Hashtag",
          href: `${baseUrl}/tags/${encodeURIComponent(tag.trim())}`,
          name: `#${tag.trim()}`,
        });
      }
    }
  }

  const rawContent =
    (typeof post?.content === "string" ? post.content : null) ??
    (typeof post?.text === "string" ? post.text : "") ??
    "";
  const content =
    typeof rawContent === "string" && /<[^>]+>/.test(rawContent)
      ? rawContent
      : escapeHtml(rawContent || "");
  const contentHtml = content
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => `<p>${line}</p>`)
    .join("") || content;

  const inReplyToValue =
    (typeof post?.inReplyTo === "string" && post.inReplyTo.trim() ? post.inReplyTo.trim() : null) ||
    (typeof post?.in_reply_to === "string" && post.in_reply_to.trim() ? post.in_reply_to.trim() : null) ||
    (typeof post?.in_reply_to_id === "string" ? post.in_reply_to_id : null);

  const note: any = {
    "@context": ACTIVITYSTREAMS_CONTEXT,
    type: "Note",
    id: objectId,
    actor: actorUri,
    attributedTo: actorUri,
    content: contentHtml || "",
    published: post?.published
      ? new Date(post.published).toISOString()
      : post?.created_at
        ? new Date(post.created_at).toISOString()
        : new Date().toISOString(),
    to: recipients.to,
    cc: recipients.cc,
    url: post?.url || objectId,
  };

  const summary = typeof post?.summary === "string" ? post.summary : post?.content_warning;
  if (summary) {
    note.summary = summary;
  }

  if (post?.sensitive !== undefined) {
    note.sensitive = Boolean(post.sensitive);
  } else if ((post as any)["takos:sensitive"] !== undefined) {
    note.sensitive = Boolean((post as any)["takos:sensitive"]);
  } else if (summary) {
    note.sensitive = true;
  }

  if (post?.context) {
    note.context = post.context;
  }

  if (tags.length) {
    note.tag = tags;
  }

  if (attachments.length > 0) {
    note.attachment = attachments;
  }

  if (inReplyToValue) {
    note.inReplyTo = inReplyToValue;
  }

  if (post?.attributedTo || post?.attributed_community_id) {
    const attributed = (post.attributedTo as string) ?? post.attributed_community_id;
    note.attributedTo = normalizeRecipient(attributed);
  }

  return note;
}

/**
 * Generate WebFinger response
 */
export function generateWebFinger(
  handle: string,
  instanceDomain: string,
  protocol: string = "https",
) {
  const actorUri = getActorUri(handle, instanceDomain, protocol);
  const subject = `acct:${handle}@${instanceDomain}`;
  const baseUrl = `${protocol}://${instanceDomain}`;

  return {
    subject,
    aliases: [
      `${baseUrl}/@${handle}`,
      actorUri,
    ],
    links: [
      {
        rel: "self",
        type: "application/activity+json",
        href: actorUri,
      },
      {
        rel: "http://webfinger.net/rel/profile-page",
        type: "text/html",
        href: `${baseUrl}/@${handle}`,
      },
    ],
  };
}

/**
 * Generate OrderedCollection for outbox/followers/following
 */
export function generateOrderedCollection(
  id: string,
  totalItems: number,
  firstPage?: string,
  lastPage?: string,
) {
  return {
    "@context": ACTIVITYSTREAMS_CONTEXT,
    type: "OrderedCollection",
    id,
    totalItems,
    first: firstPage || `${id}?page=1`,
    last: lastPage,
  };
}

/**
 * Generate OrderedCollectionPage
 */
export function generateOrderedCollectionPage(
  id: string,
  partOf: string,
  orderedItems: any[],
  totalItems?: number,
  startIndex?: number,
  next?: string,
  prev?: string,
) {
  const page: any = {
    "@context": ACTIVITYSTREAMS_CONTEXT,
    type: "OrderedCollectionPage",
    id,
    partOf,
    orderedItems,
  };

  // Include totalItems if provided (helpful for clients to know total count)
  if (typeof totalItems === 'number') {
    page.totalItems = totalItems;
  }

  // Include startIndex if provided (required for proper pagination)
  if (typeof startIndex === 'number') {
    page.startIndex = startIndex;
  }

  // Only include next/prev if they exist
  if (next) {
    page.next = next;
  }

  if (prev) {
    page.prev = prev;
  }

  return page;
}

/**
 * Check if request accepts ActivityPub JSON-LD
 */
export function isActivityPubRequest(c: Context): boolean {
  const accept = c.req.header("Accept") || "";
  return (
    accept.includes("application/activity+json") ||
    accept.includes("application/ld+json")
  );
}

/**
 * Send ActivityPub JSON response
 */
export function activityPubResponse(c: Context, data: any, status = 200) {
  return c.json(data, status as any, {
    "Content-Type": 'application/activity+json; charset=utf-8',
  });
}

/**
 * HTML escape for safe content rendering
 */
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Generate Create Activity wrapper
 */
export function wrapInCreateActivity(
  object: any,
  actorUri: string,
  activityId: string,
) {
  return {
    "@context": ACTIVITYSTREAMS_CONTEXT,
    type: "Create",
    id: activityId,
    actor: actorUri,
    object,
    published: object.published || new Date().toISOString(),
    to: object.to,
    cc: object.cc,
  };
}

/**
 * Generate Follow Activity
 */
export function generateFollowActivity(
  actorUri: string,
  targetUri: string,
  activityId: string,
) {
  return {
    "@context": ACTIVITYSTREAMS_CONTEXT,
    type: "Follow",
    id: activityId,
    actor: actorUri,
    object: targetUri,
    published: new Date().toISOString(),
  };
}

/**
 * Generate Accept Activity
 */
export function generateAcceptActivity(
  actorUri: string,
  followActivity: any,
  activityId: string,
) {
  return {
    "@context": ACTIVITYSTREAMS_CONTEXT,
    type: "Accept",
    id: activityId,
    actor: actorUri,
    object: followActivity,
  };
}

/**
 * Generate Like Activity
 */
export function generateLikeActivity(
  actorUri: string,
  objectUri: string,
  activityId: string,
  emoji?: string,
) {
  const activity: any = {
    "@context": ACTIVITYSTREAMS_CONTEXT,
    type: "Like",
    id: activityId,
    actor: actorUri,
    object: objectUri,
    published: new Date().toISOString(),
  };

  if (emoji && emoji !== "👍") {
    // Add emoji for Misskey compatibility
    activity.content = emoji;
  }

  return activity;
}
