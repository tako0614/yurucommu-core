import type { Actor } from "../types.ts";

interface StoryData {
  apId: string;
  attributedTo: string;
  attachment: {
    type: string;
    mediaType: string;
    url: string;
    r2_key: string;
  };
  displayDuration: string;
  // Optional caption/text shown over the story. Federated to remote instances
  // as the AS2 Note `content` so they can render the same caption locally.
  caption?: string;
  overlays?: unknown[];
  endTime: string;
  published: string;
}

/**
 * Safely join a base URL and a path segment.
 * Returns the path unchanged if it is already an absolute URL.
 */
export function safeUrlJoin(baseUrl: string, path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  const cleanBase = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : "/" + path;

  try {
    const base = new URL(cleanBase);
    return base.origin + base.pathname.replace(/\/+$/, "") + normalizedPath;
  } catch {
    return cleanBase + normalizedPath;
  }
}

/**
 * Map stored attachment rows to AP-standard `Document` attachments for every
 * federation egress point (the embedded object in an outbound Create, and the
 * served `/ap/objects/:id` document). The internal shape is
 * `{ url: "/media/<hash>", content_type, r2_key }`; a remote needs
 * `{ type: "Document", mediaType, url: <absolute> }`:
 *   - `url` is absolutized (a relative `/media/...` would resolve against the
 *     REMOTE's origin and 404);
 *   - `content_type` is renamed to `mediaType` — the AP/Mastodon field used to
 *     recognize and render the media (without it, the image may not display);
 *   - `type: "Document"` is added (the standard AP media-attachment type);
 *   - the internal `r2_key` (and any other non-AP field) is DROPPED so storage
 *     details never leak to remotes;
 *   - `name` (alt text) is preserved when present.
 * Attachments without a usable `url` are skipped.
 */
export function toApAttachments(
  attachments: unknown[],
  baseUrl: string,
): Array<Record<string, unknown>> {
  return attachments.flatMap((att) => {
    if (!att || typeof att !== "object" || Array.isArray(att)) return [];
    const a = att as Record<string, unknown>;
    const url = typeof a.url === "string" ? a.url : "";
    if (url.length === 0) return [];
    const mediaType =
      (typeof a.mediaType === "string" && a.mediaType) ||
      (typeof a.content_type === "string" && a.content_type) ||
      undefined;
    const name =
      typeof a.name === "string" && a.name.length > 0 ? a.name : undefined;
    return [
      {
        type: "Document",
        ...(mediaType ? { mediaType } : {}),
        url: safeUrlJoin(baseUrl, url),
        ...(name ? { name } : {}),
      },
    ];
  });
}

/**
 * Convert a Story to ActivityPub format
 */
export function storyToActivityPub(
  story: StoryData,
  actor: Actor,
  baseUrl: string,
): object {
  const attachmentUrl = safeUrlJoin(baseUrl, story.attachment.url);

  return {
    // Terms are inlined (not just a remote context URL) so plain AS2 consumers
    // need not dereference https://yurucommu.com/ns/story. This object MUST stay
    // byte-for-term identical to the published context at
    // site/ns/story/context.jsonld.
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      {
        story: "https://yurucommu.com/ns/story#",
        xsd: "http://www.w3.org/2001/XMLSchema#",
        Story: "story:Story",
        displayDuration: {
          "@id": "story:displayDuration",
          "@type": "xsd:duration",
        },
        overlays: { "@id": "story:overlays", "@container": "@list" },
        position: "story:position",
      },
    ],
    id: story.apId,
    type: ["Story", "Note"],
    attributedTo: actor.ap_id,
    published: story.published,
    endTime: story.endTime,
    to: [`${actor.ap_id}/followers`],
    // The story caption is the Note text; emit it so remote instances render
    // the same caption. Omitted entirely when there is no caption.
    ...(story.caption ? { content: story.caption } : {}),
    attachment: {
      type: story.attachment.type,
      mediaType: story.attachment.mediaType,
      url: attachmentUrl,
    },
    displayDuration: story.displayDuration,
    ...(story.overlays && story.overlays.length > 0
      ? { overlays: story.overlays }
      : {}),
  };
}
