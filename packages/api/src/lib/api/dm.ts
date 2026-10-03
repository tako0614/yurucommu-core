import {
  readResponseJson,
  requiredArray,
  optionalBoolean,
  optionalString,
  requiredCount,
  validateActor,
  validateMessage,
} from "./response.ts";
import type { ApiReadOptions } from "./fetch.ts";
import type { DMMessage, MediaAttachment } from "../../types/index.ts";
import { normalizeActor } from "./normalize.ts";
import { apiDelete, apiFetch, apiPost, assertOk } from "./fetch.ts";

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
export function fetchDMContacts(): Promise<DMContactsResponse>;
export function fetchDMContacts(
  options: ApiReadOptions,
): Promise<DMContactsResponse>;
export async function fetchDMContacts(
  options?: ApiReadOptions,
): Promise<DMContactsResponse> {
  const res = await apiFetch("/api/dm/contacts", options);
  await assertOk(res, "Failed to load conversations");
  const data = await readResponseJson(res);
  return {
    mutual_followers: requiredArray<DMContact>(
      data,
      "mutual_followers",
      validateActor,
    ).map(normalizeActor),
    communities: requiredArray<DMContact>(
      data,
      "communities",
      validateActor,
    ).map(normalizeActor),
    request_count: requiredCount(data.request_count, "request_count"),
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

export function fetchDMUnreadCount(): Promise<DMUnreadCount>;
export function fetchDMUnreadCount(
  options: ApiReadOptions,
): Promise<DMUnreadCount>;
export async function fetchDMUnreadCount(
  options?: ApiReadOptions,
): Promise<DMUnreadCount> {
  const res = await apiFetch("/api/dm/unread/count", options);
  await assertOk(res, "Failed to load unread count");
  const data = await readResponseJson(res);
  return {
    total: requiredCount(data.total, "total"),
    dm: requiredCount(data.dm, "dm"),
    community: requiredCount(data.community, "community"),
  };
}

// Fetch message requests
export function fetchDMRequests(): Promise<DMRequest[]>;
export function fetchDMRequests(options: ApiReadOptions): Promise<DMRequest[]>;
export async function fetchDMRequests(
  options?: ApiReadOptions,
): Promise<DMRequest[]> {
  const res = await apiFetch("/api/dm/requests", options);
  await assertOk(res, "Failed to load message requests");
  const data = await readResponseJson(res);
  return requiredArray<DMRequest>(data, "requests", validateMessage).map(
    normalizeDmRequest,
  );
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
  options?: ApiReadOptions & { limit?: number; before?: string },
): Promise<{
  messages: DMMessage[];
  conversation_id: string | null;
  hasMore: boolean;
  /**
   * The partner's last-read time (LOCAL-ONLY read receipt), or null when
   * unknown — a remote partner never reports read state, so null must render
   * as "no receipt", not "unread".
   */
  partnerLastReadAt: string | null;
}> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.before) params.set("before", options.before);
  const query = params.toString() ? `?${params}` : "";
  const res = await apiFetch(
    `/api/dm/user/${encodeURIComponent(userApId)}/messages${query}`,
    options,
  );
  await assertOk(res, "Failed to load messages");
  const data = await readResponseJson(res);
  return {
    messages: requiredArray<DMMessage>(data, "messages", validateMessage).map(
      normalizeDmMessage,
    ),
    conversation_id: optionalString(data, "conversation_id"),
    hasMore: optionalBoolean(data, "has_more"),
    partnerLastReadAt: optionalString(data, "partner_last_read_at"),
  };
}

export async function sendUserDMMessage(
  userApId: string,
  content: string,
  attachments?: MediaAttachment[],
): Promise<{ message: DMMessage; conversation_id: string }> {
  const res = await apiPost(
    `/api/dm/user/${encodeURIComponent(userApId)}/messages`,
    {
      content,
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
    },
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
  options?: ApiReadOptions,
): Promise<{ is_typing: boolean; last_typed_at: string | null }> {
  const res = await apiFetch(
    `/api/dm/user/${encodeURIComponent(userApId)}/typing`,
    options,
  );
  await assertOk(res, "Failed to fetch typing");
  const data = await readResponseJson(res);
  return {
    is_typing: optionalBoolean(data, "is_typing"),
    last_typed_at: optionalString(data, "last_typed_at"),
  };
}

export async function markDMAsRead(userApId: string): Promise<void> {
  const res = await apiPost(
    `/api/dm/user/${encodeURIComponent(userApId)}/read`,
  );
  await assertOk(res, "Failed to mark as read");
}

// Archive a one-to-one DM conversation (by the other party's AP-ID). Archived
// conversations drop out of the inbox + unread count and live under the
// archived view until unarchived.
export async function archiveDMConversation(userApId: string): Promise<void> {
  const res = await apiPost(
    `/api/dm/user/${encodeURIComponent(userApId)}/archive`,
  );
  await assertOk(res, "Failed to archive conversation");
}

export async function unarchiveDMConversation(userApId: string): Promise<void> {
  const res = await apiDelete(
    `/api/dm/user/${encodeURIComponent(userApId)}/archive`,
  );
  await assertOk(res, "Failed to unarchive conversation");
}

export function fetchArchivedDMConversations(): Promise<DMContact[]>;
export function fetchArchivedDMConversations(
  options: ApiReadOptions,
): Promise<DMContact[]>;
export async function fetchArchivedDMConversations(
  options?: ApiReadOptions,
): Promise<DMContact[]> {
  const res = await apiFetch("/api/dm/archived", options);
  await assertOk(res, "Failed to load archived conversations");
  const data = await readResponseJson(res);
  // The archived endpoint returns actor-profile fields + conversation_id +
  // last_message_at (no preview / unread). Normalize to a one-to-one DMContact.
  return requiredArray<DMContact>(data, "archived", validateActor).map((c) => {
    const a = normalizeActor(c as DMContact);
    return {
      ...a,
      type: "user" as const,
      last_message: null,
      unread_count: 0,
    };
  });
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
export async function fetchDMContact(
  apId: string,
  options?: ApiReadOptions,
): Promise<DMContact | null> {
  const res = await apiFetch(
    `/api/dm/contact/${encodeURIComponent(apId)}`,
    options,
  );
  if (res.status === 404) return null;
  await assertOk(res, "Failed to resolve contact");
  const data = await readResponseJson(res);
  validateActor(data.contact);
  return normalizeActor(data.contact as DMContact);
}
