import type { DMConversation, DMMessage } from '../../types';
import { normalizeActor } from './normalize';

// Contact types for the unified DM view
export interface DMContact {
  type: 'user' | 'community';
  ap_id: string;
  username: string;
  preferred_username: string;
  name: string | null;
  icon_url: string | null;
  conversation_id?: string | null;
  member_count?: number;
  last_message: { content: string; is_mine: boolean } | null;
  last_message_at: string | null;
  unread_count?: number;
}

export interface DMContactsResponse {
  mutual_followers: DMContact[];
  communities: DMContact[];
  request_count: number;
}

export interface DMRequest {
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

const normalizeDmMessage = (message: DMMessage): DMMessage => ({
  ...message,
  sender: normalizeActor(message.sender),
});

const normalizeDmConversation = (conversation: DMConversation): DMConversation => ({
  ...conversation,
  other_participant: normalizeActor(conversation.other_participant),
});

const normalizeDmRequest = (request: DMRequest): DMRequest => ({
  ...request,
  sender: normalizeActor(request.sender),
});

// Fetch contacts (followers + communities) - no room creation needed
export async function fetchDMContacts(): Promise<DMContactsResponse> {
  const res = await fetch('/api/dm/contacts');
  const data = await res.json();
  return {
    mutual_followers: (data.mutual_followers || []).map(normalizeActor),
    communities: (data.communities || []).map(normalizeActor),
    request_count: data.request_count || 0,
  };
}

// Fetch message requests
export async function fetchDMRequests(): Promise<DMRequest[]> {
  const res = await fetch('/api/dm/requests');
  const data = await res.json();
  return (data.requests || []).map(normalizeDmRequest);
}

// Accept message request (by sender AP ID)
export async function acceptDMRequest(senderApId: string): Promise<void> {
  const res = await fetch('/api/dm/requests/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender_ap_id: senderApId }),
  });
  if (!res.ok) throw new Error('Failed to accept request');
}

// Reject message request (by sender AP ID, optionally block)
export async function rejectDMRequest(senderApId: string, block?: boolean): Promise<void> {
  const res = await fetch('/api/dm/requests/reject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender_ap_id: senderApId, block }),
  });
  if (!res.ok) throw new Error('Failed to reject request');
}

// Legacy: Fetch conversations (for backwards compatibility)
export async function fetchDMConversations(): Promise<DMConversation[]> {
  const res = await fetch('/api/dm/conversations');
  const data = await res.json();
  return (data.conversations || []).map(normalizeDmConversation);
}

export async function createDMConversation(participantApId: string): Promise<DMConversation> {
  const res = await fetch('/api/dm/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ participant_ap_id: participantApId }),
  });
  if (!res.ok) throw new Error('Failed to create conversation');
  const data = await res.json();
  return normalizeDmConversation(data.conversation);
}

export async function fetchDMMessages(
  conversationId: string,
  options?: { limit?: number; before?: string }
): Promise<DMMessage[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.before) params.set('before', options.before);
  const query = params.toString() ? `?${params}` : '';
  const res = await fetch(`/api/dm/conversations/${conversationId}/messages${query}`);
  const data = await res.json();
  return (data.messages || []).map(normalizeDmMessage);
}

export async function sendDMMessage(conversationId: string, content: string): Promise<DMMessage> {
  const res = await fetch(`/api/dm/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error('Failed to send message');
  const data = await res.json();
  return normalizeDmMessage(data.message);
}

// User-based DM endpoints (no conversation creation needed)
export async function fetchUserDMMessages(
  userApId: string,
  options?: { limit?: number; before?: string }
): Promise<{ messages: DMMessage[]; conversation_id: string | null }> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.before) params.set('before', options.before);
  const query = params.toString() ? `?${params}` : '';
  const res = await fetch(`/api/dm/user/${encodeURIComponent(userApId)}/messages${query}`);
  const data = await res.json();
  return {
    messages: (data.messages || []).map(normalizeDmMessage),
    conversation_id: data.conversation_id,
  };
}

export async function sendUserDMMessage(
  userApId: string,
  content: string
): Promise<{ message: DMMessage; conversation_id: string }> {
  const res = await fetch(`/api/dm/user/${encodeURIComponent(userApId)}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to send message');
  }
  const data = await res.json();
  return {
    message: normalizeDmMessage(data.message),
    conversation_id: data.conversation_id,
  };
}

export async function sendUserDMTyping(userApId: string): Promise<void> {
  const res = await fetch(`/api/dm/user/${encodeURIComponent(userApId)}/typing`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to send typing');
}

export async function fetchUserDMTyping(
  userApId: string
): Promise<{ is_typing: boolean; last_typed_at: string | null }> {
  const res = await fetch(`/api/dm/user/${encodeURIComponent(userApId)}/typing`);
  if (!res.ok) throw new Error('Failed to fetch typing');
  const data = await res.json();
  return {
    is_typing: !!data.is_typing,
    last_typed_at: data.last_typed_at ?? null,
  };
}

export async function markDMAsRead(userApId: string): Promise<void> {
  const res = await fetch(`/api/dm/user/${encodeURIComponent(userApId)}/read`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to mark as read');
}
