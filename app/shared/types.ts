export interface AccountDoc {
  _id?: string;
  userName: string;
  displayName: string;
  avatarInitial: string;
  privateKey?: string;
  publicKey: string;
  followers?: string[];
  following?: string[];
  groups?: string[];
}

export interface SessionDoc {
  _id?: string;
  sessionId: string;
  deviceId: string;
  expiresAt: Date;
  createdAt?: Date;
  lastDecryptAt?: Date;
}

export interface DirectMessageDoc {
  _id?: string;
  owner: string;
  id: string;
  name: string;
  icon?: string;
  members: string[];
}

export interface GroupDoc {
  _id?: string;
  groupName: string;
  displayName: string;
  summary?: string;
  icon?: unknown;
  image?: unknown;
  membershipPolicy?: string;
  visibility?: string;
  allowInvites?: boolean;
  followers: string[];
  outbox: unknown[];
  privateKey?: string;
  publicKey: string;
}

export interface ListedGroup {
  id: string;
  name: string;
  icon?: unknown;
  members: string[];
}
