export type Account = {
  id: string;
  userName: string;
  displayName: string;
  avatarInitial: string;
  publicKey?: string;
  followers?: string[];
  following?: string[];
};

export type Notification = {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  createdAt: string;
};

export const isDataUrl = (str: string) => str.startsWith("data:image/");
