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
) {
  const handle = user.id;
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
    publicKey: {
      id: `${actorUri}#main-key`,
      owner: actorUri,
      publicKeyPem: "", // Will be filled from ap_keypairs table
    },
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
  const handle = author.id;
  const objectId = post.ap_object_id ||
    getObjectUri(handle, post.id, instanceDomain, protocol);
  const actorUri = getActorUri(handle, instanceDomain, protocol);
  const baseUrl = `${protocol}://${instanceDomain}`;

  // Determine audience
  const to: string[] = [];
  const cc: string[] = [];

  if (post.broadcast_all) {
    // Public post
    to.push("https://www.w3.org/ns/activitystreams#Public");
    if (post.visible_to_friends) {
      // Include followers in CC
      cc.push(`${baseUrl}/ap/users/${handle}/followers`);
    }
  } else if (post.visible_to_friends) {
    // Followers-only
    to.push(`${baseUrl}/ap/users/${handle}/followers`);
  } else if (post.community_id) {
    // Community-only (Group members)
    const communityFollowers = `${baseUrl}/ap/groups/${post.community_id}/followers`;
    to.push(communityFollowers);
    cc.push(`${baseUrl}/ap/groups/${post.community_id}`);
  }

  // Parse media attachments
  const attachments: any[] = [];
  try {
    const mediaUrls = JSON.parse(post.media_json || "[]");
    for (const url of mediaUrls) {
      if (typeof url === "string" && url.trim()) {
        // Infer media type from URL
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
        });
      }
    }
  } catch (error) {
    console.error("Failed to parse media_json:", error);
  }

  // Convert text to HTML-safe content
  const content = escapeHtml(post.text || "");
  const contentHtml = content
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => `<p>${line}</p>`)
    .join("");

  // Validate inReplyTo: only include if it's a non-empty string
  const inReplyToValue = typeof post.in_reply_to === 'string' && post.in_reply_to.trim()
    ? post.in_reply_to.trim()
    : null;

  const note: any = {
    "@context": ACTIVITYSTREAMS_CONTEXT,
    type: "Note",
    id: objectId,
    attributedTo: actorUri,
    content: contentHtml || "",
    published: new Date(post.created_at).toISOString(),
    to,
    cc,
    url: `${baseUrl}/posts/${post.id}`,
  };

  // Only include optional fields if they have values
  if (attachments.length > 0) {
    note.attachment = attachments;
  }

  if (inReplyToValue) {
    note.inReplyTo = inReplyToValue;
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
  next?: string,
  prev?: string,
) {
  return {
    "@context": ACTIVITYSTREAMS_CONTEXT,
    type: "OrderedCollectionPage",
    id,
    partOf,
    orderedItems,
    next,
    prev,
  };
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
