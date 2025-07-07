// MLSヘルパー関数の継続実装

export interface MLSKeyPair {
  publicKey: string; // base64化した公開鍵
  privateKey: CryptoKey;
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
  return `${bufToB64(iv)}:${bufToB64(enc)}`;
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
