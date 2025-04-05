export type User = {
  username: string;
  name: string;
  privateKey: string;
  iconBase64?: string;
};

export type Follower = {
  id: string;
  username: string;
  follower: string;
};

export type Message = {
  id: string;
  username: string;
  body: string;
  createdAt: Date;
  actor?: string; // 投稿者のアクターURI
  originalId?: string; // 元の投稿ID
  isRemote: boolean; // リモート投稿かどうか
  url?: string; // リモート投稿のURL
};

export type Like = {
  id: string;
  username: string; // いいねされた投稿の所有者
  targetId: string; // いいねされた投稿のID
  actor: string; // いいねをした人のアクターURI
  createdAt: Date;
  isRemote: boolean;
};
