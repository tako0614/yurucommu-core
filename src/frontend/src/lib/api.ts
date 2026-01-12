import {
  Member,
  Group,
  GroupWithMembership,
  Room,
  Message,
  Thread,
  ThreadReply,
  DMConversation,
  DMMessage,
  Notification,
  MemberWithRole,
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

// ===== Groups API =====

export async function fetchGroups(): Promise<{ groups: GroupWithMembership[] }> {
  const res = await fetch('/api/groups');
  return res.json();
}

export async function fetchGroup(groupId: string): Promise<{ group: GroupWithMembership }> {
  const res = await fetch(`/api/groups/${groupId}`);
  if (!res.ok) throw new Error('Group not found');
  return res.json();
}

export async function joinGroup(groupId: string): Promise<void> {
  const res = await fetch(`/api/groups/${groupId}/join`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to join group');
}

export async function leaveGroup(groupId: string): Promise<void> {
  const res = await fetch(`/api/groups/${groupId}/leave`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to leave group');
}

export async function fetchGroupMembers(groupId: string): Promise<{ members: MemberWithRole[] }> {
  const res = await fetch(`/api/groups/${groupId}/members`);
  return res.json();
}

// ===== Rooms API =====

export async function fetchRooms(groupId: string): Promise<{ rooms: Room[] }> {
  const res = await fetch(`/api/groups/${groupId}/rooms`);
  return res.json();
}

export async function fetchRoom(roomId: string): Promise<{ room: Room }> {
  const res = await fetch(`/api/rooms/${roomId}`);
  if (!res.ok) throw new Error('Room not found');
  return res.json();
}

// ===== Messages API (Chat Rooms) =====

export async function fetchMessages(
  roomId: string,
  options?: { limit?: number; before?: string; since?: string }
): Promise<{ messages: Message[] }> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.before) params.set('before', options.before);
  if (options?.since) params.set('since', options.since);

  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`/api/rooms/${roomId}/messages${query}`);
  return res.json();
}

export async function sendMessage(
  roomId: string,
  data: { content: string; reply_to_id?: string }
): Promise<Message> {
  const res = await fetch(`/api/rooms/${roomId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to send message');
  return res.json();
}

export async function deleteMessage(roomId: string, messageId: string): Promise<void> {
  const res = await fetch(`/api/rooms/${roomId}/messages/${messageId}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete message');
}

// ===== Threads API (Forum Rooms) =====

export async function fetchThreads(roomId: string): Promise<{ threads: Thread[] }> {
  const res = await fetch(`/api/rooms/${roomId}/threads`);
  return res.json();
}

export async function createThread(
  roomId: string,
  data: { title: string; content?: string }
): Promise<Thread> {
  const res = await fetch(`/api/rooms/${roomId}/threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to create thread');
  return res.json();
}

export async function fetchThread(threadId: string): Promise<{ thread: Thread; replies: ThreadReply[] }> {
  const res = await fetch(`/api/threads/${threadId}`);
  if (!res.ok) throw new Error('Thread not found');
  return res.json();
}

export async function createThreadReply(threadId: string, content: string): Promise<ThreadReply> {
  const res = await fetch(`/api/threads/${threadId}/replies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error('Failed to create reply');
  return res.json();
}

export async function deleteThread(threadId: string): Promise<void> {
  const res = await fetch(`/api/threads/${threadId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete thread');
}

export async function deleteThreadReply(threadId: string, replyId: string): Promise<void> {
  const res = await fetch(`/api/threads/${threadId}/replies/${replyId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete reply');
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
