export function stob(s: string) {
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

export function btos(b: ArrayBuffer) {
  return String.fromCharCode(...new Uint8Array(b));
}

// ストーリーが有効かどうかチェックする関数
export function isStoryValid(expiresAt: Date | string): boolean {
  const expireDate = typeof expiresAt === "string"
    ? new Date(expiresAt)
    : expiresAt;
  const now = new Date();
  return expireDate > now;
}

// ストーリーの残り時間を取得する関数（時間単位）
export function getRemainingStoryTime(expiresAt: Date | string): number {
  const expireDate = typeof expiresAt === "string"
    ? new Date(expiresAt)
    : expiresAt;
  const now = new Date();
  const diffMs = expireDate.getTime() - now.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60)));
}

export async function importprivateKey(pem: string) {
  const pemHeader = "-----BEGIN PRIVATE KEY-----";
  const pemFooter = "-----END PRIVATE KEY-----";
  if (pem.startsWith('"')) pem = pem.slice(1);
  if (pem.endsWith('"')) pem = pem.slice(0, -1);
  pem = pem.split("\\n").join("");
  pem = pem.split("\n").join("");
  const pemContents = pem.substring(
    pemHeader.length,
    pem.length - pemFooter.length,
  );
  const der = stob(atob(pemContents));
  const r = await crypto.subtle.importKey(
    "pkcs8",
    der,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    true,
    ["sign"],
  );
  return r;
}

export async function privateKeyToPublicKey(key: CryptoKey) {
  const jwk = await crypto.subtle.exportKey("jwk", key);
  if ("kty" in jwk) {
    delete jwk.d;
    delete jwk.p;
    delete jwk.q;
    delete jwk.dp;
    delete jwk.dq;
    delete jwk.qi;
    delete jwk.oth;
    jwk.key_ops = ["verify"];
  }
  const r = await crypto.subtle.importKey(
    "jwk",
    jwk,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    true,
    ["verify"],
  );
  return r;
}

export async function exportPublicKey(key: CryptoKey) {
  const der = await crypto.subtle.exportKey("spki", key);
  if ("byteLength" in der) {
    let pemContents = btoa(btos(der));

    let pem = "-----BEGIN PUBLIC KEY-----\n";
    while (pemContents.length > 0) {
      pem += pemContents.substring(0, 64) + "\n";
      pemContents = pemContents.substring(64);
    }
    pem += "-----END PUBLIC KEY-----\n";
    return pem;
  }
}

async function generatePrivateKey() {
  const key = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  return key.privateKey;
}

export async function generatePrivateKeyPem() {
  const privateKey = await generatePrivateKey();
  const der = await crypto.subtle.exportKey("pkcs8", privateKey);
  let pemContents = btoa(btos(der));
  let pem = "-----BEGIN PRIVATE KEY-----\n";
  while (pemContents.length > 0) {
    pem += pemContents.substring(0, 64) + "\n";
    pemContents = pemContents.substring(64);
  }
  pem += "-----END PRIVATE KEY-----\n";
  return pem;
}

export async function resolveWebFinger(
  acct: string,
): Promise<{ url: string } | null> {
  try {
    // acctが完全なアドレス（username@domain）かどうかを確認
    if (!acct.includes("@")) {
      return null;
    }

    const [username, domain] = acct.split("@");
    if (!username || !domain) {
      return null;
    }

    // WebFingerリクエストを構築
    const webfingerUrl =
      `https://${domain}/.well-known/webfinger?resource=acct:${username}@${domain}`;

    const response = await fetch(webfingerUrl, {
      headers: {
        "Accept": "application/jrd+json",
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    // ActivityPub URLを探す
    for (const link of data.links || []) {
      if (
        link.rel === "self" && link.type === "application/activity+json"
      ) {
        return { url: link.href };
      }
    }

    return null;
  } catch (error) {
    console.error("WebFinger解決エラー:", error);
    return null;
  }
}
