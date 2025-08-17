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
  // 画面表示用の名称（未命名DMなどの補完に使用）。name はサーバー由来の正規名。
  displayName?: string;
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
  // メモは除外
  if (room.type === "memo") return false;
  const count = room.members?.length ?? 0; // 自分を除いた他参加者数（Chat 側で self を除去して格納）
  // 1 名（自分以外）がいる＝1:1 ルームとみなす（名称/アイコン有無に依らず友だち扱い）
  if (count === 1) return true;
  // 未同期で members がまだ空でも、ID が @ を含む（= actor handle 形式）なら暫定的に 1:1 とする
  if (count === 0 && typeof room.id === "string" && room.id.includes("@")) return true;
  return false;
}

export function isGroupRoom(room: Room): boolean {
  return room.type !== "memo" && !isFriendRoom(room);
}

export function isMemoRoom(room: Room): boolean {
  return room.type === "memo";
}
