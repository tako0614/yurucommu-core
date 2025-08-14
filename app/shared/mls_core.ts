import {
  bytesToBase64,
  type CiphersuiteName,
  type ClientState,
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
  type Proposal,
} from "npm:ts-mls";
import "npm:@noble/curves/p256";

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

export async function verifyKeyPackage(
  pkg:
    | string
    | { credential: { publicKey: string }; signature: string }
      & Record<string, unknown>,
): Promise<boolean> {
  if (typeof pkg === "string") {
    const decoded = decodeMlsMessage(b64ToBytes(pkg), 0)?.[0];
    return !!decoded && decoded.wireformat === "mls_key_package";
  }
  try {
    const { signature, ...body } = pkg;
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
