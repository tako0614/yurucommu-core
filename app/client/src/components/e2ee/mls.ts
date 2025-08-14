// MLSヘルパー関数の継続実装
import { b64ToBuf, bufToB64 } from "../../../../shared/buffer.ts";
import {
  decodePrivateMessage,
  encodeKeyPackage,
  encodePrivateMessage,
} from "../../../../shared/mls_message.ts";
import {
  type ActorID,
  type KeyPackageBody,
  signKeyPackage,
} from "../../../../shared/mls_core.ts";

export interface MLSKeyPair {
  publicKey: string; // base64化した公開鍵
  privateKey: CryptoKey; // ECDH 用秘密鍵
  signKey: CryptoKey; // ECDSA 署名用秘密鍵
}

export interface MLSKeyPackage {
  id: string;
  data: string; // MLSライブラリ生成のKeyPackage（Base64）
}

export interface StoredMLSKeyPair {
  publicKey: string;
  privateKey: JsonWebKey; // ECDH 用
  signKey: JsonWebKey;
  keyPackage?: MLSKeyPackage;
}

/**
 * ECDHで鍵ペアを生成する
 */
export const generateMLSKeyPair = async (): Promise<MLSKeyPair> => {
  const signPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const raw = await crypto.subtle.exportKey("raw", signPair.publicKey);
  const pub = bufToB64(raw);
  const jwk = await crypto.subtle.exportKey("jwk", signPair.privateKey);
  if ("key_ops" in jwk) delete jwk.key_ops;
  const priv = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey", "deriveBits"],
  );
  return { publicKey: pub, privateKey: priv, signKey: signPair.privateKey };
};

export const generateKeyPackage = async (
  suite = 1,
): Promise<{ keyPackage: MLSKeyPackage; keyPair: MLSKeyPair }> => {
  const pair = await generateMLSKeyPair();
  const body: KeyPackageBody = {
    version: 1,
    suite,
    initKey: pair.publicKey,
    credential: { publicKey: pair.publicKey },
    capabilities: { cipherSuites: [suite] },
  };
  const signed = await signKeyPackage(body, pair.signKey);
  const encoded = encodeKeyPackage(JSON.stringify(signed));
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
  const signJwk = await crypto.subtle.exportKey("jwk", pair.signKey);
  return {
    publicKey: pair.publicKey,
    privateKey: jwk,
    signKey: signJwk,
    keyPackage,
  };
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
  const signKey = await crypto.subtle.importKey(
    "jwk",
    data.signKey,
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign"],
  );
  return { publicKey: data.publicKey, privateKey: priv, signKey };
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

// ----------------------
// Key Schedule / Secret Tree
// ----------------------

async function hkdf(
  secret: Uint8Array,
  label: string,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", secret, "HKDF", false, [
    "deriveBits",
  ]);
  const info = new TextEncoder().encode(label);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", info, salt: new Uint8Array() },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

interface SecretNode {
  secret: Uint8Array;
  generation: number;
}

async function buildSecretTree(
  root: Uint8Array,
  members: ActorID[],
): Promise<Record<ActorID, SecretNode>> {
  const tree: Record<ActorID, SecretNode> = {};
  for (const m of members) {
    const leaf = await hkdf(root, `member:${m}`, 32);
    tree[m] = { secret: leaf, generation: 0 };
  }
  return tree;
}

async function deriveMessageSecrets(
  node: SecretNode,
  target?: number,
): Promise<{ key: CryptoKey; nonce: Uint8Array; generation: number }> {
  if (typeof target === "number") {
    while (node.generation < target) {
      node.secret = await hkdf(node.secret, "ratchet", 32);
      node.generation++;
    }
  }
  const generation = node.generation;
  const keyBytes = await hkdf(node.secret, "key", 32);
  const nonce = await hkdf(node.secret, "nonce", 12);
  node.secret = await hkdf(node.secret, "ratchet", 32);
  node.generation++;
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
  return { key, nonce, generation };
}

/**
 * グループ状態を保持
 */
export interface MLSGroupState {
  selfId: ActorID;
  members: ActorID[];
  epoch: number;
  suite: number;
  groupKey: string; // base64 化したグループ公開鍵
  rootSecret: Uint8Array;
  secretTree: Record<ActorID, SecretNode>;
  pending: MLSProposal[];
}

export const createMLSGroup = async (
  selfId: ActorID,
  members: ActorID[],
  epoch = 0,
  root?: Uint8Array,
  suite = 0,
  groupKey = "",
): Promise<MLSGroupState> => {
  const rootSecret = root ?? crypto.getRandomValues(new Uint8Array(32));
  const tree = await buildSecretTree(rootSecret, members);
  return {
    selfId,
    members,
    epoch,
    suite,
    groupKey,
    rootSecret,
    secretTree: tree,
    pending: [],
  };
};

export interface MLSProposal {
  type: "add" | "remove";
  member: ActorID;
  keyPackage?: MLSKeyPackage;
}

export const applyProposal = (
  state: MLSGroupState,
  proposal: MLSProposal,
) => {
  state.pending.push(proposal);
};

export const createCommit = (state: MLSGroupState): Uint8Array => {
  const body = {
    type: "commit",
    epoch: state.epoch + 1,
    secret: bufToB64(state.rootSecret),
    proposals: state.pending,
    members: state.members,
    suite: state.suite,
    group: state.groupKey,
  } as const;
  return new TextEncoder().encode(JSON.stringify(body));
};

export const createWelcome = (state: MLSGroupState): Uint8Array => {
  const body = {
    type: "welcome",
    epoch: state.epoch,
    members: state.members,
    suite: state.suite,
    group: state.groupKey,
    secret: bufToB64(state.rootSecret),
    issuedAt: Date.now(),
  } as const;
  return new TextEncoder().encode(JSON.stringify(body));
};

export const applyWelcome = async (
  selfId: ActorID,
  data: Uint8Array,
): Promise<MLSGroupState> => {
  const obj = JSON.parse(new TextDecoder().decode(data)) as {
    epoch: number;
    members: ActorID[];
    secret: string;
    suite?: number;
    group?: string;
  };
  const root = b64ToBuf(obj.secret);
  return await createMLSGroup(
    selfId,
    obj.members,
    obj.epoch,
    root,
    obj.suite ?? 0,
    obj.group ?? "",
  );
};

export const applyCommit = async (
  state: MLSGroupState,
  commit: Uint8Array,
): Promise<MLSGroupState> => {
  const obj = JSON.parse(new TextDecoder().decode(commit)) as {
    epoch: number;
    members: ActorID[];
    secret: string;
    proposals?: MLSProposal[];
  };
  const members = obj.members ?? state.members;
  const root = obj.secret ? b64ToBuf(obj.secret) : state.rootSecret;
  const tree = await buildSecretTree(root, members);
  return {
    selfId: state.selfId,
    members,
    epoch: obj.epoch,
    suite: state.suite,
    groupKey: state.groupKey,
    rootSecret: root,
    secretTree: tree,
    pending: [],
  };
};

function strToBuf(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * MLSでメッセージを暗号化
 */
export const encryptGroupMessage = async (
  group: MLSGroupState,
  plaintext: string,
): Promise<string> => {
  const node = group.secretTree[group.selfId];
  const { key, nonce, generation } = await deriveMessageSecrets(node);
  const enc = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    strToBuf(plaintext),
  );
  const payload = JSON.stringify({
    sender: group.selfId,
    generation,
    ciphertext: bufToB64(enc),
  });
  return encodePrivateMessage(new TextEncoder().encode(payload));
};

/**
 * 暗号化メッセージを復号
 */
export const decryptGroupMessage = async (
  group: MLSGroupState,
  cipher: string,
): Promise<string | null> => {
  const body = decodePrivateMessage(cipher);
  if (!body) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(body)) as {
      sender: ActorID;
      generation: number;
      ciphertext: string;
    };
    const node = group.secretTree[parsed.sender];
    if (!node) return null;
    const { key, nonce } = await deriveMessageSecrets(node, parsed.generation);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce },
      key,
      b64ToBuf(parsed.ciphertext),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
};

export interface StoredMLSGroupState {
  selfId: ActorID;
  members: ActorID[];
  epoch: number;
  suite: number;
  groupKey: string;
  rootSecret: string;
  tree: Record<ActorID, { secret: string; generation: number }>;
}

/**
 * グループ状態を永続化できる形に変換
 */
export const exportGroupState = (
  group: MLSGroupState,
): StoredMLSGroupState => {
  const tree: Record<ActorID, { secret: string; generation: number }> = {};
  for (const [id, node] of Object.entries(group.secretTree)) {
    tree[id] = { secret: bufToB64(node.secret), generation: node.generation };
  }
  return {
    selfId: group.selfId,
    members: group.members,
    epoch: group.epoch,
    suite: group.suite,
    groupKey: group.groupKey,
    rootSecret: bufToB64(group.rootSecret),
    tree,
  };
};

/**
 * 永続化されたグループ状態から復元
 */
export const importGroupState = (
  data: StoredMLSGroupState,
): MLSGroupState => {
  const tree: Record<ActorID, SecretNode> = {};
  for (const [id, node] of Object.entries(data.tree)) {
    tree[id] = { secret: b64ToBuf(node.secret), generation: node.generation };
  }
  return {
    selfId: data.selfId,
    members: data.members,
    epoch: data.epoch,
    suite: data.suite,
    groupKey: data.groupKey,
    rootSecret: b64ToBuf(data.rootSecret),
    secretTree: tree,
    pending: [],
  };
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
  suite: number;
  group: string; // base64 化したグループ公開鍵
  secret: string; // HPKE で共有されたルートシークレット
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
  group?: MLSGroupState;
  error?: string; // デバッグ用: 無効理由
}

export async function verifyWelcome(
  selfId: ActorID,
  pair: MLSKeyPair,
  msg: WelcomeMessage,
  expectedGroup: string,
  suite: number,
): Promise<VerifyWelcomeResult> {
  if (!msg || typeof msg !== "object") {
    return { valid: false, error: "オブジェクトではありません" };
  }
  if (msg.type !== "welcome") {
    return { valid: false, error: "type フィールドが不正です" };
  }
  if (msg.suite !== suite) {
    return { valid: false, error: "suite が一致しません" };
  }
  if (msg.group !== expectedGroup) {
    return { valid: false, error: "グループ公開鍵が一致しません" };
  }
  if (
    !Array.isArray(msg.members) ||
    msg.members.some((m) => typeof m !== "string")
  ) {
    return { valid: false, error: "members フィールドが不正です" };
  }
  if (typeof msg.epoch !== "number" || !Number.isFinite(msg.epoch)) {
    return { valid: false, error: "epoch フィールドが不正です" };
  }
  if (typeof msg.secret !== "string") {
    return { valid: false, error: "secret が存在しません" };
  }
  try {
    const pub = await crypto.subtle.importKey(
      "raw",
      b64ToBuf(msg.group),
      { name: "ECDH", namedCurve: "P-256" },
      true,
      [],
    );
    const shared = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "ECDH", public: pub },
        pair.privateKey,
        256,
      ),
    );
    const provided = b64ToBuf(msg.secret);
    if (bufToB64(shared) !== bufToB64(provided)) {
      return { valid: false, error: "共有秘密が一致しません" };
    }
    const group = await createMLSGroup(
      selfId,
      msg.members,
      msg.epoch,
      provided,
      suite,
      msg.group,
    );
    return { valid: true, members: msg.members, group };
  } catch (err) {
    return { valid: false, error: `検証中にエラー: ${err}` };
  }
}
