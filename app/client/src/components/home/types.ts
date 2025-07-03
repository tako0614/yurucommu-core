export type Account = {
  id: string;
  userName: string;
  displayName: string;
  avatarInitial: string;
  publicKey?: string;
  followers?: string[];
  following?: string[];
};

export const isDataUrl = (str: string) => str.startsWith("data:image/");
