// MLSヘルパー関数の継続実装
import { b64ToBuf, bufToB64 } from "../../../../shared/buffer.ts";

type ActorID = string;

export interface MLSKeyPair {
  publicKey: string; // base64化した公開鍵
  privateKey: CryptoKey;
}

export interface MLSKeyPackage {
  id: string;
  key: string; // 公開鍵を含むKeyPackage
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
  const keyPackage: MLSKeyPackage = {
    id: crypto.randomUUID(),
    key: pair.publicKey,
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

export interface MLSCommit {
  epoch: number;
  proposals: MLSProposal[];
}

export interface MLSWelcome {
  epoch: number;
  tree: Record<ActorID, string>;
  secret: string;
}

export const createCommit = (
  state: MLSGroupState,
  proposals: MLSProposal[],
): MLSCommit => ({
  epoch: state.epoch + 1,
  proposals,
});

export const createWelcome = async (
  state: MLSGroupState,
): Promise<MLSWelcome> => {
  const raw = await crypto.subtle.exportKey("raw", state.secret);
  return {
    epoch: state.epoch,
    tree: state.tree,
    secret: bufToB64(raw),
  };
};

export const applyWelcome = async (
  welcome: MLSWelcome,
): Promise<MLSGroupState> => {
  const key = await crypto.subtle.importKey(
    "raw",
    b64ToBuf(welcome.secret),
    { name: "AES-GCM" },
    true,
    ["encrypt", "decrypt"],
  );
  return { tree: welcome.tree, epoch: welcome.epoch, secret: key };
};

export const applyCommit = async (
  _state: MLSGroupState,
  commit: MLSCommit,
  welcome: MLSWelcome,
): Promise<MLSGroupState> => {
  if (commit.epoch !== welcome.epoch) {
    return _state;
  }
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

export interface WelcomeMessage {
  groupInfo: string;
  signature: string;
  signerKey: string;
}

export const verifyWelcome = async (
  msg: WelcomeMessage,
): Promise<{ valid: boolean; members?: ActorID[] }> => {
  try {
    const infoStr = new TextDecoder().decode(b64ToBuf(msg.groupInfo));
    const info = JSON.parse(infoStr) as { members?: ActorID[] };
    if (!Array.isArray(info.members)) return { valid: false };
    const key = await crypto.subtle.importKey(
      "raw",
      b64ToBuf(msg.signerKey),
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      b64ToBuf(msg.signature),
      strToBuf(infoStr),
    );
    if (!ok) return { valid: false };
    return { valid: true, members: info.members };
  } catch {
    return { valid: false };
  }
};
