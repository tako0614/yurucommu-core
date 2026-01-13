// ===== Community Types =====

// Community represents a group/community
export interface Community {
  id: string;
  name: string;
  description: string | null;
  icon_url: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// Alias for backward compatibility
export type Group = Community;

// Member represents a user
export interface Member {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  header_url: string | null;
  bio: string | null;
  is_remote: boolean;
  ap_actor_id: string | null;
  created_at: string;
}

// ===== Post Types =====

// Media attachment
export interface MediaAttachment {
  r2_key: string;
  content_type: string;
}

// Post represents a timeline post
export interface Post {
  id: string;
  member_id: string;
  community_id: string | null; // null = personal post, otherwise community post
  content: string;
  visibility: 'public' | 'unlisted' | 'followers';
  reply_to_id: string | null;
  like_count: number;
  repost_count: number;
  reply_count: number;
  media_json?: string; // JSON string of MediaAttachment[]
  created_at: string;
  updated_at: string;
  // Joined fields
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  // Current user's interaction state
  liked?: boolean;
  reposted?: boolean;
  bookmarked?: boolean;
}

// Like represents a like on a post
export interface Like {
  id: string;
  post_id: string;
  member_id: string;
  created_at: string;
}

// Repost represents a repost/boost of a post
export interface Repost {
  id: string;
  post_id: string;
  member_id: string;
  created_at: string;
}

// Follow represents a user-to-user follow relationship
export interface Follow {
  id: string;
  follower_id: string;
  following_id: string;
  status: 'pending' | 'accepted';
  created_at: string;
  accepted_at: string | null;
}

// MemberProfile extends Member with follow stats
export interface MemberProfile extends Member {
  follower_count: number;
  following_count: number;
  post_count: number;
  is_following?: boolean;
  is_followed_by?: boolean;
}


// ===== DM Types =====

// DMConversation represents a 1:1 conversation
export interface DMConversation {
  id: string;
  member1_id: string;
  member2_id: string;
  last_message_at: string | null;
  created_at: string;
  other_member: {
    id: string;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
  };
}

// DMMessage represents a direct message
export interface DMMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  // Joined fields
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

// ===== Notification Types =====

export interface Notification {
  id: string;
  member_id: string;
  actor_id: string;
  type: 'follow' | 'like' | 'repost' | 'mention' | 'reply' | 'join_request' | 'join_accepted' | 'invite';
  target_type: 'post' | 'group' | 'room' | 'message' | null;
  target_id: string | null;
  read: boolean;
  created_at: string;
  // Joined fields
  actor_username: string;
  actor_display_name: string | null;
  actor_avatar_url: string | null;
}

// ===== Utility Types =====

export interface UploadedFile {
  r2_key: string;
  content_type: string;
  filename: string;
  size: number;
  preview?: string;
}

// ===== API Response Types =====

export interface MemberWithRole extends Member {
  role: 'owner' | 'moderator' | 'member';
  membership_status?: 'pending' | 'accepted';
}

export interface GroupWithMembership extends Group {
  membership_status: 'pending' | 'accepted' | null;
  role: 'owner' | 'moderator' | 'member' | null;
}
