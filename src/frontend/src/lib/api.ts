import {
  Member,
  MemberProfile,
  Community,
  Post,
  DMConversation,
  DMMessage,
  Notification,
} from '../types';

// ===== Auth API =====

export async function fetchAuthMode(): Promise<{ mode: 'oauth' | 'password' }> {
  const res = await fetch('/api/auth/mode');
  return res.json();
}

export async function fetchMe(): Promise<{ authenticated: boolean; member?: Member }> {
  const res = await fetch('/api/me');
  return res.json();
}

export async function loginWithPassword(
  username: string,
  password: string
): Promise<{ success: boolean; member?: Member; error?: string }> {
  const res = await fetch('/api/auth/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return res.json();
}

// ===== Communities API =====

export async function fetchCommunities(): Promise<{ communities: Community[] }> {
  const res = await fetch('/api/communities');
  return res.json();
}

export async function createCommunity(data: { name: string; description?: string }): Promise<{ community: Community }> {
  const res = await fetch('/api/communities', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to create community');
  return res.json();
}

// ===== Members API =====

export async function fetchMembers(): Promise<{ members: Member[] }> {
  const res = await fetch('/api/members');
  return res.json();
}

export async function fetchMember(memberId: string): Promise<{ member: Member }> {
  const res = await fetch(`/api/members/${memberId}`);
  if (!res.ok) throw new Error('Member not found');
  return res.json();
}

export async function fetchMemberProfile(memberId: string): Promise<{ member: MemberProfile }> {
  const res = await fetch(`/api/members/${memberId}/profile`);
  if (!res.ok) throw new Error('Member not found');
  return res.json();
}

export async function followMember(memberId: string): Promise<void> {
  const res = await fetch(`/api/follow/${memberId}`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to follow');
}

export async function unfollowMember(memberId: string): Promise<void> {
  const res = await fetch(`/api/follow/${memberId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to unfollow');
}

export async function fetchFollowers(memberId: string): Promise<{ members: Member[] }> {
  const res = await fetch(`/api/members/${memberId}/followers`);
  return res.json();
}

export async function fetchFollowing(memberId: string): Promise<{ members: Member[] }> {
  const res = await fetch(`/api/members/${memberId}/following`);
  return res.json();
}

export async function updateProfile(data: { display_name?: string; bio?: string }): Promise<{ member: Member }> {
  const res = await fetch('/api/me/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update profile');
  return res.json();
}

// ===== Posts API =====

export async function fetchTimeline(options?: {
  limit?: number;
  before?: string;
  filter?: 'following' | 'community';
  communityId?: string;
}): Promise<{ posts: Post[] }> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.before) params.set('before', options.before);
  if (options?.communityId) params.set('community', options.communityId);

  const query = params.toString() ? `?${params.toString()}` : '';

  // Use /api/timeline/following for following filter, /api/timeline for community or all
  const endpoint = options?.filter === 'following' ? '/api/timeline/following' : '/api/timeline';
  const res = await fetch(`${endpoint}${query}`);
  return res.json();
}

export async function fetchMemberPosts(memberId: string, options?: {
  limit?: number;
  before?: string;
}): Promise<{ posts: Post[] }> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.before) params.set('before', options.before);

  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`/api/members/${memberId}/posts${query}`);
  return res.json();
}

export async function fetchMemberLikes(memberId: string, options?: {
  limit?: number;
  before?: string;
}): Promise<{ posts: Post[] }> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.before) params.set('before', options.before);

  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`/api/members/${memberId}/likes${query}`);
  return res.json();
}

export async function fetchPost(postId: string): Promise<{ post: Post }> {
  const res = await fetch(`/api/posts/${postId}`);
  if (!res.ok) throw new Error('Post not found');
  return res.json();
}

export async function fetchPostReplies(postId: string): Promise<{ replies: Post[] }> {
  const res = await fetch(`/api/posts/${postId}/replies`);
  return res.json();
}

export async function createPost(data: {
  content: string;
  visibility?: 'public' | 'unlisted' | 'followers';
  reply_to_id?: string;
  community_id?: string;
  media?: { r2_key: string; content_type: string }[];
}): Promise<Post> {
  const res = await fetch('/api/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to create post');
  return res.json();
}

export async function deletePost(postId: string): Promise<void> {
  const res = await fetch(`/api/posts/${postId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete post');
}

export async function likePost(postId: string): Promise<void> {
  const res = await fetch(`/api/posts/${postId}/like`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to like post');
}

export async function unlikePost(postId: string): Promise<void> {
  const res = await fetch(`/api/posts/${postId}/like`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to unlike post');
}

export async function repostPost(postId: string): Promise<void> {
  const res = await fetch(`/api/posts/${postId}/repost`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to repost');
}

export async function unrepostPost(postId: string): Promise<void> {
  const res = await fetch(`/api/posts/${postId}/repost`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to unrepost');
}

// ===== DM API =====

export async function fetchDMConversations(): Promise<{ conversations: DMConversation[] }> {
  const res = await fetch('/api/dm/conversations');
  return res.json();
}

export async function createDMConversation(memberId: string): Promise<DMConversation> {
  const res = await fetch('/api/dm/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ member_id: memberId }),
  });
  if (!res.ok) throw new Error('Failed to create conversation');
  return res.json();
}

export async function fetchDMMessages(conversationId: string): Promise<{ messages: DMMessage[] }> {
  const res = await fetch(`/api/dm/conversations/${conversationId}/messages`);
  return res.json();
}

export async function sendDMMessage(conversationId: string, content: string): Promise<DMMessage> {
  const res = await fetch(`/api/dm/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error('Failed to send message');
  return res.json();
}

// ===== Notifications API =====

export async function fetchNotifications(): Promise<{ notifications: Notification[] }> {
  const res = await fetch('/api/notifications');
  return res.json();
}

export async function fetchUnreadNotificationCount(): Promise<{ count: number }> {
  const res = await fetch('/api/notifications/unread/count');
  return res.json();
}

export async function markNotificationsRead(notificationIds?: string[]): Promise<void> {
  const res = await fetch('/api/notifications/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: notificationIds }),
  });
  if (!res.ok) throw new Error('Failed to mark notifications as read');
}

// ===== Upload API =====

export async function uploadFile(file: File): Promise<{
  id: string;
  r2_key: string;
  content_type: string;
  filename: string;
  size: number;
}> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch('/api/upload', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) throw new Error('Failed to upload file');
  return res.json();
}

// ===== Search API =====

export async function searchUsers(query: string): Promise<{ users: Member[] }> {
  const res = await fetch(`/api/search/users?q=${encodeURIComponent(query)}`);
  return res.json();
}

export async function searchPosts(query: string): Promise<{ posts: Post[] }> {
  const res = await fetch(`/api/search/posts?q=${encodeURIComponent(query)}`);
  return res.json();
}

// ===== Bookmarks API =====

export async function fetchBookmarks(options?: { limit?: number; before?: string }): Promise<{ posts: Post[] }> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.before) params.set('before', options.before);
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`/api/bookmarks${query}`);
  return res.json();
}

export async function bookmarkPost(postId: string): Promise<void> {
  const res = await fetch(`/api/posts/${postId}/bookmark`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to bookmark');
}

export async function unbookmarkPost(postId: string): Promise<void> {
  const res = await fetch(`/api/posts/${postId}/bookmark`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to unbookmark');
}

// ===== Block/Mute API =====

export async function blockUser(memberId: string): Promise<void> {
  const res = await fetch(`/api/block/${memberId}`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to block');
}

export async function unblockUser(memberId: string): Promise<void> {
  const res = await fetch(`/api/block/${memberId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to unblock');
}

export async function muteUser(memberId: string): Promise<void> {
  const res = await fetch(`/api/mute/${memberId}`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to mute');
}

export async function unmuteUser(memberId: string): Promise<void> {
  const res = await fetch(`/api/mute/${memberId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to unmute');
}

export async function fetchBlockedUsers(): Promise<{ users: Member[] }> {
  const res = await fetch('/api/blocks');
  return res.json();
}

export async function fetchMutedUsers(): Promise<{ users: Member[] }> {
  const res = await fetch('/api/mutes');
  return res.json();
}

// ===== Community Management API =====

export async function updateCommunity(id: string, data: { name?: string; description?: string }): Promise<{ community: Community }> {
  const res = await fetch(`/api/communities/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update community');
  return res.json();
}

export async function deleteCommunity(id: string): Promise<void> {
  const res = await fetch(`/api/communities/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete community');
}

// ===== Account API =====

export async function deleteAccount(): Promise<void> {
  const res = await fetch('/api/me', { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to delete account');
  }
}
