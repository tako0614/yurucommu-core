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
  // ActivityPubのオブジェクト種別に準拠（簡易）
  // note: Note（本文中心、添付も可）
  // image: Image（本文なしでも可）
  // video: Video（本文なしでも可）
  // file: 汎用ファイル（Document相当、本文なしでも可）
  type: "note" | "image" | "video" | "file";
  avatar?: string;
  isMe?: boolean;
}

export interface Room {
  id: string;
  // 統一識別子（可能ならActor URL）。未設定時は id を使用
  uid?: string;
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
  type: "group" | "memo" | "dm";
  members?: ActorID[];
  hasName?: boolean;
  hasIcon?: boolean;
  // 招待中（未参加）の仮想ルームであることを示す
  pendingInvite?: boolean;
  // 追加メタ情報（通知IDやグループ名など）
  meta?: {
    notificationId?: string;
    groupName?: string;
    groupId?: string;
  };
}

// トークルームの種類を判定するユーティリティ関数
export function isFriendRoom(room: Room): boolean {
  // 明示的に dm タイプならフレンドルームとみなす
  if (room.type === "dm") return true;
  // メモは除外
  if (room.type === "memo") return false;
  return false;
}

export function isGroupRoom(room: Room): boolean {
  // group は type が明示的に group のもののみ
  return room.type === "group";
}

export function isMemoRoom(room: Room): boolean {
  return room.type === "memo";
}
