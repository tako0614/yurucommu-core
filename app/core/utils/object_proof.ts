// オブジェクト署名（作者署名）ユーティリティ
// - DataIntegrityProof 風の簡易実装（Ed25519）
// - 対象: Note/Image/Video/Document などの AS オブジェクト
// - 署名対象フィールド: id, type, attributedTo, audience, content/name, published

import { b64ToBuf, bufToB64 } from "@takos/buffer";
import { pemToArrayBuffer } from "@takos/crypto";
import { ensurePem } from "./activitypub.ts";

export interface DataIntegrityProof {
  type: "DataIntegrityProof";
  created: string; // ISO8601
  verificationMethod: string; // 例: https://example.com/users/alice#main-key
  jws: string; // base64(signature)（JWS互換の簡易表現）
}

function getString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

// 署名用の正規化文字列を生成
export function canonicalizeObjectForProof(obj: Record<string, unknown>): string {
  const id = getString(obj.id) ?? "";
  const type = getString(obj.type) ?? "";
  const attributedTo = getString((obj as { attributedTo?: unknown }).attributedTo) ?? "";
  const audience = getString((obj as { audience?: unknown }).audience) ?? "";
  const content = getString((obj as { content?: unknown }).content) ?? "";
  const name = getString((obj as { name?: unknown }).name) ?? ""; // メディア時のキャプション
  const published = getString((obj as { published?: unknown }).published) ?? "";
  // content または name のいずれかを採用（優先: content）
  const body = content || name;
  // 改行区切りの単純連結（サーバ/クライアント間で安定）
  return [
    `id:${id}`,
    `type:${type}`,
    `attributedTo:${attributedTo}`,
    `audience:${audience}`,
    `body:${body}`,
    `published:${published}`,
  ].join("\n");
}

// 作者署名を付与
export async function signObjectProof(
  obj: Record<string, unknown>,
  privateKeyPem: string,
  verificationMethod: string,
): Promise<DataIntegrityProof> {
  const normalizedPrivateKey = ensurePem(privateKeyPem, "PRIVATE KEY");
  const keyData = pemToArrayBuffer(normalizedPrivateKey);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const payload = canonicalizeObjectForProof(obj);
  const signature = await crypto.subtle.sign(
    "Ed25519",
    cryptoKey,
    new TextEncoder().encode(payload),
  );
  const proof: DataIntegrityProof = {
    type: "DataIntegrityProof",
    created: new Date().toISOString(),
    verificationMethod,
    jws: bufToB64(new Uint8Array(signature)),
  };
  return proof;
}

// 作者署名を検証
export async function verifyObjectProof(
  obj: Record<string, unknown>,
  publicKeyPem: string,
  proof: DataIntegrityProof,
): Promise<boolean> {
  try {
    const normalizedPublicKey = ensurePem(publicKeyPem, "PUBLIC KEY");
    const keyData = pemToArrayBuffer(normalizedPublicKey);
    const cryptoKey = await crypto.subtle.importKey(
      "spki",
      keyData,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const payload = canonicalizeObjectForProof(obj);
    const sigBytes = b64ToBuf(proof.jws);
    const ok = await crypto.subtle.verify(
      "Ed25519",
      cryptoKey,
      sigBytes,
      new TextEncoder().encode(payload),
    );
    return ok;
  } catch (_e) {
    return false;
  }
}
