// Call signaling wire contract + browser<->hub frames (voice + video).
export * from "./call.ts";

// Realtime stream wire contract (per-user event feed + control frames).
export * from "./realtime.ts";

// ===== Yurucommu AP-Native Types =====

// Actor represents a user (Person) in ActivityPub
export interface Actor {
  ap_id: string; // Primary key: https://domain/ap/users/username
  username: string; // Formatted: user@domain
  preferred_username: string;
  name: string | null;
  summary: string | null;
  icon_url: string | null;
  header_url: string | null;
  follower_count: number;
  following_count: number;
  post_count: number;
  is_private?: boolean;
  role?: "owner" | "moderator" | "member";
  created_at: string;
  is_following?: boolean;
  is_followed_by?: boolean;
  // Structured PropertyValue profile fields (Mastodon-parity, capped at 4 on
  // the backend). Rendered as a small label/value list on the profile.
  fields?: { name: string; value: string }[];
  // Account-migration markers: `moved_to` is the AP id this account moved to,
  // `also_known_as` is the set of declared aliases. Migration *authoring* lives
  // in Settings; the profile only surfaces the moved-to banner.
  moved_to?: string | null;
  also_known_as?: string[];
}

// Community (AP Group)
export interface Community {
  ap_id: string;
  preferred_username: string;
  name: string;
  summary: string | null;
  icon_url: string | null;
  visibility?: "public" | "private";
  member_count?: number;
  created_at: string;
}

// Media attachment
export interface MediaAttachment {
  url?: string;
  r2_key: string;
  content_type: string;
  // ActivityPub-standard alt text for the attachment (`name` on a Document).
  name?: string;
}

// Post author info
export interface PostAuthor {
  ap_id: string;
  username: string;
  preferred_username: string;
  name: string | null;
  icon_url: string | null;
}

// Post (AP Note)
export interface Post {
  ap_id: string;
  type: string;
  author: PostAuthor;
  content: string;
  summary: string | null;
  attachments: MediaAttachment[];
  in_reply_to: string | null;
  visibility: "public" | "unlisted" | "followers" | "direct";
  community_ap_id: string | null;
  like_count: number;
  reply_count: number;
  announce_count: number;
  published: string;
  // Set to the post's `updated` timestamp when it has been edited (else null).
  edited_at: string | null;
  liked: boolean;
  bookmarked: boolean;
  reposted: boolean;
}

// DM participant
export interface DMParticipant {
  ap_id: string;
  username: string;
  preferred_username: string;
  name: string | null;
  icon_url: string | null;
}

// DM message sender
export interface DMSender {
  ap_id: string;
  username: string;
  preferred_username: string;
  name: string | null;
  icon_url: string | null;
}

// DM message
export interface DMMessage {
  id: string;
  sender: DMSender;
  content: string;
  /** Media attachments (image/video), same shape as post attachments. */
  attachments?: MediaAttachment[];
  created_at: string;
}

// Notification actor
export interface NotificationActor {
  ap_id: string;
  username: string;
  preferred_username: string;
  name: string | null;
  icon_url: string | null;
}

// Notification
export interface Notification {
  id: string;
  type: "follow" | "follow_request" | "like" | "announce" | "reply" | "mention";
  actor: NotificationActor;
  object_ap_id: string | null;
  /**
   * Navigation target for the notification. OPTIONAL: a server older than
   * 3.2.0 omits these fields, and `normalizeNotification` then synthesizes them
   * from `object_ap_id`. Prefer `target_kind` + `target_id` and build your own
   * in-app path; `target_url` is shaped for the yurucommu web client's routing
   * and is same-origin only — never treat it as an external URL.
   */
  target_kind?: NotificationTargetKind;
  target_id?: string | null;
  target_url?: string;
  read: boolean;
  created_at: string;
}

export type NotificationTargetKind =
  "post" | "story" | "profile" | "notifications";

export type NotificationPusherProduct = "yurucommu" | "yurume";

export interface NotificationPusherInput {
  kind: "http";
  app_id: string;
  pushkey: string;
  app_display_name?: string;
  device_display_name?: string;
  profile_tag?: string;
  lang?: string;
  data: {
    url: string;
    format?: "event_id_only" | "full";
    [key: string]: unknown;
  };
}

export interface NotificationPusherRegistration {
  id: string;
  kind: "http";
  app_id: string;
  app_display_name?: string;
  device_display_name?: string;
  profile_tag?: string;
  lang?: string;
  data: Record<string, unknown>;
  gateway_url: string;
  product: NotificationPusherProduct;
  scope: string | null;
  registered_at: string;
  last_seen_at: string;
}

// Story attachment (image or video)
export interface StoryAttachment {
  type: string; // "Document" or "Video"
  mediaType: string; // "image/jpeg", "video/mp4", etc.
  url: string;
  r2_key: string;
  width?: number;
  height?: number;
  duration?: string; // For video: ISO 8601 duration
}

// Overlay position (relative coordinates 0.0-1.0)
export interface OverlayPosition {
  x: number; // Center X (0=left, 1=right)
  y: number; // Center Y (0=top, 1=bottom)
  width: number; // Width relative to canvas
  height: number; // Height relative to canvas
}

// Story overlay (any AS2 object with position)
export interface StoryOverlay {
  type: string; // "Question", "Note", "Link", etc.
  position: OverlayPosition;
  // Question-specific
  name?: string; // Question text
  oneOf?: Array<{ type: string; name: string }>; // Options
  // Link-specific
  href?: string;
  // Generic
  [key: string]: unknown; // Allow any AS2 properties
}

// Story (v2: 1 Story = 1 Media)
export interface Story {
  ap_id: string;
  author: PostAuthor;
  attachment: StoryAttachment;
  caption?: string; // Optional caption/text shown over the story
  displayDuration: string; // ISO 8601 duration (e.g., "PT5S")
  overlays?: StoryOverlay[]; // Optional interactive overlays
  published: string;
  end_time: string;
  viewed: boolean;
  like_count?: number;
  share_count?: number;
  liked?: boolean;
  // Poll/Question voting results
  votes?: { [key: number]: number }; // Index -> vote count
  votes_total?: number; // Total vote count
  user_vote?: number; // Current user's vote index (if voted)
}

// Actor with stories grouped
export interface ActorStories {
  actor: PostAuthor;
  stories: Story[];
  has_unviewed: boolean;
}

// A single viewer in a story's "seen by" list (author-only).
export interface StoryViewer {
  actor: PostAuthor;
  viewed_at: string;
}

// Response of GET /api/stories/:id/views (author-only "seen by").
export interface StoryViewersResponse {
  view_count: number;
  viewers: StoryViewer[];
}

// Short-lived actor status note. This is the Instagram-Notes-style current
// status surface, not the ActivityPub `Note` object used for normal posts.
export interface ActorNote {
  actor: PostAuthor;
  content: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
  is_mine: boolean;
}
