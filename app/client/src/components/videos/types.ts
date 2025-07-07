export interface Video {
  id: string;
  title: string;
  author: string;
  authorAvatar: string;
  thumbnail: string;
  duration: string;
  views: number;
  likes: number;
  timestamp: string;
  isShort: boolean;
  description?: string;
  hashtags?: string[];
}
