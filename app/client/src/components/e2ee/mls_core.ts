import {
  acceptAll,
  bytesToBase64,
  type CiphersuiteName,
  type ClientState,
  createApplicationMessage,
  createCommit,
  createGroup,
  type Credential,
  decodeMlsMessage,
  defaultCapabilities,
  defaultLifetime,
  emptyPskIndex,
  encodeMlsMessage,
  generateKeyPackage as tsGenerateKeyPackage,
  getCiphersuiteFromName,
  getCiphersuiteImpl,
  type KeyPackage as TsKeyPackage,
  type PrivateKeyPackage,
  processPrivateMessage,
  processPublicMessage,
  type Proposal,
} from "ts-mls";
import "@noble/curves/p256";
import {
  verifyKeyPackage,
  verifyPrivateMessage,
} from "../../../../shared/mls_wrapper.ts";
export { verifyKeyPackage };

export type KeyPackage = TsKeyPackage;
export type ActorID = string;
export type StoredGroupState = ClientState;

export interface RawKeyPackageInput {
  content: string;
  actor?: ActorID;
  deviceId?: string;
}

export interface WelcomeEntry {
  actor?: ActorID;
  deviceId?: string;
  data: Uint8Array;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function generateKeyPackage(
  identity: string,
  suiteName: CiphersuiteName = "MLS_128_DHKEMP256_AES128GCM_SHA256_P256",
): Promise<{
  public: KeyPackage;
  private: PrivateKeyPackage;
  encoded: string;
}> {
  const cs = await getCiphersuiteImpl(getCiphersuiteFromName(suiteName));
  const credential: Credential = {
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

export async function createCommitAndWelcomes(
  _suite: number,
  _members: ActorID[],
  addKeyPackages: RawKeyPackageInput[],
  stored?: StoredGroupState | null,
): Promise<{
  commit: Uint8Array;
  welcomes: WelcomeEntry[];
  state: StoredGroupState;
}> {
  const suiteName: CiphersuiteName = "MLS_128_DHKEMP256_AES128GCM_SHA256_P256";
  const cs = await getCiphersuiteImpl(getCiphersuiteFromName(suiteName));
  let state: ClientState;
  if (stored) {
    state = stored;
  } else {
    const self = await generateKeyPackage("server", suiteName);
    const gid = new TextEncoder().encode(crypto.randomUUID());
    state = await createGroup(gid, self.public, self.private, [], cs);
  }
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
  const result = await createCommit(state, emptyPskIndex, false, proposals, cs);
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

export async function createRemoveCommit(
  state: StoredGroupState,
  removeIndices: number[],
): Promise<{ commit: Uint8Array; state: StoredGroupState }> {
  const suiteName: CiphersuiteName = "MLS_128_DHKEMP256_AES128GCM_SHA256_P256";
  const cs = await getCiphersuiteImpl(getCiphersuiteFromName(suiteName));
  const proposals: Proposal[] = [];
  for (const index of removeIndices) {
    proposals.push({
      proposalType: "remove",
      remove: { removed: index },
    });
  }
  const result = await createCommit(state, emptyPskIndex, false, proposals, cs);
  return { commit: encodeMlsMessage(result.commit), state: result.newState };
}

export async function createUpdateCommit(
  state: StoredGroupState,
  identity: string,
): Promise<{
  commit: Uint8Array;
  state: StoredGroupState;
  keyPair: { public: KeyPackage; private: PrivateKeyPackage; encoded: string };
}> {
  const suiteName: CiphersuiteName = "MLS_128_DHKEMP256_AES128GCM_SHA256_P256";
  const cs = await getCiphersuiteImpl(getCiphersuiteFromName(suiteName));
  const keyPair = await generateKeyPackage(identity, suiteName);
  const proposals: Proposal[] = [{
    proposalType: "update",
    update: { keyPackage: keyPair.public },
  }];
  const result = await createCommit(state, emptyPskIndex, false, proposals, cs);
  return {
    commit: encodeMlsMessage(result.commit),
    state: result.newState,
    keyPair,
  };
}

export async function encryptMessage(
  state: StoredGroupState,
  plaintext: Uint8Array | string,
): Promise<{ message: Uint8Array; state: StoredGroupState }> {
  const suiteName: CiphersuiteName = "MLS_128_DHKEMP256_AES128GCM_SHA256_P256";
  const cs = await getCiphersuiteImpl(getCiphersuiteFromName(suiteName));
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

const sentAck = new Set<string>();

export async function encryptMessageWithAck(
  state: StoredGroupState,
  plaintext: Uint8Array | string,
  roomId: string,
  deviceId: string,
): Promise<{ messages: Uint8Array[]; state: StoredGroupState }> {
  let current = state;
  const out: Uint8Array[] = [];
  const key = `${roomId}:${deviceId}`;
  if (!sentAck.has(key)) {
    const ackBody = JSON.stringify({
      type: "joinAck",
      roomId,
      deviceId,
    });
    const ack = await encryptMessage(current, ackBody);
    out.push(ack.message);
    current = ack.state;
    sentAck.add(key);
  }
  const msg = await encryptMessage(current, plaintext);
  out.push(msg.message);
  return { messages: out, state: msg.state };
}

export async function decryptMessage(
  state: StoredGroupState,
  data: Uint8Array,
): Promise<{ plaintext: Uint8Array; state: StoredGroupState } | null> {
  if (!(await verifyPrivateMessage(state, data))) {
    return null;
  }
  const suiteName: CiphersuiteName = "MLS_128_DHKEMP256_AES128GCM_SHA256_P256";
  const cs = await getCiphersuiteImpl(getCiphersuiteFromName(suiteName));
  const decoded = decodeMlsMessage(data, 0)?.[0];
  if (!decoded || decoded.wireformat !== "mls_private_message") {
    return null;
  }
  const res = await processPrivateMessage(
    state,
    decoded.privateMessage,
    emptyPskIndex,
    cs,
  );
  if (res.kind !== "applicationMessage") {
    return { plaintext: new Uint8Array(), state: res.newState };
  }
  return { plaintext: res.message, state: res.newState };
}

export async function processCommit(
  state: StoredGroupState,
  data: Uint8Array,
): Promise<StoredGroupState> {
  const suiteName: CiphersuiteName = "MLS_128_DHKEMP256_AES128GCM_SHA256_P256";
  const cs = await getCiphersuiteImpl(getCiphersuiteFromName(suiteName));
  const decoded = decodeMlsMessage(data, 0)?.[0];
  if (
    !decoded ||
    decoded.wireformat !== "mls_public_message" ||
    !decoded.publicMessage.content?.commit
  ) {
    throw new Error("不正なCommitメッセージです");
  }
  const { newState } = await processPublicMessage(
    state,
    decoded.publicMessage,
    emptyPskIndex,
    cs,
    acceptAll,
  );
  return newState;
}

export async function processProposal(
  state: StoredGroupState,
  data: Uint8Array,
): Promise<StoredGroupState> {
  const suiteName: CiphersuiteName = "MLS_128_DHKEMP256_AES128GCM_SHA256_P256";
  const cs = await getCiphersuiteImpl(getCiphersuiteFromName(suiteName));
  const decoded = decodeMlsMessage(data, 0)?.[0];
  if (
    !decoded ||
    decoded.wireformat !== "mls_public_message" ||
    !decoded.publicMessage.content?.proposal
  ) {
    throw new Error("不正なProposalメッセージです");
  }
  const { newState } = await processPublicMessage(
    state,
    decoded.publicMessage,
    emptyPskIndex,
    cs,
    acceptAll,
  );
  return newState;
}
