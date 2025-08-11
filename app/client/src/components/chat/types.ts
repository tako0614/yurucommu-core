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
  return room.type !== "memo" && 
         (room.members?.length ?? 0) === 1 && // 相手一人のみ（自分は含まれていない）
         !(room.hasName || room.hasIcon);
}

export function isGroupRoom(room: Room): boolean {
  return room.type !== "memo" && !isFriendRoom(room);
}

export function isMemoRoom(room: Room): boolean {
  return room.type === "memo";
}
