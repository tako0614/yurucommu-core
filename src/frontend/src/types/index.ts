// ===== APC (ActivityPub Communities) Types =====
// Based on apc-spec.md v0.3

// Group represents a community (AS2 Group Actor)
export interface Group {
  id: string;
  name: string;
  summary: string | null;
  icon_url: string | null;
  header_url: string | null;
  visibility: 'public' | 'unlisted' | 'confidential';
  join_policy: 'open' | 'inviteOnly' | 'moderated';
  posting_policy: 'members' | 'mods' | 'owners';
  member_count: number;
  room_count: number;
  created_at: string;
  updated_at: string;
}

// Room represents a channel within a Group (apc:Room)
export interface Room {
  id: string;
  group_id: string;
  name: string;
  summary: string | null;
  kind: 'chat' | 'forum';
  posting_policy: 'members' | 'mods' | 'owners' | null; // null = inherit from group
  sort_order: number;
  message_count: number;
  thread_count: number;
  created_at: string;
  updated_at: string;
}

// Member represents a user
export interface Member {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  is_remote: boolean;
  ap_actor_id: string | null;
  created_at: string;
}

// GroupMembership represents a member's relationship to a group
export interface GroupMembership {
  id: string;
  group_id: string;
  member_id: string;
  role: 'owner' | 'moderator' | 'member';
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  accepted_at: string | null;
}

// Message represents a note in a room (AS2 Note with apc:room)
export interface Message {
  id: string;
  room_id: string;
  member_id: string;
  content: string;
  reply_to_id: string | null;
  thread_root_id: string | null; // For forum threads
  created_at: string;
  updated_at: string;
  // Joined fields
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

// Thread represents a forum thread (for kind='forum' rooms)
export interface Thread {
  id: string;
  room_id: string;
  member_id: string;
  title: string;
  content: string | null;
  reply_count: number;
  last_reply_at: string | null;
  pinned: boolean;
  locked: boolean;
  created_at: string;
  // Joined fields
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

// ThreadReply is a message in a forum thread
export interface ThreadReply {
  id: string;
  thread_id: string;
  member_id: string;
  content: string;
  created_at: string;
  // Joined fields
  username: string;
  display_name: string | null;
  avatar_url: string | null;
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
  type: 'join_request' | 'join_accepted' | 'mention' | 'reply' | 'invite';
  target_type: 'group' | 'room' | 'message' | null;
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
