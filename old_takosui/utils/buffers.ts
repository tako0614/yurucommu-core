import { decode, encode } from "base64-arraybuffer";
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return encode(buffer);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  return decode(base64);
}
