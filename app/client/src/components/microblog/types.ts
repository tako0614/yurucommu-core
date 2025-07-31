export interface MicroblogPost {
  id: string;
  content: string;
  userName: string;
  displayName: string;
  authorAvatar?: string;
  createdAt: string;
  likes: number;
  retweets: number;
  replies: number;
  isLiked?: boolean;
  isRetweeted?: boolean;
  images?: string[];
  attachments?: { url: string; type: "image" | "video" | "audio" }[];
  hashtags?: string[];
  mentions?: string[];
  parentId?: string; // 返信の場合の親投稿ID
  quoteId?: string; // 引用元投稿ID
  domain?: string;
}

export interface Note {
  id: string;
  content: string;
  userName: string;
  displayName: string;
  authorAvatar?: string;
  createdAt: string;
  likes: number;
  comments: number;
  isLiked?: boolean;
  images?: string[];
  isPinned?: boolean;
  domain?: string;
}

/**
 * ActivityPub Object 汎用型
 */
export interface ActivityPubObject {
  id: string;
  type: string; // Note, Image, Article など
  attributedTo: string;
  content?: string;
  to?: string[];
  cc?: string[];
  published: string;
  // deno-lint-ignore no-explicit-any
  extra?: Record<string, any>;
}

export function noteToPost(note: Note): MicroblogPost {
  return {
    id: note.id,
    content: note.content,
    userName: note.userName,
    displayName: note.displayName,
    authorAvatar: note.authorAvatar,
    createdAt: note.createdAt,
    likes: note.likes,
    retweets: 0, // Noteにretweetはない
    replies: note.comments,
    isLiked: note.isLiked,
    isRetweeted: false,
    domain: note.domain,
    // attachmentsやquoteIdなど、Noteにないものはデフォルト値を設定
  };
}
