import type { DMMessage } from "../../types/index.ts";
import { normalizeActor } from "./normalize.ts";
import { apiFetch, apiPost, assertOk } from "./fetch.ts";

// Contact types for the unified DM view
export interface DMContact {
  type: "user" | "community";
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

const normalizeDmRequest = (request: DMRequest): DMRequest => ({
  ...request,
  sender: normalizeActor(request.sender),
});

// Fetch contacts (followers + communities) - no room creation needed
export async function fetchDMContacts(): Promise<DMContactsResponse> {
  const res = await apiFetch("/api/dm/contacts");
  const data = (await res.json()) as {
    mutual_followers?: DMContact[];
    communities?: DMContact[];
    request_count?: number;
  };
  return {
    mutual_followers: (data.mutual_followers || []).map(normalizeActor),
    communities: (data.communities || []).map(normalizeActor),
    request_count: data.request_count || 0,
  };
}

// Lightweight unread total for the Messages nav badge. The backend computes the
// same DM + community-chat unread totals as /contacts (a parity test pins them)
// but with two COUNT(*) joins and no contact enrichment / previews, so the 30s
// badge poll does not pay for the full contacts list.
export interface DMUnreadCount {
  total: number;
  dm: number;
  community: number;
}

export async function fetchDMUnreadCount(): Promise<DMUnreadCount> {
  const res = await apiFetch("/api/dm/unread/count");
  const data = (await res.json()) as Partial<DMUnreadCount>;
  return {
    total: data.total || 0,
    dm: data.dm || 0,
    community: data.community || 0,
  };
}

// Fetch message requests
export async function fetchDMRequests(): Promise<DMRequest[]> {
  const res = await apiFetch("/api/dm/requests");
  const data = (await res.json()) as { requests?: DMRequest[] };
  return (data.requests || []).map(normalizeDmRequest);
}

// Reject message request (by sender AP ID, optionally block)
export async function rejectDMRequest(
  senderApId: string,
  block?: boolean,
): Promise<void> {
  const res = await apiPost("/api/dm/requests/reject", {
    sender_ap_id: senderApId,
    block,
  });
  await assertOk(res, "Failed to reject request");
}

// User-based DM endpoints (no conversation creation needed)
export async function fetchUserDMMessages(
  userApId: string,
  options?: { limit?: number; before?: string },
): Promise<{
  messages: DMMessage[];
  conversation_id: string | null;
  hasMore: boolean;
}> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.before) params.set("before", options.before);
  const query = params.toString() ? `?${params}` : "";
  const res = await apiFetch(
    `/api/dm/user/${encodeURIComponent(userApId)}/messages${query}`,
  );
  const data = (await res.json()) as {
    messages?: DMMessage[];
    conversation_id?: string | null;
    has_more?: boolean;
  };
  return {
    messages: (data.messages || []).map(normalizeDmMessage),
    conversation_id: data.conversation_id ?? null,
    hasMore: data.has_more ?? false,
  };
}

export async function sendUserDMMessage(
  userApId: string,
  content: string,
): Promise<{ message: DMMessage; conversation_id: string }> {
  const res = await apiPost(
    `/api/dm/user/${encodeURIComponent(userApId)}/messages`,
    { content },
  );
  await assertOk(res, "Failed to send message");
  const data = (await res.json()) as {
    message: DMMessage;
    conversation_id: string;
  };
  return {
    message: normalizeDmMessage(data.message),
    conversation_id: data.conversation_id,
  };
}

export async function sendUserDMTyping(userApId: string): Promise<void> {
  const res = await apiPost(
    `/api/dm/user/${encodeURIComponent(userApId)}/typing`,
  );
  await assertOk(res, "Failed to send typing");
}

export async function fetchUserDMTyping(
  userApId: string,
): Promise<{ is_typing: boolean; last_typed_at: string | null }> {
  const res = await apiFetch(
    `/api/dm/user/${encodeURIComponent(userApId)}/typing`,
  );
  await assertOk(res, "Failed to fetch typing");
  const data = (await res.json()) as {
    is_typing?: boolean;
    last_typed_at?: string | null;
  };
  return {
    is_typing: !!data.is_typing,
    last_typed_at: data.last_typed_at ?? null,
  };
}

export async function markDMAsRead(userApId: string): Promise<void> {
  const res = await apiPost(
    `/api/dm/user/${encodeURIComponent(userApId)}/read`,
  );
  await assertOk(res, "Failed to mark as read");
}

// Mark a community (group chat) as read so its unread badge clears.
export async function markCommunityAsRead(
  communityApId: string,
): Promise<void> {
  const res = await apiPost(
    `/api/dm/community/${encodeURIComponent(communityApId)}/read`,
  );
  await assertOk(res, "Failed to mark as read");
}

// Resolve a single DM contact (user or community) by AP-ID. Used to render a
// deep-linked conversation that is not present in the loaded contact list.
// Returns null when no such actor/community is known.
export async function fetchDMContact(apId: string): Promise<DMContact | null> {
  const res = await apiFetch(`/api/dm/contact/${encodeURIComponent(apId)}`);
  if (res.status === 404) return null;
  await assertOk(res, "Failed to resolve contact");
  const data = (await res.json()) as { contact?: DMContact };
  return data.contact ? normalizeActor(data.contact) : null;
}
