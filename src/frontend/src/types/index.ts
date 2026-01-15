// ===== Yurucommu AP-Native Types =====

// Actor represents a user (Person) in ActivityPub
export interface Actor {
  ap_id: string;  // Primary key: https://domain/ap/users/username
  username: string;  // Formatted: user@domain
  preferred_username: string;
  name: string | null;
  summary: string | null;
  icon_url: string | null;
  header_url: string | null;
  follower_count: number;
  following_count: number;
  post_count: number;
  is_private?: boolean;
  role?: 'owner' | 'moderator' | 'member';
  created_at: string;
  is_following?: boolean;
  is_followed_by?: boolean;
}

// Community (AP Group)
export interface Community {
  ap_id: string;
  preferred_username: string;
  name: string;
  summary: string | null;
  icon_url: string | null;
  visibility?: 'public' | 'private';
  member_count?: number;
  created_at: string;
}

// Media attachment
export interface MediaAttachment {
  r2_key: string;
  content_type: string;
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
  visibility: 'public' | 'unlisted' | 'followers' | 'direct';
  community_ap_id: string | null;
  like_count: number;
  reply_count: number;
  announce_count: number;
  published: string;
  liked: boolean;
  bookmarked: boolean;
}

// DM participant
export interface DMParticipant {
  ap_id: string;
  username: string;
  preferred_username: string;
  name: string | null;
  icon_url: string | null;
}

// DM conversation
export interface DMConversation {
  id: string;
  other_participant: DMParticipant;
  last_message_at: string | null;
  created_at: string;
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
  type: 'follow' | 'follow_request' | 'like' | 'announce' | 'reply' | 'mention';
  actor: NotificationActor;
  object_ap_id: string | null;
  read: boolean;
  created_at: string;
}

// Uploaded file
export interface UploadedFile {
  r2_key: string;
  content_type: string;
  filename: string;
  size: number;
  preview?: string;
}

// Story attachment (image or video)
export interface StoryAttachment {
  type: string;       // "Document" or "Video"
  mediaType: string;  // "image/jpeg", "video/mp4", etc.
  url: string;
  r2_key: string;
  width?: number;
  height?: number;
  duration?: string;  // For video: ISO 8601 duration
}

// Overlay position (relative coordinates 0.0-1.0)
export interface OverlayPosition {
  x: number;       // Center X (0=left, 1=right)
  y: number;       // Center Y (0=top, 1=bottom)
  width: number;   // Width relative to canvas
  height: number;  // Height relative to canvas
}

// Story overlay (any AS2 object with position)
export interface StoryOverlay {
  type: string;               // "Question", "Note", "Link", etc.
  position: OverlayPosition;
  // Question-specific
  name?: string;              // Question text
  oneOf?: Array<{ type: string; name: string }>;  // Options
  closed?: string;            // Close time
  // Generic
  [key: string]: unknown;     // Allow any AS2 properties
}

// Story (v2: 1 Story = 1 Media)
export interface Story {
  ap_id: string;
  author: PostAuthor;
  attachment: StoryAttachment;
  displayDuration: string;    // ISO 8601 duration (e.g., "PT5S")
  overlays?: StoryOverlay[];  // Optional interactive overlays
  published: string;
  end_time: string;
  viewed: boolean;
  // Poll/Question voting results
  votes?: { [key: number]: number };  // Index -> vote count
  votes_total?: number;               // Total vote count
  user_vote?: number;                 // Current user's vote index (if voted)
}

// Actor with stories grouped
export interface ActorStories {
  actor: PostAuthor;
  stories: Story[];
  has_unviewed: boolean;
}

// ===== Story Canvas Editor Types =====

// Base canvas element type
export interface CanvasElement {
  id: string;
  type: 'image' | 'text';
  x: number;      // Canvas X coordinate (0-1080)
  y: number;      // Canvas Y coordinate (0-1920)
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
}

// Image element on canvas
export interface ImageElement extends CanvasElement {
  type: 'image';
  r2_key: string;
  content_type: string;
  preview: string;      // blob URL for preview
  dominantColors: string[];  // Extracted dominant colors
}

// Text element on canvas
export interface TextElement extends CanvasElement {
  type: 'text';
  content: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  color: string;
  backgroundColor?: string;
}

// Union type for all canvas elements
export type StoryCanvasElement = ImageElement | TextElement;

// Editor state
export interface StoryEditorState {
  background: string;           // Background color/gradient
  elements: StoryCanvasElement[];
  selectedId: string | null;
  extractedColors: string[];    // Colors extracted from images
}
