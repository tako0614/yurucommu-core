// RFC 9420 に基づく MLS メッセージの TLV 形式シリアライズ

import { b64ToBuf, bufToB64 } from "./buffer.ts";

export type MLSMessageType =
  | "PublicMessage"
  | "PrivateMessage"
  | "Welcome"
  | "KeyPackage";

const typeToByte: Record<MLSMessageType, number> = {
  PublicMessage: 1,
  PrivateMessage: 2,
  Welcome: 3,
  KeyPackage: 4,
};

const byteToType: Record<number, MLSMessageType> = {
  1: "PublicMessage",
  2: "PrivateMessage",
  3: "Welcome",
  4: "KeyPackage",
};

function toBytes(body: Uint8Array | string): Uint8Array {
  return typeof body === "string" ? new TextEncoder().encode(body) : body;
}

function serialize(
  type: MLSMessageType,
  body: Uint8Array | string,
): Uint8Array {
  const bodyBuf = toBytes(body);
  const len = bodyBuf.length;
  const out = new Uint8Array(3 + len);
  out[0] = typeToByte[type];
  out[1] = (len >>> 8) & 0xff;
  out[2] = len & 0xff;
  out.set(bodyBuf, 3);
  return out;
}

function deserialize(
  data: Uint8Array,
): { type: MLSMessageType; body: Uint8Array } | null {
  if (data.length < 3) return null;
  const type = byteToType[data[0]];
  if (!type) return null;
  const len = (data[1] << 8) | data[2];
  if (data.length < 3 + len) return null;
  return { type, body: data.slice(3, 3 + len) };
}

export function encodePublicMessage(body: Uint8Array | string): string {
  return bufToB64(serialize("PublicMessage", body));
}

export function encodePrivateMessage(body: Uint8Array | string): string {
  return bufToB64(serialize("PrivateMessage", body));
}

export function encodeWelcome(body: Uint8Array | string): string {
  return bufToB64(serialize("Welcome", body));
}

export function encodeKeyPackage(body: Uint8Array | string): string {
  return bufToB64(serialize("KeyPackage", body));
}

export function decodePublicMessage(data: string): Uint8Array | null {
  const decoded = parseMLSMessage(data);
  return decoded && decoded.type === "PublicMessage" ? decoded.body : null;
}

export function decodePrivateMessage(data: string): Uint8Array | null {
  const decoded = parseMLSMessage(data);
  return decoded && decoded.type === "PrivateMessage" ? decoded.body : null;
}

export function decodeWelcome(data: string): Uint8Array | null {
  const decoded = parseMLSMessage(data);
  return decoded && decoded.type === "Welcome" ? decoded.body : null;
}

export function decodeKeyPackage(data: string): Uint8Array | null {
  const decoded = parseMLSMessage(data);
  return decoded && decoded.type === "KeyPackage" ? decoded.body : null;
}

export function parseMLSMessage(
  data: string,
): { type: MLSMessageType; body: Uint8Array } | null {
  try {
    const u8 = b64ToBuf(data);
    return deserialize(u8);
  } catch {
    return null;
  }
}
