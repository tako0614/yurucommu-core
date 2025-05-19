/**
 * 文字列からSHA-256ハッシュを生成し、16進数文字列で返します
 */
export async function createHash(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * パスワードを検証します
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
  salt: string,
): Promise<boolean> {
  console.log(password, storedHash, salt, "verifyPassword");
  const inputHash = await createHash(salt + password);
  return inputHash === storedHash;
}

/**
 * セキュアなランダムトークンを生成します
 */
export function generateToken(): string {
  return crypto.randomUUID();
}

/**
 * RSAキーペアを生成します
 */
export async function generateRsaKeyPair(): Promise<
  { publicKey: CryptoKey; privateKey: CryptoKey }
> {
  return await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]), // 65537
      hash: "SHA-256",
    },
    true, // extractable
    ["sign", "verify"],
  );
}

/**
 * CryptoKeyをPEM形式の文字列にエクスポートします
 * @param key CryptoKeyオブジェクト
 * @param type 'PUBLIC' または 'PRIVATE'
 */
async function exportKeyToPem(
  key: CryptoKey,
  type: "PUBLIC" | "PRIVATE",
): Promise<string> {
  const format = type === "PUBLIC" ? "spki" : "pkcs8";
  const exported = await crypto.subtle.exportKey(format, key);
  const exportedAsString = String.fromCharCode.apply(
    null,
    Array.from(new Uint8Array(exported)),
  );
  const exportedAsBase64 = btoa(exportedAsString);
  const header = `-----BEGIN ${type} KEY-----`;
  const footer = `-----END ${type} KEY-----`;
  return `${header}\n${
    exportedAsBase64.match(/.{1,64}/g)?.join("\n")
  }\n${footer}`;
}

/**
 * 公開鍵をPEM形式でエクスポートします
 */
export async function exportPublicKeyToPem(key: CryptoKey): Promise<string> {
  return exportKeyToPem(key, "PUBLIC");
}

/**
 * 秘密鍵をPEM形式でエクスポートします
 */
export async function exportPrivateKeyToPem(key: CryptoKey): Promise<string> {
  return exportKeyToPem(key, "PRIVATE");
}
