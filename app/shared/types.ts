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

export interface RelayDoc {
  _id: string;
  host: string;
  inboxUrl: string;
}

export interface SessionDoc {
  _id?: string;
  sessionId: string;
  expiresAt: Date;
  createdAt?: Date;
}
