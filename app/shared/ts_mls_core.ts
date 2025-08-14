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
} from "ts-mls";
import "@noble/curves/p256";

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * ts-mls を利用して KeyPackage を生成する
 */
export async function generateKeyPackageWithTsMLS(
  identity: string,
  suiteName: CiphersuiteName = "MLS_128_DHKEMP256_AES128GCM_SHA256_P256",
): Promise<{
  public: TsKeyPackage;
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

/**
 * ts-mls を利用して Commit と Welcome を生成する
 */
export async function createCommitAndWelcomesWithTsMLS(
  groupId: string,
  self: { public: TsKeyPackage; private: PrivateKeyPackage },
  addKeyPackages: string[],
): Promise<{ commit: string; welcomes: string[]; state: ClientState }> {
  const cs = await getCiphersuiteImpl(
    getCiphersuiteFromName(self.public.cipherSuite),
  );
  const gid = new TextEncoder().encode(groupId);
  let state = await createGroup(gid, self.public, self.private, [], cs);
  const proposals: Proposal[] = [];
  for (const kp of addKeyPackages) {
    const decoded = decodeMlsMessage(b64ToBytes(kp), 0)?.[0];
    if (decoded && decoded.wireformat === "mls_key_package") {
      proposals.push({
        proposalType: "add",
        add: { keyPackage: decoded.keyPackage },
      });
    }
  }
  const result = await createCommit(state, emptyPskIndex, false, proposals, cs);
  state = result.newState;
  const commit = bytesToBase64(encodeMlsMessage(result.commit));
  const welcomes: string[] = [];
  if (result.welcome) {
    const welcome = bytesToBase64(
      encodeMlsMessage({
        version: "mls10",
        wireformat: "mls_welcome",
        welcome: result.welcome,
      }),
    );
    welcomes.push(welcome);
  }
  return { commit, welcomes, state };
}
