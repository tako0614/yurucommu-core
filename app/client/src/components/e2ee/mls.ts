// MLSヘルパー関数の継続実装
import { b64ToBuf, bufToB64 } from "../../../../shared/buffer.ts";
import { decodeMLSMessage, encodeMLSMessage } from "../../../../shared/mls_message.ts";
import { packWelcome, type ActorID } from "../../../../shared/mls_core.ts";

export interface MLSKeyPair {
  publicKey: string; // base64化した公開鍵
  privateKey: CryptoKey;
}

export interface MLSKeyPackage {
  id: string;
  data: string; // MLSライブラリ生成のKeyPackage（Base64）
}

export interface StoredMLSKeyPair {
  publicKey: string;
  privateKey: JsonWebKey;
  keyPackage?: MLSKeyPackage;
}

/**
 * ECDHで鍵ペアを生成する
 */
export const generateMLSKeyPair = async (): Promise<MLSKeyPair> => {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey"],
  );
  const raw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pub = bufToB64(raw);
  return { publicKey: pub, privateKey: keyPair.privateKey };
};

export const generateKeyPackage = async (): Promise<{
  keyPackage: MLSKeyPackage;
  keyPair: MLSKeyPair;
}> => {
  const pair = await generateMLSKeyPair();
  const raw = b64ToBuf(pair.publicKey);
  const encoded = encodeMLSMessage(
    "KeyPackage",
    new Uint8Array(raw),
  );
  const keyPackage: MLSKeyPackage = {
    id: crypto.randomUUID(),
    data: encoded,
  };
  return { keyPackage, keyPair: pair };
};

export const exportKeyPair = async (
  pair: MLSKeyPair,
  keyPackage?: MLSKeyPackage,
): Promise<StoredMLSKeyPair> => {
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey: pair.publicKey, privateKey: jwk, keyPackage };
};

export const importKeyPair = async (
  data: StoredMLSKeyPair,
): Promise<MLSKeyPair> => {
  const priv = await crypto.subtle.importKey(
    "jwk",
    data.privateKey,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey"],
  );
  return { publicKey: data.publicKey, privateKey: priv };
};

export const deriveMLSSecret = async (
  privateKey: CryptoKey,
  publicKeyB64: string,
): Promise<CryptoKey> => {
  const pub = await crypto.subtle.importKey(
    "raw",
    b64ToBuf(publicKeyB64),
    { name: "ECDH", namedCurve: "P-256" },
    true,
    [],
  );
  return await crypto.subtle.deriveKey(
    { name: "ECDH", public: pub },
    privateKey,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
};

/**
 * AES-GCM鍵を作成しグループ状態を保持
 */
export interface MLSGroupState {
  tree: Record<ActorID, string>;
  epoch: number;
  secret: CryptoKey;
}

export const createMLSGroup = async (
  tree: Record<ActorID, string>,
  epoch = 0,
): Promise<MLSGroupState> => {
  const secret = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  return { tree, epoch, secret };
};

export interface MLSProposal {
  type: "add" | "remove";
  member: ActorID;
  keyPackage?: MLSKeyPackage;
}
export const createCommit = (
  state: MLSGroupState,
  proposals: MLSProposal[],
): Uint8Array => {
  // Client-side placeholder: encode proposals with next epoch
  const body = {
    type: "commit",
    epoch: state.epoch + 1,
    proposals,
  } as const;
  return new TextEncoder().encode(JSON.stringify(body));
};

export const createWelcome = (
  state: MLSGroupState,
): Uint8Array => {
  // Encode minimal welcome data; real MLS would include group secrets per joiner
  return packWelcome({ members: Object.keys(state.tree), epoch: state.epoch });
};

export const applyWelcome = async (
  data: Uint8Array,
): Promise<MLSGroupState> => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const epoch = view.getUint32(0);
  const secretBytes = data.slice(4);
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "AES-GCM" },
    true,
    ["encrypt", "decrypt"],
  );
  return { tree: {}, epoch, secret: key };
};

export const applyCommit = async (
  _state: MLSGroupState,
  _commit: Uint8Array,
  welcome: Uint8Array,
): Promise<MLSGroupState> => {
  return await applyWelcome(welcome);
};

function strToBuf(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * MLSでにメッセージを暗号化
 */
export const encryptGroupMessage = async (
  group: MLSGroupState,
  plaintext: string,
): Promise<string> => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    group.secret,
    strToBuf(plaintext),
  );
  const payload = `${bufToB64(iv.buffer)}:${bufToB64(enc)}`;
  return encodeMLSMessage(
    "PrivateMessage",
    new TextEncoder().encode(payload),
  );
};

/**
 * 暗号化メッセージを解証
 */
export const decryptGroupMessage = async (
  group: MLSGroupState,
  cipher: string,
): Promise<string | null> => {
  const decoded = decodeMLSMessage(cipher);
  if (!decoded || decoded.type !== "PrivateMessage") return null;
  const payload = new TextDecoder().decode(decoded.body);
  const [ivB64, dataB64] = payload.split(":");
  if (!ivB64 || !dataB64) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBuf(ivB64) },
      group.secret,
      b64ToBuf(dataB64),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
};

export interface StoredMLSGroupState {
  tree: Record<ActorID, string>;
  epoch: number;
  secret: string;
}

/**
 * グループ状態を永続化できる形に変換
 */
export const exportGroupState = async (
  group: MLSGroupState,
): Promise<StoredMLSGroupState> => {
  const raw = await crypto.subtle.exportKey("raw", group.secret);
  const b64 = bufToB64(raw);
  return { tree: group.tree, epoch: group.epoch, secret: b64 };
};

/**
 * 永続化されたグループ状態から復元
 */
export const importGroupState = async (
  data: StoredMLSGroupState,
): Promise<MLSGroupState> => {
  const key = await crypto.subtle.importKey(
    "raw",
    b64ToBuf(data.secret),
    { name: "AES-GCM" },
    true,
    ["encrypt", "decrypt"],
  );
  return { tree: data.tree, epoch: data.epoch, secret: key };
};

// ----------------------
// Welcome 検証 (プレースホルダ)
// ----------------------
// Chat.tsx で `WelcomeMessage` 型と `verifyWelcome` が参照されているが、
// まだ未実装だったため最小限の型定義と構造検証のみ行う関数を追加する。
// 署名検証など本格的な MLS Welcome 署名 / 秘密共有検証は今後の実装で差し替え可能。

export interface WelcomeMessage {
  type: "welcome";
  epoch: number;
  members: string[]; // ActorID の配列
  suite?: number;
  roomId?: string;
  deviceId?: string;
  issuedAt?: number;
  // 署名や鍵マテリアル等、将来的な拡張フィールドを許容
  signatureB64?: string;
  [extra: string]: unknown; // 将来的な拡張で落ちないように
}

export interface VerifyWelcomeResult {
  valid: boolean;
  members?: string[];
  reason?: string; // デバッグ用: 無効理由
}

export function verifyWelcome(msg: WelcomeMessage): VerifyWelcomeResult {
  // 現状は構造レベルの最低限チェックのみ。
  if (!msg || typeof msg !== "object") {
    return { valid: false, reason: "not an object" };
  }
  if (msg.type !== "welcome") {
    return { valid: false, reason: "type mismatch" };
  }
  if (!Array.isArray(msg.members) || msg.members.some((m) => typeof m !== "string")) {
    return { valid: false, reason: "members invalid" };
  }
  if (typeof msg.epoch !== "number" || !Number.isFinite(msg.epoch)) {
    return { valid: false, reason: "epoch invalid" };
  }
  // issuedAt の緩い整合性 (未来すぎないか / 過去すぎないか) を軽くチェック可能だが
  // clock skew を考慮して現段階ではスキップ。
  return { valid: true, members: msg.members };
}
