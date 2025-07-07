export type Author = {
  userName: string;
  domain: string;
  displayName?: string;
  avatar?: string | null;
};

export type Post = {
  id: string;
  content: string;
  createdAt: string;
  media: {
    url: string;
    type: string;
  }[];
  author: Author;
  stats: {
    likes: number;
    hasLiked: boolean;
  };
  isRemote: boolean;
};

export type Story = {
  id: string;
  mediaUrl: string;
  mediaType: string;
  createdAt: string;
  expiresAt: string;
  author: Author & { displayName: string };
  viewed: boolean;
  isRemote: boolean;
};
