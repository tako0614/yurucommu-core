import { apiFetch } from "../../utils/config.ts";
import { encodeMLSMessage } from "../../../../shared/mls_message.ts";

export interface KeyPackage {
  id: string;
  type: "KeyPackage";
  content: string;
  mediaType: string;
  encoding: string;
  groupInfo?: string;
  expiresAt?: string;
  used?: boolean;
  createdAt: string;
}

export interface EncryptedMessage {
  id: string;
  from: string;
  to: string[];
  content: string;
  mediaType: string;
  encoding: string;
  createdAt: string;
  attachments?: {
    url: string;
    mediaType: string;
    key?: string;
    iv?: string;
  }[];
}

export interface PrivateMessagePayload {
  "@context": string[];
  type: ["Object", "PrivateMessage"];
  id?: string;
  to: string[];
  cc?: string[];
  content: string;
  mediaType: string;
  encoding: string;
  attachments?: unknown[];
}

export const fetchKeyPackages = async (
  user: string,
  domain?: string,
): Promise<KeyPackage[]> => {
  try {
    const identifier = domain ? `${user}@${domain}` : user;
    const res = await apiFetch(
      `/api/users/${encodeURIComponent(identifier)}/keyPackages`,
    );
    if (!res.ok) {
      throw new Error("Failed to fetch key packages");
    }
    const data = await res.json();
    return Array.isArray(data.items) ? data.items : [];
  } catch (err) {
    console.error("Error fetching key packages:", err);
    return [];
  }
};

export const addKeyPackage = async (
  user: string,
  pkg: {
    content: string;
    mediaType?: string;
    encoding?: string;
    groupInfo?: string;
    expiresAt?: string;
  },
): Promise<string | null> => {
  try {
    const res = await apiFetch(
      `/api/users/${encodeURIComponent(user)}/keyPackages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pkg),
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.keyId === "string" ? data.keyId : null;
  } catch (err) {
    console.error("Error adding key package:", err);
    return null;
  }
};

export const fetchKeyPackage = async (
  user: string,
  keyId: string,
): Promise<KeyPackage | null> => {
  try {
    const res = await apiFetch(
      `/api/users/${encodeURIComponent(user)}/keyPackages/${
        encodeURIComponent(keyId)
      }`,
    );
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error("Error fetching key package:", err);
    return null;
  }
};

export const deleteKeyPackage = async (
  user: string,
  keyId: string,
): Promise<boolean> => {
  try {
    const res = await apiFetch(
      `/api/users/${encodeURIComponent(user)}/keyPackages/${
        encodeURIComponent(keyId)
      }`,
      { method: "DELETE" },
    );
    return res.ok;
  } catch (err) {
    console.error("Error deleting key package:", err);
    return false;
  }
};

export const sendEncryptedMessage = async (
  user: string,
  to: string[],
  cc: string[],
  data: {
    id?: string;
    content: string;
    mediaType?: string;
    encoding?: string;
    attachments?: unknown[];
  },
): Promise<boolean> => {
  try {
    const payload: PrivateMessagePayload = {
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        "https://purl.archive.org/socialweb/mls#",
      ],
      type: ["Object", "PrivateMessage"],
      id: data.id,
      to,
      cc,
      content: data.content,
      mediaType: data.mediaType ?? "message/mls",
      encoding: data.encoding ?? "base64",
    };
    if (data.attachments) payload.attachments = data.attachments;
    const res = await apiFetch(
      `/api/users/${encodeURIComponent(user)}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    return res.ok;
  } catch (err) {
    console.error("Error sending message:", err);
    return false;
  }
};

export const fetchEncryptedMessages = async (
  user: string,
  partner?: string,
  params?: { limit?: number; before?: string; after?: string },
): Promise<EncryptedMessage[]> => {
  try {
    const search = new URLSearchParams();
    if (partner) search.set("with", partner);
    if (params?.limit) search.set("limit", String(params.limit));
    if (params?.before) search.set("before", params.before);
    if (params?.after) search.set("after", params.after);
    const query = search.toString();
    const url = `/api/users/${encodeURIComponent(user)}/messages${
      query ? `?${query}` : ""
    }`;
    const res = await apiFetch(url);
    if (!res.ok) {
      throw new Error("Failed to fetch messages");
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error("Error fetching messages:", err);
    return [];
  }
};

export interface HandshakeMessage {
  id: string;
  sender: string;
  recipients: string[];
  message: string;
  createdAt: string;
}

const sendHandshake = async (
  user: string,
  to: string[],
  cc: string[],
  content: string,
): Promise<boolean> => {
  try {
    const payload: Record<string, unknown> = {
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        "https://purl.archive.org/socialweb/mls",
      ],
      type: ["Object", "PublicMessage"],
      to,
      cc,
      content,
      mediaType: "message/mls",
      encoding: "base64",
    };
    const res = await apiFetch(
      `/api/users/${encodeURIComponent(user)}/handshakes`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    return res.ok;
  } catch (err) {
    console.error("Error sending handshake:", err);
    return false;
  }
};

export const fetchHandshakes = async (
  user: string,
  partner?: string,
  params?: { limit?: number; before?: string; after?: string },
): Promise<HandshakeMessage[]> => {
  try {
    const search = new URLSearchParams();
    if (partner) search.set("with", partner);
    if (params?.limit) search.set("limit", String(params.limit));
    if (params?.before) search.set("before", params.before);
    if (params?.after) search.set("after", params.after);
    const query = search.toString();
    const url = `/api/users/${encodeURIComponent(user)}/handshakes${
      query ? `?${query}` : ""
    }`;
    const res = await apiFetch(url);
    if (!res.ok) {
      throw new Error("Failed to fetch handshakes");
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error("Error fetching handshakes:", err);
    return [];
  }
};

export const fetchEncryptedKeyPair = async (
  user: string,
): Promise<string | null> => {
  try {
    const res = await apiFetch(
      `/api/users/${encodeURIComponent(user)}/encryptedKeyPair`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.content === "string" ? data.content : null;
  } catch (err) {
    console.error("Error fetching encrypted key pair:", err);
    return null;
  }
};

export const saveEncryptedKeyPair = async (
  user: string,
  content: string,
): Promise<boolean> => {
  try {
    const res = await apiFetch(
      `/api/users/${encodeURIComponent(user)}/encryptedKeyPair`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      },
    );
    return res.ok;
  } catch (err) {
    console.error("Error saving encrypted key pair:", err);
    return false;
  }
};

export const deleteEncryptedKeyPair = async (
  user: string,
): Promise<boolean> => {
  try {
    const res = await apiFetch(
      `/api/users/${encodeURIComponent(user)}/encryptedKeyPair`,
      { method: "DELETE" },
    );
    return res.ok;
  } catch (err) {
    console.error("Error deleting encrypted key pair:", err);
    return false;
  }
};

export const uploadFile = async (
  data: {
    content: ArrayBuffer;
    mediaType?: string;
    key?: string;
    iv?: string;
    name?: string;
  },
): Promise<string | null> => {
  try {
    const form = new FormData();
    form.append(
      "file",
      new Blob([data.content], { type: data.mediaType }),
      data.name ?? "file",
    );
    if (data.key) form.append("key", data.key);
    if (data.iv) form.append("iv", data.iv);
    const res = await apiFetch("/api/files", {
      method: "POST",
      body: form,
    });
    if (!res.ok) return null;
    const d = await res.json();
    return typeof d.url === "string" ? d.url : null;
  } catch (err) {
    console.error("Error uploading attachment:", err);
    return null;
  }
};

export const resetKeyData = async (user: string): Promise<boolean> => {
  try {
    const res = await apiFetch(
      `/api/users/${encodeURIComponent(user)}/resetKeys`,
      { method: "POST" },
    );
    return res.ok;
  } catch (err) {
    console.error("Error resetting key data:", err);
    return false;
  }
};

export interface Room {
  id: string;
  name: string;
  members: string[];
}

export interface RoomsSearchItem {
  id: string;
  name: string;
  icon?: string;
  members: string[];
  hasName: boolean;
  hasIcon: boolean;
  membersCount: number;
}

export const searchRooms = async (
  owner: string,
  params?: {
    participants?: string[];
    match?: "all" | "any" | "none";
    hasName?: boolean;
    hasIcon?: boolean;
    members?: string; // e.g., "eq:2", "ge:3"
  },
): Promise<RoomsSearchItem[]> => {
  try {
    const search = new URLSearchParams();
    search.set("owner", owner);
    if (params?.participants?.length)
      search.set("participants", params.participants.join(","));
    if (params?.match) search.set("match", params.match);
    if (typeof params?.hasName === "boolean")
      search.set("hasName", String(params.hasName));
    if (typeof params?.hasIcon === "boolean")
      search.set("hasIcon", String(params.hasIcon));
    if (params?.members) search.set("members", params.members);
    const res = await apiFetch(`/api/rooms?${search.toString()}`);
    if (!res.ok) throw new Error("failed to search rooms");
    const data = await res.json();
    return Array.isArray(data.rooms) ? data.rooms : [];
  } catch (err) {
    console.error("Error searching rooms:", err);
    return [];
  }
};

export const fetchRoomList = async (
  id: string,
): Promise<Room[]> => {
  try {
    const res = await apiFetch(`/api/accounts/${id}/groups`);
    if (!res.ok) throw new Error("failed");
    const data = await res.json();
    return Array.isArray(data.groups) ? data.groups : [];
  } catch (err) {
    console.error("Error fetching room list:", err);
    return [];
  }
};

export const addRoom = async (
  id: string,
  room: Room,
): Promise<boolean> => {
  try {
    const res = await apiFetch(`/api/accounts/${id}/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(room),
    });
    return res.ok;
  } catch (err) {
    console.error("Error adding room:", err);
    return false;
  }
};

export const removeRoom = async (
  id: string,
  roomId: string,
): Promise<boolean> => {
  try {
    const res = await apiFetch(`/api/accounts/${id}/groups`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: roomId }),
    });
    return res.ok;
  } catch (err) {
    console.error("Error removing room:", err);
    return false;
  }
};

export const updateRoomMember = async (
  roomId: string,
  action: "Add" | "Remove",
  member: string,
): Promise<boolean> => {
  try {
    const res = await apiFetch(`/api/ap/groups/${roomId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: action, object: member }),
    });
    return res.ok;
  } catch (err) {
    console.error("Error updating member:", err);
    return false;
  }
};

export const addRoomMember = async (
  roomId: string,
  member: string,
): Promise<boolean> => {
  return await updateRoomMember(roomId, "Add", member);
};

export const removeRoomMember = async (
  roomId: string,
  member: string,
): Promise<boolean> => {
  return await updateRoomMember(roomId, "Remove", member);
};

export interface KeepMessage {
  id: string;
  content: string;
  createdAt: string;
}

export const fetchKeepMessages = async (
  user: string,
  params?: { limit?: number; before?: string; after?: string },
): Promise<KeepMessage[]> => {
  try {
    const search = new URLSearchParams();
    if (params?.limit) search.set("limit", String(params.limit));
    if (params?.before) search.set("before", params.before);
    if (params?.after) search.set("after", params.after);
    const query = search.toString();
    const res = await apiFetch(
      `/api/users/${encodeURIComponent(user)}/keep${query ? `?${query}` : ""}`,
    );
    if (!res.ok) throw new Error("failed to fetch keep messages");
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error("Error fetching keep messages:", err);
    return [];
  }
};

export const sendKeepMessage = async (
  user: string,
  content: string,
): Promise<KeepMessage | null> => {
  try {
    const res = await apiFetch(
      `/api/users/${encodeURIComponent(user)}/keep`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      },
    );
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error("Error sending keep message:", err);
    return null;
  }
};

// MLS関連のサーバ通信
export interface MLSProposalPayload {
  type: "add" | "remove";
  member: string;
  keyPackage?: string;
}

export interface MLSWelcomePayload {
  type: "welcome";
  member: string;
  epoch: number;
  tree: Record<string, string>;
  secret: string;
}

export interface MLSCommitPayload {
  type: "commit";
  epoch: number;
  proposals: MLSProposalPayload[];
  welcomes?: MLSWelcomePayload[];
}

export const sendProposal = async (
  user: string,
  to: string[],
  cc: string[],
  proposal: MLSProposalPayload,
): Promise<boolean> => {
  const content = encodeMLSMessage(
    "PublicMessage",
    JSON.stringify(proposal),
  );
  return await sendHandshake(user, to, cc, content);
};

export const sendCommit = async (
  user: string,
  to: string[],
  cc: string[],
  commit: MLSCommitPayload,
): Promise<boolean> => {
  const content = encodeMLSMessage(
    "PublicMessage",
    JSON.stringify(commit),
  );
  const ok = await sendHandshake(user, to, cc, content);
  if (!ok) return false;
  if (commit.welcomes) {
    for (const w of commit.welcomes) {
      const wContent = encodeMLSMessage(
        "PublicMessage",
        JSON.stringify(w),
      );
      const success = await sendHandshake(user, [w.member], [], wContent);
      if (!success) return false;
    }
  }
  return true;
};

export const fetchWelcome = async (
  user: string,
  groupId: string,
): Promise<MLSWelcomePayload | null> => {
  try {
    const res = await apiFetch(
      `/api/users/${encodeURIComponent(user)}/groups/${
        encodeURIComponent(groupId)
      }/welcome`,
    );
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error("Error fetching welcome:", err);
    return null;
  }
};
