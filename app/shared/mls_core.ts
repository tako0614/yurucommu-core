// Minimal MLS adapter for Deno/Browser environments
// This is an adapter layer with a simple JSON-based wire inside the MLS message body.
// It can be swapped with a real MLS implementation (e.g., OpenMLS WASM) later
// without changing call sites. All outputs are raw Uint8Array for wrapping by encodeMLSMessage.

import { b64ToBuf } from "./buffer.ts";

export type ActorID = string;

export interface RawKeyPackageInput {
  // Base64-encoded key package bytes (as published in ActivityPub keyPackages)
  content: string;
  // Optional metadata for routing of welcomes
  actor?: ActorID;
  deviceId?: string;
}

export interface CommitAndWelcomesParams {
  addKeyPackages: RawKeyPackageInput[];
  members: ActorID[];
  suite: number;
  epoch?: number;
}

export interface WelcomeEntry {
  actor?: ActorID;
  deviceId?: string;
  data: Uint8Array; // raw Welcome payload (to be wrapped by encodeMLSMessage("Welcome", ...))
}

export interface CommitAndWelcomesResult {
  commit: Uint8Array; // raw Commit payload (to be wrapped by encodeMLSMessage("PublicMessage", ...))
  welcomes: WelcomeEntry[];
  epoch: number;
}

async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const h = await crypto.subtle.digest("SHA-256", view);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Create a synthetic Commit and a set of Welcome messages for the given add proposals.
// NOTE: This is NOT real MLS cryptography; it's a transport-ready placeholder that encodes
// metadata for interoperability testing. Swap with a proper MLS backend later.
export async function createCommitAndWelcomes(
  params: CommitAndWelcomesParams,
): Promise<CommitAndWelcomesResult> {
  const epoch = params.epoch ?? Date.now();
  const members = [...params.members];
  const added = await Promise.all(
    params.addKeyPackages.map(async (kp, idx) => {
      let kpHash: string | undefined;
      try {
        const kpBytes = b64ToBuf(kp.content);
        kpHash = await sha256Hex(kpBytes);
      } catch {
        kpHash = undefined;
      }
      return {
        index: idx,
        actor: kp.actor,
        deviceId: kp.deviceId,
        keyPackageHash: kpHash,
      };
    }),
  );

  const commitBody = {
    type: "commit",
    suite: params.suite,
    epoch,
    members,
    added,
  } as const;
  const commit = new TextEncoder().encode(JSON.stringify(commitBody));

  const welcomes: WelcomeEntry[] = [];
  for (const info of added) {
    const welcomeBody = {
      type: "welcome",
      suite: params.suite,
      epoch,
      members,
      keyPackageHash: info.keyPackageHash,
      actor: info.actor,
      deviceId: info.deviceId,
      issuedAt: Date.now(),
    } as const;
    welcomes.push({
      actor: info.actor,
      deviceId: info.deviceId,
      data: new TextEncoder().encode(JSON.stringify(welcomeBody)),
    });
  }

  return { commit, welcomes, epoch };
}

export interface PackWelcomeParams {
  members: ActorID[];
  epoch: number;
  suite?: number;
  roomId?: string;
  deviceId?: string;
}

export function packWelcome(params: PackWelcomeParams): Uint8Array {
  const body = {
    type: "welcome",
    suite: params.suite ?? 0,
    epoch: params.epoch,
    members: [...params.members],
    roomId: params.roomId,
    deviceId: params.deviceId,
    issuedAt: Date.now(),
  } as const;
  return new TextEncoder().encode(JSON.stringify(body));
}
