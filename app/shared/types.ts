export interface AccountDoc {
  _id?: string;
  userName: string;
  displayName: string;
  avatarInitial: string;
  privateKey?: string;
  publicKey: string;
  followers?: string[];
  following?: string[];
  dms?: string[];
}

export interface SessionDoc {
  _id?: string;
  sessionId: string;
  expiresAt: Date;
  createdAt?: Date;
}
