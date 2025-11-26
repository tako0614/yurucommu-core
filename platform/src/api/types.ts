/**
 * Common API types shared between frontend and mobile app
 */

export type User = {
  id: string;
  display_name: string;
  avatar_url?: string | null;
  handle?: string | null;
  profile_completed_at?: string | null;
  bio?: string | null;
  summary?: string | null;
  is_private?: number;
  manually_approves_followers?: number;
  friend_status?: 'pending' | 'accepted' | 'rejected' | null;
  created_at?: Date | string;
};

export type Community = {
  id: string;
  name: string;
  description?: string | null;
  icon_url?: string | null;
  visibility?: string;
  invite_policy?: string;
  created_by?: string;
  created_at?: Date | string;
  ap_id?: string | null;
  member_count?: number;
  my_role?: string | null;
  // Accept mirrored fields that may appear when communities are embedded
  community_name?: string | null;
  community_icon_url?: string | null;
};

export type Post = {
  id: string;
  text: string;
  type?: string;
  content_warning?: string | null;
  sensitive?: number | boolean;
  media?: MediaAttachment[] | null;
  media_urls?: string[] | null;
  media_json?: string;
  created_at: string | Date;
  author_id: string;
  community_id?: string | null;
  community_name?: string | null;
  community_icon_url?: string | null;
  broadcast_all?: number | boolean;
  visible_to_friends?: number | boolean;
  attributed_community_id?: string | null;
  like_count?: number;
  comment_count?: number;
  reaction_count?: number;
  pinned?: number;
  ap_object_id?: string | null;
  ap_attributed_to?: string | null;
  in_reply_to?: string | null;
  ap_activity_id?: string | null;
};

export type MediaAttachment = {
  url: string;
  description?: string | null;
  content_type?: string | null;
};

export type FriendEdge = {
  requester_id: string;
  addressee_id: string;
  status?: string | null;
  created_at?: string;
  requester?: User | null;
  addressee?: User | null;
};

export type Channel = {
  id: string;
  name: string;
  community_id: string;
  created_at: string | Date;
};

export type Notification = {
  id: string;
  type: string;
  message?: string | null;
  actor_id?: string | null;
  created_at: string | Date;
  read_at?: string | null;
};

export type CommunityInvitation = {
  id: string;
  community_id: string;
  status?: string;
  created_at?: string;
  community?: Community;
};

export type CommunityInviteCode = {
  code: string;
  community_id: string;
  created_by?: string | null;
  created_at?: string | Date;
  expires_at?: string | null;
  max_uses?: number | null;
  uses?: number | null;
  active?: number | boolean;
};

export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

export type FirebasePublicConfig = {
  apiKey?: string | null;
  projectId?: string | null;
  appId?: string | null;
  messagingSenderId?: string | null;
  vapidKey?: string | null;
  authDomain?: string | null;
  storageBucket?: string | null;
};

// API request/response helpers
export type ApiRequestInit = Omit<RequestInit, 'body'> & {
  body?: BodyInit | Record<string, unknown> | null;
  skipAuth?: boolean;
};

export type ApiResponse<T> = {
  ok: boolean;
  data?: T;
  error?: string;
};

