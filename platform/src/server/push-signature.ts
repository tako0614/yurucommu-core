import { pemToArrayBuffer } from "../auth/crypto-keys";

const REGISTRATION_TTL_SECONDS = 5 * 60; // 5 minutes

type EnvWithKey = { PUSH_REGISTRATION_PRIVATE_KEY?: string };

export type PushRegistrationAction = "register" | "deregister";

type RegistrationPayloadInput = {
  action: PushRegistrationAction;
  payload: Record<string, string>;
};

type CachedKey = { raw: string; key: CryptoKey };
let cachedPrivateKey: CachedKey | null = null;

const encoder = new TextEncoder();

export function canonicalizePushPayload(input: Record<string, unknown>): string {
  const sortedKeys = Object.keys(input).sort();
  const entries = sortedKeys.map((key) => {
    const value = input[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return `"${key}":${canonicalizePushPayload(value as Record<string, unknown>)}`;
    }
    if (Array.isArray(value)) {
      const items = value
        .map((v) =>
          v && typeof v === "object"
            ? canonicalizePushPayload(v as Record<string, unknown>)
            : JSON.stringify(v),
        )
        .join(",");
      return `"${key}":[${items}]`;
    }
    return `"${key}":${JSON.stringify(value)}`;
  });
  return `{${entries.join(",")}}`;
}

async function getPrivateKey(env: EnvWithKey): Promise<CryptoKey> {
  const pem = env.PUSH_REGISTRATION_PRIVATE_KEY?.trim();
  if (!pem) {
    throw new Error("PUSH_REGISTRATION_PRIVATE_KEY must be configured for push delegation");
  }
  if (cachedPrivateKey && cachedPrivateKey.raw === pem) {
    return cachedPrivateKey.key;
  }
  const keyData = pemToArrayBuffer(pem);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  cachedPrivateKey = { raw: pem, key };
  return key;
}

export async function buildPushRegistrationPayload(env: EnvWithKey, input: RegistrationPayloadInput) {
  const { action, payload } = input;
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + REGISTRATION_TTL_SECONDS * 1000);
  const envelope = {
    action,
    instance: payload.instance ?? "",
    userId: payload.userId ?? "",
    token: payload.token ?? "",
    platform: payload.platform ?? "",
    appId: payload.appId ?? "",
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    nonce: crypto.randomUUID(),
  };
  const canonical = canonicalizePushPayload(envelope);
  const key = await getPrivateKey(env);
  const signatureBytes = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(canonical));
  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBytes)));
  return { ...envelope, signature };
}

export async function signPushPayload(env: EnvWithKey, payload: Record<string, unknown>): Promise<string> {
  const normalized = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  const canonical = canonicalizePushPayload(normalized);
  const key = await getPrivateKey(env);
  const signatureBytes = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(canonical));
  return btoa(String.fromCharCode(...new Uint8Array(signatureBytes)));
}
