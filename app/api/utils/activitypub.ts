import {
  ActivityPubActor,
  ActivityPubObject as _ActivityPubObject,
  Community as _Community,
  Follow,
} from "../models/activitypub.ts";
import { Account } from "../models/account.ts";
import { ActivityPubActor as ActivityPubActorType } from "@takopack/builder";

// Type definitions
interface ActivityPubGenericObject {
  type: string;
  id: string;
  actor?: string;
  object?: unknown;
  to?: string[];
  cc?: string[];
}

// ActivityPub オブジェクト検証
export function validateActivityPubObject(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return false;
  const typedObj = obj as Record<string, unknown>;
  if (!typedObj.type || !typedObj.id) return false;
  return true;
}

// ローカルアクターかどうかの判定
export function isLocalActor(actorId: string, domain: string): boolean {
  return actorId.startsWith(`https://${domain}/`);
}

// ActivityPub オブジェクトの配信先を計算
export function calculateDeliveryTargets(
  activity: ActivityPubGenericObject,
  domain: string,
): string[] {
  const targets = new Set<string>();

  // to, cc フィールドから配信先を抽出
  [...(activity.to || []), ...(activity.cc || [])].forEach((target) => {
    if (typeof target === "string" && !isLocalActor(target, domain)) {
      targets.add(target);
    }
  });

  return Array.from(targets);
}

// HTTP Signatures用の署名生成
export async function signRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  privateKeyPem: string,
  keyId: string,
): Promise<Record<string, string>> {
  const crypto = await import("node:crypto");

  // Date ヘッダーを追加
  if (!headers.date) {
    headers.date = new Date().toUTCString();
  }

  // 署名対象の文字列を構築
  const headersToSign = ["(request-target)", "host", "date"];
  if (headers["content-type"]) {
    headersToSign.push("content-type");
  }
  if (headers["digest"]) {
    headersToSign.push("digest");
  }

  const urlObj = new URL(url);
  const requestTarget =
    `${method.toLowerCase()} ${urlObj.pathname}${urlObj.search}`;

  const signingString = headersToSign.map((header) => {
    if (header === "(request-target)") {
      return `(request-target): ${requestTarget}`;
    }
    return `${header}: ${headers[header]}`;
  }).join("\n");

  // 署名生成
  const sign = crypto.createSign("RSA-SHA256");
  sign.write(signingString);
  sign.end();

  const signature = sign.sign(privateKeyPem, "base64");

  // Signature ヘッダー生成
  headers.signature = `keyId="${keyId}",algorithm="rsa-sha256",headers="${
    headersToSign.join(" ")
  }",signature="${signature}"`;

  return headers;
}

// ActivityPub オブジェクトの配信
export async function deliverActivity(
  activity: ActivityPubGenericObject,
  targetInbox: string,
  senderKeyId: string,
  senderPrivateKey: string,
): Promise<boolean> {
  try {
    const body = JSON.stringify(activity);
    const headers: Record<string, string> = {
      "content-type": "application/activity+json",
      "user-agent": "takos/1.0",
    };

    // Digest ヘッダー生成
    const crypto = await import("node:crypto");
    const hash = crypto.createHash("sha256");
    hash.update(body);
    headers.digest = `SHA-256=${hash.digest("base64")}`;

    // URL から Host ヘッダー生成
    const urlObj = new URL(targetInbox);
    headers.host = urlObj.host;

    // 署名
    const signedHeaders = await signRequest(
      "POST",
      targetInbox,
      headers,
      senderPrivateKey,
      senderKeyId,
    );

    // 配信実行
    const response = await fetch(targetInbox, {
      method: "POST",
      headers: signedHeaders,
      body,
    });

    return response.ok;
  } catch (error) {
    console.error("Activity delivery failed:", error);
    return false;
  }
}

// アクター情報の取得（ローカル優先、リモートフォールバック）
export async function getActor(
  actorId: string,
  domain: string,
): Promise<ActivityPubActorType | null> {
  try {
    // ローカルアクターの場合
    if (isLocalActor(actorId, domain)) { // Account からの取得を試行
      const account = await Account.findOne({
        "activityPubActor.id": actorId,
      });
      if (account) {
        return account.activityPubActor as ActivityPubActorType;
      }

      // ActivityPubActor からの取得を試行
      const actor = await ActivityPubActor.findOne({ id: actorId });
      if (actor) {
        return actor.rawActor as ActivityPubActorType;
      }

      return null;
    }
    // リモートアクターの場合、キャッシュを確認
    const cachedActor = await ActivityPubActor.findOne({
      id: actorId,
      isLocal: false,
    });
    if (cachedActor) {
      // TODO: キャッシュの有効期限チェック
      return cachedActor.rawActor as ActivityPubActorType;
    }

    // リモートからフェッチ
    const response = await fetch(actorId, {
      headers: {
        "Accept": "application/activity+json, application/ld+json",
      },
    });

    if (!response.ok) {
      return null;
    }
    const actor = await response.json() as ActivityPubActorType;

    // キャッシュに保存
    await ActivityPubActor.create({
      id: actorId,
      type: actor.type || "Person",
      preferredUsername: actor.preferredUsername || "unknown",
      name: actor.name,
      summary: actor.summary,
      icon: actor.icon,
      image: actor.image,
      inbox: actor.inbox,
      outbox: actor.outbox,
      followers: actor.followers,
      following: actor.following,
      publicKey: actor.publicKey,
      isLocal: false,
      rawActor: actor,
    });

    return actor;
  } catch (error) {
    console.error("Failed to get actor:", error);
    return null;
  }
}

// フォロー関係の処理
export async function processFollow(
  activity: ActivityPubGenericObject,
): Promise<void> {
  const follower = activity.actor;
  const following = activity.object;

  // 既存のフォロー関係をチェック
  const existingFollow = await Follow.findOne({ follower, following });
  if (existingFollow) {
    return; // 既にフォロー済み
  }

  // フォロー関係を作成
  await Follow.create({
    follower,
    following,
    accepted: false, // Accept が来たら true にする
    activityId: activity.id,
  });
}

// Accept の処理
export async function processAccept(
  activity: ActivityPubGenericObject,
): Promise<void> {
  const originalActivity = activity.object as ActivityPubGenericObject;
  if (originalActivity?.type === "Follow") {
    await Follow.updateOne(
      { activityId: originalActivity.id },
      { accepted: true },
    );
  }
}

// Undo の処理
export async function processUndo(
  activity: ActivityPubGenericObject,
): Promise<void> {
  const originalActivity = activity.object as ActivityPubGenericObject;
  if (originalActivity?.type === "Follow") {
    await Follow.deleteOne({ activityId: originalActivity.id });
  }
}

// HTTP署名の検証
export async function verifyRequestSignature(
  method: string,
  url: string,
  headers: Record<string, string>,
  _body?: string,
): Promise<{ valid: boolean; actorId?: string }> {
  try {
    const signatureHeader = headers.signature;
    if (!signatureHeader) {
      return { valid: false };
    }

    // 署名ヘッダーをパース
    const signatureParams = parseSignatureHeader(signatureHeader);
    if (!signatureParams) {
      return { valid: false };
    }

    const { keyId, algorithm } = signatureParams;

    // アルゴリズムチェック
    if (algorithm !== "rsa-sha256") {
      return { valid: false };
    }

    // keyIdからアクターIDを抽出（通常は keyId が actor#main-key の形式）
    const actorId = keyId.split("#")[0];

    // アクター情報を取得
    const domain = Deno.env.get("ACTIVITYPUB_DOMAIN") || "";
    const actor = await getActor(actorId, domain);
    if (!actor || !actor.publicKey?.publicKeyPem) {
      return { valid: false };
    }

    // HTTP署名を検証
    const { verifyHttpSignature } = await import("./crypto.ts");
    const isValid = await verifyHttpSignature(
      method,
      url,
      headers,
      signatureHeader,
      actor.publicKey.publicKeyPem,
    );

    return { valid: isValid, actorId: isValid ? actorId : undefined };
  } catch (error) {
    console.error("Signature verification error:", error);
    return { valid: false };
  }
}

// 署名ヘッダーをパース（内部関数）
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

    if (
      !params.keyId || !params.algorithm || !params.headers || !params.signature
    ) {
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

// Digestヘッダーの検証
export async function verifyDigest(
  body: string,
  digestHeader?: string,
): Promise<boolean> {
  if (!digestHeader) return true; // Digestヘッダーがない場合はスキップ

  try {
    // SHA-256 digest のみサポート
    if (!digestHeader.startsWith("SHA-256=")) {
      return false;
    }

    const expectedDigest = digestHeader.substring(8); // "SHA-256=" を除去

    // ボディのハッシュを計算
    const encoder = new TextEncoder();
    const data = encoder.encode(body);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const actualDigest = btoa(String.fromCharCode(...hashArray));

    return actualDigest === expectedDigest;
  } catch (error) {
    console.error("Digest verification error:", error);
    return false;
  }
}

// 統合された受信Activity検証
export async function verifyIncomingActivity(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: string,
): Promise<{ valid: boolean; actorId?: string; activity?: object }> {
  try {
    // Content-Typeチェック
    const contentType = headers["content-type"] || "";
    if (
      !contentType.includes("application/activity+json") &&
      !contentType.includes("application/ld+json")
    ) {
      return { valid: false };
    }

    // Digestヘッダーの検証
    if (!await verifyDigest(body, headers.digest)) {
      console.warn("Digest verification failed");
      return { valid: false };
    }

    // JSONパース
    let activity;
    try {
      activity = JSON.parse(body);
    } catch {
      return { valid: false };
    }

    // ActivityPubオブジェクトの基本検証
    if (!validateActivityPubObject(activity)) {
      return { valid: false };
    }

    // HTTP署名の検証
    const signatureResult = await verifyRequestSignature(
      method,
      url,
      headers,
      body,
    );
    if (!signatureResult.valid) {
      console.warn("HTTP signature verification failed");
      return { valid: false };
    }

    // アクターの一致性チェック
    if (activity.actor && activity.actor !== signatureResult.actorId) {
      console.warn("Actor mismatch in signature and activity");
      return { valid: false };
    }

    return {
      valid: true,
      actorId: signatureResult.actorId,
      activity,
    };
  } catch (error) {
    console.error("Activity verification error:", error);
    return { valid: false };
  }
}
