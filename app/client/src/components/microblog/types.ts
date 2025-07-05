
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
  hashtags?: string[];
  mentions?: string[];
  parentId?: string; // 返信の場合の親投稿ID
  domain?: string;
}

export interface Story {
  id: string;
  author: string;
  content: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'video';
  createdAt: string;
  expiresAt: string;
  views: number;
  isViewed?: boolean;
  backgroundColor?: string;
  textColor?: string;
}

export interface Community {
  id: string;
  name: string;
  description: string;
  avatar?: string;
  banner?: string;
  memberCount: number;
  postCount: number;
  isJoined?: boolean;
  isPrivate?: boolean;
  tags?: string[];
  rules?: string[];
  createdAt: string;
  moderators?: string[];
}

export interface CommunityPost {
  id: string;
  communityId: string;
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
  type: string; // Note, Image, Article, Story, CommunityPost など
  attributedTo: string;
  content?: string;
  to?: string[];
  cc?: string[];
  published: string;
  extra?: Record<string, any>;
}
