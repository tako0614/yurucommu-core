import { bufferToBase64 } from "./base64.ts";

const RSA_ALGORITHM = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };

function wrapPem(label: string, base64: string): string {
  const lines = base64.match(/.{1,64}/g)?.join("\n") ?? base64;
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----`;
}

export async function generateKeyPair(): Promise<{
  publicKeyPem: string;
  privateKeyPem: string;
}> {
  const keyPair = await crypto.subtle.generateKey(
    {
      ...RSA_ALGORITHM,
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ["sign", "verify"],
  );

  const [publicKey, privateKey] = await Promise.all([
    crypto.subtle.exportKey("spki", keyPair.publicKey),
    crypto.subtle.exportKey("pkcs8", keyPair.privateKey),
  ]);

  return {
    publicKeyPem: wrapPem("PUBLIC KEY", bufferToBase64(publicKey)),
    privateKeyPem: wrapPem("PRIVATE KEY", bufferToBase64(privateKey)),
  };
}

export async function signRequest(
  privateKeyPem: string,
  keyId: string,
  method: string,
  url: string,
  body?: string,
): Promise<Record<string, string>> {
  const urlObj = new URL(url);
  const date = new Date().toUTCString();
  const digest = body
    ? `SHA-256=${bufferToBase64(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)),
      )}`
    : undefined;

  const signedHeaders = digest
    ? "(request-target) host date digest"
    : "(request-target) host date";
  let signatureString = `(request-target): ${method.toLowerCase()} ${urlObj.pathname}\nhost: ${urlObj.host}\ndate: ${date}`;
  if (digest) signatureString += `\ndigest: ${digest}`;

  const pemContents = privateKeyPem
    .replace(/-----[^-]+-----/g, "")
    .replace(/\s/g, "");
  const binaryKey = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    RSA_ALGORITHM,
    false,
    ["sign"],
  );
  const signatureBuffer = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signatureString),
  );
  const signature = bufferToBase64(signatureBuffer);

  const headers: Record<string, string> = {
    Date: date,
    Host: urlObj.host,
    Signature: `keyId="${keyId}",algorithm="rsa-sha256",headers="${signedHeaders}",signature="${signature}"`,
  };
  if (digest) headers["Digest"] = digest;

  return headers;
}
