// FASP機能は凍結されています
// 既存の実装は app/core/services/fasp_frozen.ts に保存されています
import type { DataStore } from "../db/types.ts";

export const faspMetrics = {
  rateLimitHits: 0,
  signatureFailures: 0,
  timeouts: 0,
};

export interface FaspAnnouncement {
  source?: Record<string, unknown>;
  category: "content" | "account";
  eventType: "new" | "update" | "delete" | "trending";
  objectUris: string[];
  moreObjectsAvailable?: boolean;
}

export function faspFetch(
  _db: DataStore,
  _env: Record<string, string>,
  _domain: string,
  _url: string,
  _options?: Record<string, unknown>,
): Response {
  throw new Error("FASP機能は凍結されています");
}

export function sendAnnouncements(
  _db: DataStore,
  _env: Record<string, string>,
  _domain: string,
  _ann: FaspAnnouncement,
): void {
  // 凍結のため処理なし
}

export function announceIfPublicAndDiscoverable(
  _db: DataStore,
  _env: Record<string, string>,
  _domain: string,
  _ann: FaspAnnouncement,
  _obj: Record<string, unknown> | null,
): void {
  // 凍結のため処理なし
}

export function getFaspBaseUrl(
  _db: DataStore,
  _env: Record<string, string>,
  _capability: string,
): string | null {
  return null;
}

export function notifyCapabilityActivation(
  _db: DataStore,
  _env: Record<string, string>,
  _domain: string,
  _baseUrl: string,
  _identifier: string,
  _version: string,
  _enabled: boolean,
): void {
  // 凍結のため処理なし
}
