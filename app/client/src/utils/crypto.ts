import { hashSync } from "npm:bcryptjs";

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
  const result = [salt, iv, new Uint8Array(encrypted)].map((u8) =>
    btoa(String.fromCharCode(...u8))
  ).join(":");
  return result;
};

export const decryptWithPassword = async (
  data: string,
  password: string,
): Promise<string | null> => {
  const [s, i, d] = data.split(":");
  if (!s || !i || !d) return null;
  const salt = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(i), (c) => c.charCodeAt(0));
  const encData = Uint8Array.from(atob(d), (c) => c.charCodeAt(0));
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

export const sha256 = async (text: string): Promise<string> => {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
