import { hashSync } from "bcryptjs";
import { hashSha256 } from "../../../shared/crypto.ts";
import { b64ToBuf, bufToB64 } from "../../../shared/buffer.ts";

export const encryptWithPassword = async (
  data: string,
  password: string,
): Promise<string> => {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(data),
  );
  const result = [salt, iv, new Uint8Array(encrypted)].map((u8) => bufToB64(u8))
    .join(":");
  return result;
};

export const decryptWithPassword = async (
  data: string,
  password: string,
): Promise<string | null> => {
  const [s, i, d] = data.split(":");
  if (!s || !i || !d) return null;
  const salt = b64ToBuf(s);
  const iv = b64ToBuf(i);
  const encData = b64ToBuf(d);
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["decrypt"],
  );
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      encData,
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
};

const ENCRYPTION_PASS_SALT = "takos";
const BCRYPT_SALT = "$2b$10$GxW5ntweCe9L1LiK1roc/3";

/**
 * 暗号化キー用パスワードをハッシュ化する
 * 別アカウントでも同一の入力で同じ値になるよう共通ソルトを利用
 */
export const hashEncryptionPassword = (
  password: string,
): string => {
  return hashSync(ENCRYPTION_PASS_SALT + password, BCRYPT_SALT);
};

export { hashSha256 };
