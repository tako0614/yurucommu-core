export type ActorID = string;

export interface ChatMessage {
  id: string;
  author: string;
  displayName: string;
  address: string;
  content: string;
  attachments?: {
    data?: string;
    url?: string;
    mediaType: string;
    preview?: { url?: string; data?: string; mediaType?: string };
  }[];
  timestamp: Date;
  type: "text" | "image" | "file";
  avatar?: string;
  isMe?: boolean;
}

export interface Room {
  id: string;
  name: string;
  userName: string;
  domain: string;
  lastMessage?: string;
  lastMessageTime?: Date;
  unreadCount: number;
  isOnline?: boolean;
  avatar?: string;
  type: "group" | "memo";
  members: ActorID[];
  hasName?: boolean;
  hasIcon?: boolean;
}

// トークルームの種類を判定するユーティリティ関数
export function isFriendRoom(room: Room): boolean {
  if (room.type === "memo") return false;
  if (room.hasName || room.hasIcon) return false;
  const count = room.members?.length ?? 0;
  // MLS 同期済み: 相手だけが 1 名
  if (count === 1) return true;
  // 未同期でも、ID がハンドル形式なら 1:1 とみなす（暫定表示）
  if (count === 0 && typeof room.id === "string" && room.id.includes("@")) {
    return true;
  }
  return false;
}

export function isGroupRoom(room: Room): boolean {
  return room.type !== "memo" && !isFriendRoom(room);
}

export function isMemoRoom(room: Room): boolean {
  return room.type === "memo";
}
