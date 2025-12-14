import { sha256, utf8Bytes } from "./crypto";
import { toBase64 } from "./base64";

export async function computeDigest(body: string): Promise<string> {
  const digestBytes = await sha256(utf8Bytes(body));
  return `SHA-256=${toBase64(digestBytes)}`;
}

export async function computeDigestBytes(body: Uint8Array): Promise<string> {
  const digestBytes = await sha256(body);
  return `SHA-256=${toBase64(digestBytes)}`;
}
