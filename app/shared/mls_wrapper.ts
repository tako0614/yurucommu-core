// ts-mls のラッパーモジュール

import {
  acceptAll,
  bytesToBase64,
  type CiphersuiteName,
  type ClientState,
  createApplicationMessage,
  createCommit,
  createGroup,
  createGroupInfoWithExternalPubAndRatchetTree,
  decodeMlsMessage,
  defaultCapabilities,
  defaultLifetime,
  emptyPskIndex,
  encodeMlsMessage,
  generateKeyPackage as tsGenerateKeyPackage,
  getCiphersuiteFromName,
  getCiphersuiteImpl,
  getSignaturePublicKeyFromLeafIndex,
  joinGroup,
  joinGroupExternal,
  type KeyPackage,
  makePskIndex,
  type PrivateKeyPackage,
  processPrivateMessage,
  processPublicMessage,
  type Proposal,
  type PublicMessage,
  ratchetTreeFromExtension,
  verifyGroupInfoSignature,
} from "ts-mls";
import "@noble/curves/p256";
import { encodePublicMessage } from "./mls_message.ts";

export type StoredGroupState = ClientState;

export interface GeneratedKeyPair {
  public: KeyPackage;
  private: PrivateKeyPackage;
  encoded: string;
}

export interface RawKeyPackageInput {
  content: string;
  actor?: string;
  deviceId?: string;
}

export interface WelcomeEntry {
  actor?: string;
  deviceId?: string;
  data: Uint8Array;
}

const DEFAULT_SUITE: CiphersuiteName =
  "MLS_128_DHKEMP256_AES128GCM_SHA256_P256";

async function getSuite(name: CiphersuiteName) {
  return await getCiphersuiteImpl(getCiphersuiteFromName(name));
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function buildPskIndex(
  state: StoredGroupState | undefined,
  psks?: Record<string, string>,
) {
  if (!psks) return emptyPskIndex;
  const map: Record<string, Uint8Array> = {};
  for (const [id, secret] of Object.entries(psks)) {
    map[id] = b64ToBytes(secret);
  }
  return makePskIndex(state, map);
}

export async function generateKeyPair(
  identity: string,
  suite: CiphersuiteName = DEFAULT_SUITE,
): Promise<GeneratedKeyPair> {
  const cs = await getSuite(suite);
  const credential = {
    credentialType: "basic",
    identity: new TextEncoder().encode(identity),
  };
  const { publicPackage, privatePackage } = await tsGenerateKeyPackage(
    credential,
    defaultCapabilities(),
    defaultLifetime,
    [],
    cs,
  );
  const encoded = bytesToBase64(
    encodeMlsMessage({
      version: "mls10",
      wireformat: "mls_key_package",
      keyPackage: publicPackage,
    }),
  );
  return { public: publicPackage, private: privatePackage, encoded };
}

export async function verifyKeyPackage(
  pkg:
    | string
    | {
      credential: { publicKey: string; identity?: string };
      signature: string;
    }
      & Record<string, unknown>,
  expectedIdentity?: string,
): Promise<boolean> {
  if (typeof pkg === "string") {
    const decoded = decodeMlsMessage(b64ToBytes(pkg), 0)?.[0];
    if (!decoded || decoded.wireformat !== "mls_key_package") {
      return false;
    }
    if (expectedIdentity) {
      try {
        const id = new TextDecoder().decode(
          decoded.keyPackage.credential.identity,
        );
        if (id !== expectedIdentity) return false;
      } catch {
        return false;
      }
    }
    return true;
  }
  try {
    const { signature, ...body } = pkg;
    const b = body as { credential?: { identity?: string } };
    if (
      expectedIdentity &&
      typeof b.credential?.identity === "string" &&
      b.credential.identity !== expectedIdentity
    ) {
      return false;
    }
    const data = new TextEncoder().encode(JSON.stringify(body));
    const pub = await crypto.subtle.importKey(
      "raw",
      b64ToBytes(pkg.credential.publicKey),
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["verify"],
    );
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pub,
      b64ToBytes(signature),
      data,
    );
  } catch {
    return false;
  }
}

export async function verifyCommit(
  state: StoredGroupState,
  message: PublicMessage,
  suite: CiphersuiteName = DEFAULT_SUITE,
  psks?: Record<string, string>,
): Promise<boolean> {
  if (!message.content.commit) return false;
  try {
    const cs = await getSuite(suite);
    const cloned = structuredClone(state);
    await processPublicMessage(
      cloned,
      message,
      buildPskIndex(state, psks),
      cs,
      acceptAll,
    );
    return true;
  } catch {
    return false;
  }
}

export async function verifyWelcome(
  data: Uint8Array,
  suite: CiphersuiteName = DEFAULT_SUITE,
  psks?: Record<string, string>,
): Promise<boolean> {
  try {
    const decoded = decodeMlsMessage(data, 0)?.[0];
    if (!decoded || decoded.wireformat !== "mls_welcome") {
      return false;
    }
    const cs = await getSuite(suite);
    // joinGroup が失敗しないことを確認するためダミーの鍵ペアで参加を試みる
    const kp = await generateKeyPair("verify", suite);
    await joinGroup(
      decoded.welcome,
      kp.public,
      kp.private,
      buildPskIndex(undefined, psks),
      cs,
    );
    return true;
  } catch {
    return false;
  }
}

export async function verifyGroupInfo(
  data: Uint8Array,
  suite: CiphersuiteName = DEFAULT_SUITE,
): Promise<boolean> {
  try {
    const decoded = decodeMlsMessage(data, 0)?.[0];
    if (!decoded || decoded.wireformat !== "mls_group_info") return false;
    const cs = await getSuite(suite);
    const tree = ratchetTreeFromExtension(decoded.groupInfo);
    if (!tree) return false;
    const pub = getSignaturePublicKeyFromLeafIndex(
      tree,
      decoded.groupInfo.signer,
    );
    return await verifyGroupInfoSignature(
      decoded.groupInfo,
      pub,
      cs.signature,
    );
  } catch {
    return false;
  }
}

export async function verifyPrivateMessage(
  state: StoredGroupState,
  data: Uint8Array,
  suite: CiphersuiteName = DEFAULT_SUITE,
  psks?: Record<string, string>,
): Promise<boolean> {
  try {
    const cs = await getSuite(suite);
    const decoded = decodeMlsMessage(data, 0)?.[0];
    if (!decoded || decoded.wireformat !== "mls_private_message") {
      return false;
    }
    const cloned = structuredClone(state);
    await processPrivateMessage(
      cloned,
      decoded.privateMessage,
      buildPskIndex(state, psks),
      cs,
    );
    return true;
  } catch {
    return false;
  }
}

export async function createMLSGroup(
  identity: string,
  suite: CiphersuiteName = DEFAULT_SUITE,
): Promise<{
  state: StoredGroupState;
  keyPair: GeneratedKeyPair;
  gid: Uint8Array;
}> {
  const keyPair = await generateKeyPair(identity, suite);
  const gid = new TextEncoder().encode(crypto.randomUUID());
  const cs = await getSuite(suite);
  const state = await createGroup(gid, keyPair.public, keyPair.private, [], cs);
  return { state, keyPair, gid };
}

export async function addMembers(
  state: StoredGroupState,
  addKeyPackages: RawKeyPackageInput[],
  suite: CiphersuiteName = DEFAULT_SUITE,
  psks?: Record<string, string>,
): Promise<{
  commit: Uint8Array;
  welcomes: WelcomeEntry[];
  state: StoredGroupState;
}> {
  const cs = await getSuite(suite);
  const proposals: Proposal[] = [];
  for (const kp of addKeyPackages) {
    const decoded = decodeMlsMessage(b64ToBytes(kp.content), 0)?.[0];
    if (decoded && decoded.wireformat === "mls_key_package") {
      proposals.push({
        proposalType: "add",
        add: { keyPackage: decoded.keyPackage },
      });
    }
  }
  const result = await createCommit(
    state,
    buildPskIndex(state, psks),
    false,
    proposals,
    cs,
  );
  state = result.newState;
  const commit = encodeMlsMessage(result.commit);
  const welcomes: WelcomeEntry[] = [];
  if (result.welcome) {
    const welcomeBytes = encodeMlsMessage({
      version: "mls10",
      wireformat: "mls_welcome",
      welcome: result.welcome,
    });
    for (const kp of addKeyPackages) {
      welcomes.push({
        actor: kp.actor,
        deviceId: kp.deviceId,
        data: welcomeBytes,
      });
    }
  }
  return { commit, welcomes, state };
}

export async function removeMembers(
  state: StoredGroupState,
  removeIndices: number[],
  suite: CiphersuiteName = DEFAULT_SUITE,
  psks?: Record<string, string>,
): Promise<{ commit: Uint8Array; state: StoredGroupState }> {
  const cs = await getSuite(suite);
  const proposals: Proposal[] = [];
  for (const index of removeIndices) {
    proposals.push({
      proposalType: "remove",
      remove: { removed: index },
    });
  }
  const result = await createCommit(
    state,
    buildPskIndex(state, psks),
    false,
    proposals,
    cs,
  );
  return { commit: encodeMlsMessage(result.commit), state: result.newState };
}

export async function updateKey(
  state: StoredGroupState,
  identity: string,
  suite: CiphersuiteName = DEFAULT_SUITE,
  psks?: Record<string, string>,
): Promise<{
  commit: Uint8Array;
  state: StoredGroupState;
  keyPair: GeneratedKeyPair;
}> {
  const cs = await getSuite(suite);
  const keyPair = await generateKeyPair(identity, suite);
  const proposals: Proposal[] = [{
    proposalType: "update",
    update: { keyPackage: keyPair.public },
  }];
  const result = await createCommit(
    state,
    buildPskIndex(state, psks),
    false,
    proposals,
    cs,
  );
  return {
    commit: encodeMlsMessage(result.commit),
    state: result.newState,
    keyPair,
  };
}

export async function joinWithWelcome(
  welcome: Uint8Array,
  keyPair: GeneratedKeyPair,
  suite: CiphersuiteName = DEFAULT_SUITE,
  psks?: Record<string, string>,
): Promise<StoredGroupState> {
  const cs = await getSuite(suite);
  const decoded = decodeMlsMessage(welcome, 0)?.[0];
  if (!decoded || decoded.wireformat !== "mls_welcome") {
    throw new Error("不正なWelcomeメッセージです");
  }
  return await joinGroup(
    decoded.welcome,
    keyPair.public,
    keyPair.private,
    buildPskIndex(undefined, psks),
    cs,
  );
}

export async function encryptMessage(
  state: StoredGroupState,
  plaintext: Uint8Array | string,
  suite: CiphersuiteName = DEFAULT_SUITE,
): Promise<{ message: Uint8Array; state: StoredGroupState }> {
  const cs = await getSuite(suite);
  const input = typeof plaintext === "string"
    ? new TextEncoder().encode(plaintext)
    : plaintext;
  const { newState, privateMessage } = await createApplicationMessage(
    state,
    input,
    cs,
  );
  const message = encodeMlsMessage({
    version: "mls10",
    wireformat: "mls_private_message",
    privateMessage,
  });
  return { message, state: newState };
}

export async function decryptMessage(
  state: StoredGroupState,
  data: Uint8Array,
  suite: CiphersuiteName = DEFAULT_SUITE,
  psks?: Record<string, string>,
): Promise<{ plaintext: Uint8Array; state: StoredGroupState } | null> {
  const cs = await getSuite(suite);
  const decoded = decodeMlsMessage(data, 0)?.[0];
  if (!decoded || decoded.wireformat !== "mls_private_message") {
    return null;
  }
  const res = await processPrivateMessage(
    state,
    decoded.privateMessage,
    buildPskIndex(state, psks),
    cs,
  );
  if (res.kind !== "applicationMessage") {
    return { plaintext: new Uint8Array(), state: res.newState };
  }
  return { plaintext: res.message, state: res.newState };
}

export async function exportGroupInfo(
  state: StoredGroupState,
  suite: CiphersuiteName = DEFAULT_SUITE,
): Promise<Uint8Array> {
  const cs = await getSuite(suite);
  const info = await createGroupInfoWithExternalPubAndRatchetTree(
    state,
    cs,
  );
  return encodeMlsMessage({
    version: "mls10",
    wireformat: "mls_group_info",
    groupInfo: info,
  });
}

export async function joinWithGroupInfo(
  groupInfo: Uint8Array,
  keyPair: GeneratedKeyPair,
  suite: CiphersuiteName = DEFAULT_SUITE,
): Promise<{ commit: string; state: StoredGroupState }> {
  const cs = await getSuite(suite);
  const decoded = decodeMlsMessage(groupInfo, 0)?.[0];
  if (!decoded || decoded.wireformat !== "mls_group_info") {
    throw new Error("不正なGroupInfoです");
  }
  const { publicMessage, newState } = await joinGroupExternal(
    decoded.groupInfo,
    keyPair.public,
    keyPair.private,
    false,
    cs,
  );
  const commitBytes = encodeMlsMessage({
    version: "mls10",
    wireformat: "mls_public_message",
    publicMessage,
  });
  return { commit: encodePublicMessage(commitBytes), state: newState };
}

export async function processCommit(
  state: StoredGroupState,
  message: PublicMessage,
  suite: CiphersuiteName = DEFAULT_SUITE,
  psks?: Record<string, string>,
): Promise<StoredGroupState> {
  if (!message.content.commit) {
    throw new Error("不正なCommitメッセージです");
  }
  const cs = await getSuite(suite);
  const { newState } = await processPublicMessage(
    state,
    message,
    buildPskIndex(state, psks),
    cs,
    acceptAll,
  );
  return newState;
}

export async function processProposal(
  state: StoredGroupState,
  message: PublicMessage,
  suite: CiphersuiteName = DEFAULT_SUITE,
  psks?: Record<string, string>,
): Promise<StoredGroupState> {
  if (!message.content.proposal) {
    throw new Error("不正なProposalメッセージです");
  }
  const cs = await getSuite(suite);
  const { newState } = await processPublicMessage(
    state,
    message,
    buildPskIndex(state, psks),
    cs,
    acceptAll,
  );
  return newState;
}

export { addMembers as createCommitAndWelcomes };
