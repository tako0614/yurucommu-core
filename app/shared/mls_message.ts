// MLSメッセージのエンコードとデコード
// activitypub-e2ee仕様に沿ってメッセージタイプを1バイトで表現する

import { b64ToBuf, bufToB64 } from "./buffer.ts";

export type MLSMessageType = "PublicMessage" | "PrivateMessage";

const typeToByte: Record<MLSMessageType, number> = {
  PublicMessage: 1,
  PrivateMessage: 2,
};

const byteToType: Record<number, MLSMessageType> = {
  1: "PublicMessage",
  2: "PrivateMessage",
};

/**
 * MLSMessageをBase64文字列に変換
 */
export function encodeMLSMessage(
  type: MLSMessageType,
  body: Uint8Array | string,
): string {
  const bodyBuf = typeof body === "string"
    ? new TextEncoder().encode(body)
    : body;
  const u8 = new Uint8Array(bodyBuf.length + 1);
  u8[0] = typeToByte[type];
  u8.set(bodyBuf, 1);
  return bufToB64(u8);
}

/**
 * Base64文字列からMLSMessageを復元
 */
export function decodeMLSMessage(
  data: string,
): { type: MLSMessageType; body: Uint8Array } | null {
  try {
    const u8 = new Uint8Array(b64ToBuf(data));
    const type = byteToType[u8[0]];
    if (!type) return null;
    return { type, body: u8.slice(1) };
  } catch {
    return null;
  }
}
