import { apiFetch } from "../../utils/config.ts";
import { decodeGroupInfo, encodePublicMessage } from "./mls_message.ts";
import {
  type GeneratedKeyPair,
  joinWithGroupInfo,
  type RawKeyPackageInput,
  type RosterEvidence,
  type StoredGroupState,
  updateKey,
  verifyGroupInfo,
  verifyKeyPackage,
} from "./mls_wrapper.ts";
import {
  appendKeyPackageRecords,
  appendRosterEvidence,
  loadKeyPackageRecords,
} from "./storage.ts";
import { decodeMlsMessage } from "ts-mls";

const bindingErrorMessages: Record<string, string> = {
  "ap_mls.binding.identity_mismatch":
    "Credentialのidentityがアクターと一致しません",
  "ap_mls.binding.policy_violation": "KeyPackageの形式が不正です",
};

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
  attributedTo?: string;
  deviceId?: string;
}

export interface EncryptedMessage {
  id: string;
  roomId: string;
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
    const items = Array.isArray(data.items) ? data.items : [];
    const result: KeyPackage[] = [];
    for (const item of items) {
      if (typeof item.groupInfo === "string") {
        const bytes = decodeGroupInfo(item.groupInfo);
        if (!bytes || !(await verifyGroupInfo(bytes))) {
          delete item.groupInfo;
        }
      }
      const expected = typeof item.attributedTo === "string"
        ? item.attributedTo
        : domain
        ? `https://${domain}/users/${user}`
        : new URL(`/users/${user}`, globalThis.location.origin).href;
      if (!await verifyKeyPackage(item.content, expected)) {
        continue;
      }
      result.push(item as KeyPackage);
    }
    return result;
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
): Promise<{ keyId: string | null; groupInfo?: string }> => {
  try {
    const res = await apiFetch(
      `/api/users/${encodeURIComponent(user)}/keyPackages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pkg),
      },
    );
    if (!res.ok) {
      let msg = "KeyPackageの登録に失敗しました";
      try {
        const err = await res.json();
        if (typeof err.error === "string") {
          msg = bindingErrorMessages[err.error] ?? err.error;
        }
      } catch (_) {
        /* noop */
      }
      throw new Error(msg);
    }
    const data = await res.json();
    let gi = typeof data.groupInfo === "string" ? data.groupInfo : undefined;
    if (gi) {
      const bytes = decodeGroupInfo(gi);
      if (!bytes || !(await verifyGroupInfo(bytes))) {
        gi = undefined;
      }
    }
    return {
      keyId: typeof data.keyId === "string" ? data.keyId : null,
      groupInfo: gi,
    };
  } catch (err) {
    console.error("Error adding key package:", err);
    if (err instanceof Error) throw err;
    throw new Error("KeyPackageの登録に失敗しました");
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
    const data = await res.json();
    if (typeof data.groupInfo === "string") {
      const bytes = decodeGroupInfo(data.groupInfo);
      if (!bytes || !(await verifyGroupInfo(bytes))) {
        delete data.groupInfo;
      }
    }
    const expected = typeof data.attributedTo === "string"
      ? data.attributedTo
      : new URL(`/users/${user}`, globalThis.location.origin).href;
    if (!await verifyKeyPackage(data.content, expected)) {
      return null;
    }
    return data as KeyPackage;
  } catch (err) {
    console.error("Error fetching key package:", err);
    return null;
  }
};

// KeyPackage の URL を指定して Actor とのバインディングを検証しつつ取得する
export const fetchVerifiedKeyPackage = async (
  kpUrl: string,
  candidateActor?: string,
  record?: { accountId: string; roomId: string; leafIndex: number },
): Promise<RawKeyPackageInput | null> => {
  try {
    const res = await fetch(kpUrl, {
      headers: { Accept: "application/activity+json" },
    });
    if (!res.ok) return null;
    const kp = await res.json();
    if (
      typeof kp.attributedTo !== "string" ||
      typeof kp.content !== "string"
    ) {
      return null;
    }
    const actorId = kp.attributedTo;
    if (candidateActor && candidateActor !== actorId) return null;
    const actorRes = await fetch(actorId, {
      headers: { Accept: "application/activity+json" },
    });
    if (!actorRes.ok) return null;
    const actor = await actorRes.json();
    const kpId = typeof kp.id === "string" ? kp.id : kpUrl;
    let listed = false;
    const col = actor.keyPackages;
    if (Array.isArray(col)) {
      listed = col.includes(kpId);
    } else if (col && Array.isArray(col.items)) {
      listed = col.items.includes(kpId);
    }
    if (!listed) return null;
    if (!await verifyKeyPackage(kp.content, actorId)) return null;
    const b64ToBytes = (b64: string) => {
      const bin = atob(b64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    };
    const bytes = b64ToBytes(kp.content);
    const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
    const toHex = (arr: Uint8Array) =>
      Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
    const hashHex = toHex(new Uint8Array(hashBuffer));
    let ktIncluded = false;
    try {
      const origin = new URL(kpId).origin;
      const proofRes = await fetch(
        `${origin}/.well-known/key-transparency?hash=${hashHex}`,
      );
      if (proofRes.ok) {
        const proof = await proofRes.json();
        ktIncluded = Boolean(proof?.included);
      }
    } catch {
      // KT 検証に失敗しても致命的ではない
    }
    let fpr: string | undefined;
    const decoded = decodeMlsMessage(bytes, 0)?.[0];
    const key = (decoded?.keyPackage as {
      leafNode?: { signaturePublicKey?: Uint8Array };
    })?.leafNode?.signaturePublicKey;
    if (key) fpr = `p256:${toHex(key)}`;
    const result: RawKeyPackageInput = {
      content: kp.content,
      actor: actorId,
      deviceId: typeof kp.deviceId === "string" ? kp.deviceId : undefined,
      url: kpId,
      hash: hashHex,
      leafSignatureKeyFpr: fpr,
      fetchedAt: new Date().toISOString(),
      etag: res.headers.get("ETag") ?? undefined,
      kt: { included: ktIncluded },
    };
    if (record && fpr) {
      await appendKeyPackageRecords(record.accountId, record.roomId, [{
        kpUrl: kpId,
        actorId,
        leafIndex: record.leafIndex,
        credentialFingerprint: fpr,
        time: result.fetchedAt!,
        ktIncluded,
      }]);
    }
    return result;
  } catch (err) {
    console.error("KeyPackage の検証に失敗しました:", err);
    return null;
  }
};

export const fetchGroupInfo = async (
  user: string,
  keyId: string,
): Promise<string | null> => {
  try {
    const res = await apiFetch(
      `/api/users/${encodeURIComponent(user)}/keyPackages/${
        encodeURIComponent(keyId)
      }`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (typeof data.groupInfo === "string") {
      const bytes = decodeGroupInfo(data.groupInfo);
      if (bytes && (await verifyGroupInfo(bytes))) {
        return data.groupInfo;
      }
    }
    return null;
  } catch (err) {
    console.error("Error fetching group info:", err);
    return null;
  }
};

// RosterEvidence を検証する
export const importRosterEvidence = async (
  accountId: string,
  roomId: string,
  evidence: RosterEvidence,
  leafIndex = -1,
): Promise<boolean> => {
  try {
    const res = await fetch(evidence.keyPackageUrl, {
      headers: { Accept: "application/activity+json" },
    });
    if (!res.ok) return false;
    const kp = await res.json();
    if (typeof kp.content !== "string" || kp.attributedTo !== evidence.actor) {
      return false;
    }
    const b64ToBytes = (b64: string) => {
      const bin = atob(b64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    };
    const bytes = b64ToBytes(kp.content);
    const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
    const toHex = (arr: Uint8Array) =>
      Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
    const hashHex = toHex(new Uint8Array(hashBuffer));
    if (`sha256:${hashHex}` !== evidence.keyPackageHash) return false;
    const decoded = decodeMlsMessage(bytes, 0)?.[0];
    const key = (decoded?.keyPackage as {
      leafNode?: { signaturePublicKey?: Uint8Array };
    })?.leafNode?.signaturePublicKey;
    if (!key || `p256:${toHex(key)}` !== evidence.leafSignatureKeyFpr) {
      return false;
    }
    if (!await verifyKeyPackage(kp.content, evidence.actor)) return false;
    await appendKeyPackageRecords(accountId, roomId, [{
      kpUrl: evidence.keyPackageUrl,
      actorId: evidence.actor,
      leafIndex,
      credentialFingerprint: evidence.leafSignatureKeyFpr,
      time: evidence.fetchedAt,
      ktIncluded: false,
    }]);
    return true;
  } catch (err) {
    console.error("RosterEvidence の検証に失敗しました:", err);
    return false;
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
  roomId: string,
  from: string,
  data: {
    content: string;
    mediaType?: string;
    encoding?: string;
    attachments?: unknown[];
  },
): Promise<boolean> => {
  try {
    const payload: Record<string, unknown> = {
      from,
      content: data.content,
      mediaType: data.mediaType ?? "message/mls",
      encoding: data.encoding ?? "base64",
    };
    if (data.attachments) payload.attachments = data.attachments;
    const res = await apiFetch(
      `/api/rooms/${encodeURIComponent(roomId)}/messages`,
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
  roomId: string,
  member: string,
  params?: { limit?: number; before?: string; after?: string },
): Promise<EncryptedMessage[]> => {
  try {
    const search = new URLSearchParams();
    if (params?.limit) search.set("limit", String(params.limit));
    if (params?.before) search.set("before", params.before);
    if (params?.after) search.set("after", params.after);
    search.set("member", member);
    const query = search.toString();
    const url = `/api/rooms/${encodeURIComponent(roomId)}/messages${
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
  roomId: string;
  sender: string;
  recipients: string[];
  message: string;
  createdAt: string;
}

export const sendHandshake = async (
  roomId: string,
  from: string,
  content: string,
): Promise<boolean> => {
  try {
    const payload: Record<string, unknown> = {
      from,
      content,
      mediaType: "message/mls",
      encoding: "base64",
    };
    const res = await apiFetch(
      `/api/rooms/${encodeURIComponent(roomId)}/handshakes`,
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

export const removeRoomMembers = async (
  roomId: string,
  from: string,
  targets: string[],
): Promise<string | null> => {
  try {
    const res = await apiFetch(
      `/api/rooms/${encodeURIComponent(roomId)}/remove`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, targets }),
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.commit === "string" ? data.commit : null;
  } catch (err) {
    console.error("Error removing members:", err);
    return null;
  }
};

type UpdateResult = Awaited<ReturnType<typeof updateKey>>;

export const updateRoomKey = async (
  roomId: string,
  from: string,
  identity: string,
  state: StoredGroupState,
): Promise<UpdateResult | null> => {
  try {
    const records = await loadKeyPackageRecords(from, roomId);
    const rec = records.find((r) => r.actorId === identity);
    if (!rec) {
      throw new Error("保存済みの actorId と一致しません");
    }
    const res = await updateKey(state, identity);
    const content = encodePublicMessage(res.commit);
    const ok = await sendHandshake(roomId, from, content);
    if (!ok) return null;
    return res;
  } catch (err) {
    console.error("Error updating room key:", err);
    return null;
  }
};

export const joinGroupWithInfo = async (
  roomId: string,
  from: string,
  groupInfo: string,
  keyPair: GeneratedKeyPair,
): Promise<{ state: StoredGroupState } | null> => {
  try {
    const infoBytes = decodeGroupInfo(groupInfo);
    if (!infoBytes) return null;
    const res = await joinWithGroupInfo(infoBytes, keyPair);
    const ok = await sendHandshake(roomId, from, res.commit);
    if (!ok) return null;
    return { state: res.state };
  } catch (err) {
    console.error("Error joining with group info:", err);
    return null;
  }
};

export const fetchHandshakes = async (
  roomId: string,
  params?: { limit?: number; before?: string; after?: string },
): Promise<HandshakeMessage[]> => {
  try {
    const search = new URLSearchParams();
    if (params?.limit) search.set("limit", String(params.limit));
    if (params?.before) search.set("before", params.before);
    if (params?.after) search.set("after", params.after);
    const query = search.toString();
    const url = `/api/rooms/${encodeURIComponent(roomId)}/handshakes${
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
  deviceId: string,
): Promise<string | null> => {
  try {
    const res = await apiFetch(
      `/api/users/${encodeURIComponent(user)}/devices/${
        encodeURIComponent(deviceId)
      }/encryptedKeyPair`,
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
  deviceId: string,
  content: string,
): Promise<boolean> => {
  try {
    const res = await apiFetch(
      `/api/users/${encodeURIComponent(user)}/devices/${
        encodeURIComponent(deviceId)
      }/encryptedKeyPair`,
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
  deviceId: string,
): Promise<boolean> => {
  try {
    const res = await apiFetch(
      `/api/users/${encodeURIComponent(user)}/devices/${
        encodeURIComponent(deviceId)
      }/encryptedKeyPair`,
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
  lastMessageAt?: string;
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
    if (params?.participants?.length) {
      search.set("participants", params.participants.join(","));
    }
    if (params?.match) search.set("match", params.match);
    if (typeof params?.hasName === "boolean") {
      search.set("hasName", String(params.hasName));
    }
    if (typeof params?.hasIcon === "boolean") {
      search.set("hasIcon", String(params.hasIcon));
    }
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

export const addRoom = async (
  id: string,
  room: Room,
  handshake?: {
    from: string;
    content: string;
    mediaType?: string;
    encoding?: string;
  },
): Promise<boolean> => {
  try {
    const body: Record<string, unknown> = { owner: id, ...room };
    if (handshake) {
      body.handshake = {
        from: handshake.from,
        content: handshake.content,
        mediaType: handshake.mediaType ?? "message/mls",
        encoding: handshake.encoding ?? "base64",
      };
    }
    const res = await apiFetch(`/api/ap/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch (err) {
    console.error("Error adding room:", err);
    return false;
  }
};

export const updateRoomMember = async (
  roomId: string,
  action: "Add" | "Remove",
  member: string,
): Promise<boolean> => {
  try {
    const res = await apiFetch(`/api/ap/rooms/${roomId}/members`, {
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
  evidences?: RosterEvidence[];
}

export const sendProposal = async (
  roomId: string,
  from: string,
  proposal: MLSProposalPayload,
): Promise<boolean> => {
  const content = encodePublicMessage(
    new TextEncoder().encode(JSON.stringify(proposal)),
  );
  return await sendHandshake(roomId, from, content);
};

export const sendCommit = async (
  roomId: string,
  from: string,
  commit: MLSCommitPayload,
): Promise<boolean> => {
  const content = encodePublicMessage(
    new TextEncoder().encode(JSON.stringify(commit)),
  );
  const ok = await sendHandshake(roomId, from, content);
  if (!ok) return false;
  if (commit.welcomes) {
    for (const w of commit.welcomes) {
      const wContent = encodePublicMessage(
        new TextEncoder().encode(JSON.stringify(w)),
      );
      const success = await sendHandshake(roomId, from, wContent);
      if (!success) return false;
    }
  }
  if (commit.evidences) {
    for (const ev of commit.evidences) {
      const evContent = encodePublicMessage(
        new TextEncoder().encode(JSON.stringify(ev)),
      );
      const okEv = await sendHandshake(roomId, from, evContent);
      if (!okEv) return false;
      const verified = await importRosterEvidence(from, roomId, ev);
      if (verified) {
        await appendRosterEvidence(from, roomId, [ev]);
      }
    }
  }
  return true;
};
