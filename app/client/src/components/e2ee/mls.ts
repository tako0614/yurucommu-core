// MLSヘルパー関数の継続実装

export interface MLSKeyPair {
  publicKey: string; // base64化した公開鍵
  privateKey: CryptoKey;
}

export interface StoredMLSKeyPair {
  publicKey: string;
  privateKey: JsonWebKey;
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
  const pub = btoa(String.fromCharCode(...new Uint8Array(raw)));
  return { publicKey: pub, privateKey: keyPair.privateKey };
};

export const exportKeyPair = async (
  pair: MLSKeyPair,
): Promise<StoredMLSKeyPair> => {
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey: pair.publicKey, privateKey: jwk };
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
  members: string[];
  epoch: number;
  secret: CryptoKey;
}

export const createMLSGroup = async (
  members: string[],
): Promise<MLSGroupState> => {
  const secret = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  return { members, epoch: Date.now(), secret };
};

function strToBuf(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function bufToB64(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
  return btoa(String.fromCharCode(...u8));
}

function b64ToBuf(b64: string): Uint8Array {
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/**
 * MLS風にメッセージを暗号化
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
  return `${bufToB64(iv.buffer)}:${bufToB64(enc)}`;
};

/**
 * 暗号化メッセージを解証
 */
export const decryptGroupMessage = async (
  group: MLSGroupState,
  cipher: string,
): Promise<string | null> => {
  const [ivB64, dataB64] = cipher.split(":");
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
  members: string[];
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
  return { members: group.members, epoch: group.epoch, secret: b64 };
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
  return { members: data.members, epoch: data.epoch, secret: key };
};
