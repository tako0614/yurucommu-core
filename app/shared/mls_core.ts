// Minimal MLS adapter for Deno/Browser environments
// これは暫定的な実装であり、将来的に本格的な MLS ライブラリに置き換えられる想定です。

import { b64ToBuf, bufToB64 } from "./buffer.ts";
import { decodeKeyPackage } from "./mls_message.ts";

export interface KeyPackageBody {
  version: number;
  suite: number;
  initKey: string; // HPKE 公開鍵（base64）
  credential: { publicKey: string };
  capabilities: { cipherSuites: number[] };
}

export interface KeyPackage extends KeyPackageBody {
  signature: string; // 署名（base64）
}

export async function signKeyPackage(
  body: KeyPackageBody,
  signKey: CryptoKey,
): Promise<KeyPackage> {
  const data = new TextEncoder().encode(JSON.stringify(body));
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signKey, data),
  );
  return { ...body, signature: bufToB64(sig) };
}

export async function verifyKeyPackage(pkg: KeyPackage): Promise<boolean> {
  try {
    const { signature, ...body } = pkg;
    const data = new TextEncoder().encode(JSON.stringify(body));
    const pub = await crypto.subtle.importKey(
      "raw",
      b64ToBuf(pkg.credential.publicKey),
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["verify"],
    );
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pub,
      b64ToBuf(signature),
      data,
    );
  } catch {
    return false;
  }
}

export type ActorID = string;

export interface RawKeyPackageInput {
  // ActivityPub 経由で取得した KeyPackage （Base64）
  content: string;
  actor?: ActorID;
  deviceId?: string;
}

export interface WelcomeEntry {
  actor?: ActorID;
  deviceId?: string;
  data: Uint8Array; // encodeWelcome(...) でラップする前の生データ
}

export interface StoredGroupState {
  suite: number;
  epoch: number;
  publicKey: string; // base64
  privateKey: JsonWebKey;
  tree: Record<ActorID, unknown>;
}

/**
 * HPKE/ECDH を用いてグループ秘密を配布するための状態
 */
export class MLSGroupState {
  suite: number;
  epoch: number;
  privateKey: CryptoKey;
  publicKey: Uint8Array;
  tree: Record<ActorID, unknown>;

  private constructor(
    suite: number,
    epoch: number,
    key: CryptoKey,
    pub: Uint8Array,
    members: ActorID[],
  ) {
    this.suite = suite;
    this.epoch = epoch;
    this.privateKey = key;
    this.publicKey = pub;
    this.tree = {};
    for (const m of members) this.tree[m] = {};
  }

  /**
   * 初期グループ状態を生成
   */
  static async init(
    suite: number,
    members: ActorID[],
    epoch = 0,
  ): Promise<MLSGroupState> {
    const pair = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    );
    const pub = new Uint8Array(
      await crypto.subtle.exportKey("raw", pair.publicKey),
    );
    return new MLSGroupState(suite, epoch, pair.privateKey, pub, members);
  }

  /**
   * 永続化された状態から復元
   */
  static async fromStored(data: StoredGroupState): Promise<MLSGroupState> {
    const priv = await crypto.subtle.importKey(
      "jwk",
      data.privateKey,
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    );
    const pub = b64ToBuf(data.publicKey);
    const members = Object.keys(data.tree);
    const state = new MLSGroupState(data.suite, data.epoch, priv, pub, members);
    state.tree = data.tree;
    return state;
  }

  /**
   * 状態を永続化形式へ変換
   */
  async export(): Promise<StoredGroupState> {
    const jwk = await crypto.subtle.exportKey("jwk", this.privateKey);
    return {
      suite: this.suite,
      epoch: this.epoch,
      publicKey: bufToB64(this.publicKey),
      privateKey: jwk,
      tree: this.tree,
    };
  }

  /**
   * 新規メンバーを追加し、Commit と Welcome を生成
   */
  async addMembers(
    addKeyPackages: RawKeyPackageInput[],
  ): Promise<{ commit: Uint8Array; welcomes: WelcomeEntry[]; epoch: number }> {
    const added: ActorID[] = [];
    const welcomes: WelcomeEntry[] = [];
    const nextEpoch = this.epoch + 1;

    for (const kp of addKeyPackages) {
      try {
        const kpBody = decodeKeyPackage(kp.content);
        if (!kpBody) continue;
        const text = new TextDecoder().decode(kpBody);
        const obj = JSON.parse(text) as KeyPackage;
        if (!(await verifyKeyPackage(obj))) continue;
        if (obj.suite !== this.suite) continue;
        const pubRaw = b64ToBuf(obj.initKey);
        const pub = await crypto.subtle.importKey(
          "raw",
          pubRaw,
          { name: "ECDH", namedCurve: "P-256" },
          true,
          [],
        );
        const secret = new Uint8Array(
          await crypto.subtle.deriveBits(
            { name: "ECDH", public: pub },
            this.privateKey,
            256,
          ),
        );
        if (kp.actor) {
          this.tree[kp.actor] = {};
          added.push(kp.actor);
        }
        const membersNow = Object.keys(this.tree);
        const welcomeBody = {
          type: "welcome",
          suite: this.suite,
          epoch: nextEpoch,
          group: bufToB64(this.publicKey),
          secret: bufToB64(secret),
          members: membersNow,
          actor: kp.actor,
          deviceId: kp.deviceId,
          issuedAt: Date.now(),
        } as const;
        welcomes.push({
          actor: kp.actor,
          deviceId: kp.deviceId,
          data: new TextEncoder().encode(JSON.stringify(welcomeBody)),
        });
      } catch {
        continue;
      }
    }

    const members = Object.keys(this.tree);
    const commitBody = {
      type: "commit",
      suite: this.suite,
      epoch: nextEpoch,
      members,
      added,
    } as const;
    const commit = new TextEncoder().encode(JSON.stringify(commitBody));
    this.epoch = nextEpoch;
    return { commit, welcomes, epoch: this.epoch };
  }
}

/**
 * 永続化された状態をもとに Commit / Welcome を生成
 */
export async function createCommitAndWelcomes(
  suite: number,
  members: ActorID[],
  addKeyPackages: RawKeyPackageInput[],
  stored?: StoredGroupState | null,
): Promise<{
  commit: Uint8Array;
  welcomes: WelcomeEntry[];
  state: StoredGroupState;
}> {
  const group = stored
    ? await MLSGroupState.fromStored(stored)
    : await MLSGroupState.init(suite, members);
  const { commit, welcomes } = await group.addMembers(addKeyPackages);
  const state = await group.export();
  return { commit, welcomes, state };
}
