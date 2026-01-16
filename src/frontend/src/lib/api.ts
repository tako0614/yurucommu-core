import {
  Actor,
  Community,
  Post,
  DMConversation,
  DMMessage,
  Notification,
  Story,
  StoryOverlay,
  ActorStories,
} from '../types';

// ===== Auth API =====

export async function fetchMe(): Promise<{ authenticated: boolean; actor?: Actor }> {
  const res = await fetch('/api/auth/me');
  if (!res.ok) return { authenticated: false };
  const data = await res.json();
  if (data.actor) {
    return { authenticated: true, actor: data.actor };
  }
  return { authenticated: false };
}

export async function login(password: string): Promise<{ success: boolean; error?: string }> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  return res.json();
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' });
}

// ===== Actors API =====

export async function fetchActors(): Promise<Actor[]> {
  const res = await fetch('/api/actors');
  const data = await res.json();
  return data.actors || [];
}

export async function fetchActor(identifier: string): Promise<Actor> {
  const res = await fetch(`/api/actors/${encodeURIComponent(identifier)}`);
  if (!res.ok) throw new Error('Actor not found');
  const data = await res.json();
  return data.actor;
}

export async function updateProfile(data: { name?: string; summary?: string; icon_url?: string; header_url?: string }): Promise<void> {
  const res = await fetch('/api/actors/me', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update profile');
}

export async function fetchFollowers(identifier: string): Promise<Actor[]> {
  const res = await fetch(`/api/actors/${encodeURIComponent(identifier)}/followers`);
  const data = await res.json();
  return data.followers || [];
}

export async function fetchFollowing(identifier: string): Promise<Actor[]> {
  const res = await fetch(`/api/actors/${encodeURIComponent(identifier)}/following`);
  const data = await res.json();
  return data.following || [];
}

// ===== Follow API =====

export async function follow(targetApId: string): Promise<{ status: string }> {
  const res = await fetch('/api/follow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_ap_id: targetApId }),
  });
  if (!res.ok) throw new Error('Failed to follow');
  return res.json();
}

export async function unfollow(targetApId: string): Promise<void> {
  const res = await fetch('/api/follow', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_ap_id: targetApId }),
  });
  if (!res.ok) throw new Error('Failed to unfollow');
}

export async function fetchFollowRequests(): Promise<Actor[]> {
  const res = await fetch('/api/follow/requests');
  const data = await res.json();
  return data.requests || [];
}

export async function acceptFollowRequest(requesterApId: string): Promise<void> {
  const res = await fetch('/api/follow/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requester_ap_id: requesterApId }),
  });
  if (!res.ok) throw new Error('Failed to accept');
}

// ===== Posts API =====

export async function fetchTimeline(options?: {
  limit?: number;
  before?: string;
  community?: string;
}): Promise<Post[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.before) params.set('before', options.before);
  if (options?.community) params.set('community', options.community);
  const query = params.toString() ? `?${params}` : '';
  const res = await fetch(`/api/timeline${query}`);
  const data = await res.json();
  return data.posts || [];
}

export async function fetchFollowingTimeline(options?: {
  limit?: number;
  before?: string;
}): Promise<Post[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.before) params.set('before', options.before);
  const query = params.toString() ? `?${params}` : '';
  const res = await fetch(`/api/timeline/following${query}`);
  const data = await res.json();
  return data.posts || [];
}

export async function fetchPost(apId: string): Promise<Post> {
  const res = await fetch(`/api/posts/${encodeURIComponent(apId)}`);
  if (!res.ok) throw new Error('Post not found');
  const data = await res.json();
  return data.post;
}

export async function fetchReplies(postApId: string): Promise<Post[]> {
  const res = await fetch(`/api/posts/${encodeURIComponent(postApId)}/replies`);
  const data = await res.json();
  return data.replies || [];
}

export async function createPost(data: {
  content: string;
  summary?: string;
  visibility?: string;
  in_reply_to?: string;
  community_ap_id?: string;
  attachments?: { r2_key: string; content_type: string }[];
}): Promise<Post> {
  const res = await fetch('/api/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to create post');
  const result = await res.json();
  return result.post;
}

export async function deletePost(apId: string): Promise<void> {
  const res = await fetch(`/api/posts/${encodeURIComponent(apId)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete post');
}

export async function likePost(apId: string): Promise<void> {
  const res = await fetch(`/api/posts/${encodeURIComponent(apId)}/like`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to like');
}

export async function unlikePost(apId: string): Promise<void> {
  const res = await fetch(`/api/posts/${encodeURIComponent(apId)}/like`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to unlike');
}

export async function bookmarkPost(apId: string): Promise<void> {
  const res = await fetch(`/api/posts/${encodeURIComponent(apId)}/bookmark`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to bookmark');
}

export async function unbookmarkPost(apId: string): Promise<void> {
  const res = await fetch(`/api/posts/${encodeURIComponent(apId)}/bookmark`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to unbookmark');
}

export async function fetchBookmarks(options?: { limit?: number; before?: string }): Promise<Post[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.before) params.set('before', options.before);
  const query = params.toString() ? `?${params}` : '';
  const res = await fetch(`/api/bookmarks${query}`);
  const data = await res.json();
  return data.posts || [];
}

// ===== Communities API =====

export interface CommunityDetail {
  ap_id: string;
  name: string;
  display_name: string;
  summary: string | null;
  icon_url: string | null;
  visibility: 'public' | 'private';
  join_policy: 'open' | 'invite' | 'approval';
  post_policy: 'members' | 'admins';
  member_count: number;
  post_count?: number;
  created_by: string;
  created_at: string;
  is_member: boolean;
  member_role: 'admin' | 'member' | null;
  last_message_at?: string | null;
}

export interface CommunityMember {
  ap_id: string;
  username: string;
  preferred_username: string;
  name: string | null;
  icon_url: string | null;
  role: 'admin' | 'member';
  joined_at: string;
}

export interface CommunityMessage {
  id: string;
  sender: {
    ap_id: string;
    username: string;
    preferred_username: string;
    name: string | null;
    icon_url: string | null;
  };
  content: string;
  created_at: string;
}

export async function fetchCommunities(): Promise<CommunityDetail[]> {
  const res = await fetch('/api/communities');
  const data = await res.json();
  return data.communities || [];
}

export async function fetchCommunity(identifier: string): Promise<CommunityDetail> {
  const res = await fetch(`/api/communities/${encodeURIComponent(identifier)}`);
  if (!res.ok) throw new Error('Community not found');
  const data = await res.json();
  return data.community;
}

export async function createCommunity(data: {
  name: string;
  display_name?: string;
  summary?: string;
}): Promise<CommunityDetail> {
  const res = await fetch('/api/communities', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to create community');
  }
  const result = await res.json();
  return result.community;
}

export async function joinCommunity(identifier: string): Promise<void> {
  const res = await fetch(`/api/communities/${encodeURIComponent(identifier)}/join`, {
    method: 'POST',
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to join community');
  }
}

export async function leaveCommunity(identifier: string): Promise<void> {
  const res = await fetch(`/api/communities/${encodeURIComponent(identifier)}/leave`, {
    method: 'POST',
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to leave community');
  }
}

export async function fetchCommunityMessages(
  identifier: string,
  options?: { limit?: number; before?: string }
): Promise<CommunityMessage[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.before) params.set('before', options.before);
  const query = params.toString() ? `?${params}` : '';
  const res = await fetch(`/api/communities/${encodeURIComponent(identifier)}/messages${query}`);
  if (!res.ok) throw new Error('Failed to fetch messages');
  const data = await res.json();
  return data.messages || [];
}

export async function sendCommunityMessage(identifier: string, content: string): Promise<CommunityMessage> {
  const res = await fetch(`/api/communities/${encodeURIComponent(identifier)}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error('Failed to send message');
  const data = await res.json();
  return data.message;
}

export async function fetchCommunityMembers(identifier: string): Promise<CommunityMember[]> {
  const res = await fetch(`/api/communities/${encodeURIComponent(identifier)}/members`);
  if (!res.ok) throw new Error('Failed to fetch members');
  const data = await res.json();
  return data.members || [];
}

// ===== DM API =====

export async function fetchDMConversations(): Promise<DMConversation[]> {
  const res = await fetch('/api/dm/conversations');
  const data = await res.json();
  return data.conversations || [];
}

export async function createDMConversation(participantApId: string): Promise<DMConversation> {
  const res = await fetch('/api/dm/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ participant_ap_id: participantApId }),
  });
  if (!res.ok) throw new Error('Failed to create conversation');
  const data = await res.json();
  return data.conversation;
}

export async function fetchDMMessages(conversationId: string, options?: { limit?: number; before?: string }): Promise<DMMessage[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.before) params.set('before', options.before);
  const query = params.toString() ? `?${params}` : '';
  const res = await fetch(`/api/dm/conversations/${conversationId}/messages${query}`);
  const data = await res.json();
  return data.messages || [];
}

export async function sendDMMessage(conversationId: string, content: string): Promise<DMMessage> {
  const res = await fetch(`/api/dm/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error('Failed to send message');
  const data = await res.json();
  return data.message;
}

// ===== Notifications API =====

export async function fetchNotifications(limit?: number): Promise<Notification[]> {
  const query = limit ? `?limit=${limit}` : '';
  const res = await fetch(`/api/notifications${query}`);
  const data = await res.json();
  return data.notifications || [];
}

export async function fetchUnreadCount(): Promise<number> {
  const res = await fetch('/api/notifications/unread/count');
  const data = await res.json();
  return data.count || 0;
}

export async function markNotificationsRead(ids?: string[]): Promise<void> {
  const res = await fetch('/api/notifications/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error('Failed to mark as read');
}

// ===== Search API =====

export async function searchActors(query: string): Promise<Actor[]> {
  const res = await fetch(`/api/search/actors?q=${encodeURIComponent(query)}`);
  const data = await res.json();
  return data.actors || [];
}

export async function searchRemote(query: string): Promise<Actor[]> {
  const res = await fetch(`/api/search/remote?q=${encodeURIComponent(query)}`);
  const data = await res.json();
  return data.actors || [];
}

export async function searchPosts(query: string): Promise<Post[]> {
  const res = await fetch(`/api/search/posts?q=${encodeURIComponent(query)}`);
  const data = await res.json();
  return data.posts || [];
}

// ===== Media API =====

export async function uploadMedia(file: File): Promise<{ url: string; r2_key: string; content_type: string }> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch('/api/media/upload', {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error('Failed to upload');
  return res.json();
}

// ===== Story API =====

export async function fetchStories(): Promise<ActorStories[]> {
  const res = await fetch('/api/stories');
  if (!res.ok) throw new Error('Failed to fetch stories');
  const data = await res.json();
  return data.actor_stories || [];
}

export async function fetchActorStories(actorId: string): Promise<Story[]> {
  const res = await fetch(`/api/stories/${encodeURIComponent(actorId)}`);
  if (!res.ok) throw new Error('Failed to fetch actor stories');
  const data = await res.json();
  return data.stories || [];
}

export async function createStory(story: {
  attachment: { r2_key: string; content_type: string };
  displayDuration: string;
  overlays?: StoryOverlay[];
}): Promise<Story> {
  const res = await fetch('/api/stories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(story),
  });
  if (!res.ok) throw new Error('Failed to create story');
  const data = await res.json();
  return data.story;
}

export async function deleteStory(apId: string): Promise<void> {
  const res = await fetch(`/api/stories/${encodeURIComponent(apId)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete story');
}

export async function markStoryViewed(apId: string): Promise<void> {
  const res = await fetch(`/api/stories/${encodeURIComponent(apId)}/view`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to mark story as viewed');
}

export async function voteOnStory(apId: string, optionIndex: number): Promise<void> {
  const res = await fetch(`/api/stories/${encodeURIComponent(apId)}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ option_index: optionIndex }),
  });
  if (!res.ok) throw new Error('Failed to vote on story');
}
