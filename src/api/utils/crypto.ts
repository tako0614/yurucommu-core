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
export function exportPublicKeyToPem(key: CryptoKey): Promise<string> {
  return exportKeyToPem(key, "PUBLIC");
}

/**
 * 秘密鍵をPEM形式でエクスポートします
 */
export function exportPrivateKeyToPem(key: CryptoKey): Promise<string> {
  return exportKeyToPem(key, "PRIVATE");
}

/**
 * PEM形式の公開鍵をCryptoKeyにインポートします
 */
export async function importPublicKeyFromPem(pem: string): Promise<CryptoKey> {
  // PEMヘッダーとフッターを除去
  const pemContent = pem
    .replace(/-----BEGIN PUBLIC KEY-----/, "")
    .replace(/-----END PUBLIC KEY-----/, "")
    .replace(/\s/g, "");

  // Base64デコード
  const binaryString = atob(pemContent);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return await crypto.subtle.importKey(
    "spki",
    bytes,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["verify"],
  );
}

/**
 * PEM形式の秘密鍵をCryptoKeyにインポートします
 */
export async function importPrivateKeyFromPem(pem: string): Promise<CryptoKey> {
  // PEMヘッダーとフッターを除去
  const pemContent = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");

  // Base64デコード
  const binaryString = atob(pemContent);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return await crypto.subtle.importKey(
    "pkcs8",
    bytes,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );
}

/**
 * ActivityPub互換の鍵ペア生成
 */
export async function generateKeyPair(): Promise<{
  publicKeyPem: string;
  privateKeyPem: string;
}> {
  const keyPair = await generateRsaKeyPair();
  const publicKeyPem = await exportPublicKeyToPem(keyPair.publicKey);
  const privateKeyPem = await exportPrivateKeyToPem(keyPair.privateKey);

  return { publicKeyPem, privateKeyPem };
}

/**
 * HTTP署名の署名文字列を生成
 */
export function buildSignatureString(
  method: string,
  url: string,
  headers: Record<string, string>,
  signedHeaders: string[],
): string {
  const parsedUrl = new URL(url);
  const requestTarget = `${method.toLowerCase()} ${parsedUrl.pathname}${parsedUrl.search}`;

  const lines = [`(request-target): ${requestTarget}`];

  for (const headerName of signedHeaders) {
    if (headerName === "(request-target)") continue;
    const headerValue = headers[headerName.toLowerCase()];
    if (headerValue !== undefined) {
      lines.push(`${headerName}: ${headerValue}`);
    }
  }

  return lines.join("\n");
}

/**
 * HTTP署名を生成
 */
export async function createHttpSignature(
  method: string,
  url: string,
  headers: Record<string, string>,
  privateKeyPem: string,
  keyId: string,
  signedHeaders: string[] = ["(request-target)", "host", "date", "digest"],
): Promise<string> {
  const signatureString = buildSignatureString(method, url, headers, signedHeaders);

  const privateKey = await importPrivateKeyFromPem(privateKeyPem);
  const encoder = new TextEncoder();
  const data = encoder.encode(signatureString);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, data);

  const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)));

  return `keyId="${keyId}",algorithm="rsa-sha256",headers="${signedHeaders.join(" ")}",signature="${signatureBase64}"`;
}

/**
 * HTTP署名を検証
 */
export async function verifyHttpSignature(
  method: string,
  url: string,
  headers: Record<string, string>,
  signatureHeader: string,
  publicKeyPem: string,
): Promise<boolean> {
  try {
    // 署名ヘッダーをパース
    const signatureParams = parseSignatureHeader(signatureHeader);
    if (!signatureParams) return false;

    const { algorithm, signedHeaders, signature } = signatureParams;

    // アルゴリズムチェック
    if (algorithm !== "rsa-sha256") return false;

    // 署名文字列を生成
    const signatureString = buildSignatureString(method, url, headers, signedHeaders);

    // 公開鍵をインポート
    const publicKey = await importPublicKeyFromPem(publicKeyPem);

    // 署名をデコード
    const signatureBytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));

    // 署名を検証
    const encoder = new TextEncoder();
    const data = encoder.encode(signatureString);
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, signatureBytes, data);
  } catch (error) {
    console.error("Signature verification error:", error);
    return false;
  }
}

/**
 * 署名ヘッダーをパース
 */
function parseSignatureHeader(signatureHeader: string): {
  keyId: string;
  algorithm: string;
  signedHeaders: string[];
  signature: string;
} | null {
  try {
    const params: Record<string, string> = {};

    // 正規表現でパラメーターを抽出
    const regex = /(\w+)="([^"]*)"/g;
    let match;
    while ((match = regex.exec(signatureHeader)) !== null) {
      params[match[1]] = match[2];
    }

    if (!params.keyId || !params.algorithm || !params.headers || !params.signature) {
      return null;
    }

    return {
      keyId: params.keyId,
      algorithm: params.algorithm,
      signedHeaders: params.headers.split(" "),
      signature: params.signature,
    };
  } catch {
    return null;
  }
}
