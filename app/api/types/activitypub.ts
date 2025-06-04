// ActivityPub型定義

export interface ActivityPubActivity {
  "@context"?: string | string[];
  id: string;
  type: string;
  actor: string;
  object?: string | ActivityPubObject | unknown;
  target?: string;
  to?: string[];
  cc?: string[];
  published?: Date | string;
  content?: string;
  summary?: string;
  // 追加の任意プロパティ
  [key: string]: unknown;
}

export interface ActivityPubObject {
  "@context"?: string | string[];
  id: string;
  type: string;
  [key: string]: unknown;
}

export interface ActivityPubActor {
  "@context"?: string | string[];
  id: string;
  type: string;
  preferredUsername: string;
  name?: string;
  summary?: string;
  inbox: string;
  outbox: string;
  followers?: string;
  following?: string;
  publicKey?: {
    id: string;
    owner: string;
    publicKeyPem: string;
  };
  [key: string]: unknown;
}

export interface VerificationResult {
  valid: boolean;
  actorId?: string;
  activity?: ActivityPubActivity;
  error?: string;
}
