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
}
