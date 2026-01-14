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
